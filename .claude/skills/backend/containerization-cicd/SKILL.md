---
name: containerization-cicd
description: >-
  Templates for multi-stage Dockerfiles, ASP.NET Core health checks
  (liveness/readiness probes) and a GitHub Actions pipeline
  (restore→build→test→image→deploy). Use when containerizing the backend,
  adding or fixing health checks/probes, or building CI/CD. Images stay platform-agnostic. The local docker-compose stack
  lives in the local-dev-environment skill.
---

# Containerization & CI/CD

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §7. Platform-agnostic images (DO App Platform / AWS
ECS / Azure Container Apps). Config via env vars/secrets, never baked in.
This skill ships the Dockerfiles and the **minimal** build/test pipeline; the
full version-driven release flow (semver releases, GitHub Environments +
approvals, security scanning, rollback) is the `release-pipeline` skill via
`cicd-engineer` — when that exists, it replaces the basic pipeline here.

## Multi-stage Dockerfile (per runnable project)
One per project that **exists** — `src/Api/Dockerfile` to start; a Worker gets
its own only when the Worker project is added. The file lives next to the
`.csproj`; the build context is the repo root.

```dockerfile
# `base` MUST be the first stage: Visual Studio's docker-compose debugging builds
# only this stage in Debug and mounts the compiled output into it.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
# The runtime image ships neither curl nor wget; the HEALTHCHECK below needs one.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
USER $APP_UID
WORKDIR /app
EXPOSE 8080

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["Directory.Build.props","Directory.Packages.props","./"]
COPY ["src/Api/Acme.Api.csproj","src/Api/"]
# ...one COPY per referenced project's .csproj (Application, Infrastructure, ...)
RUN dotnet restore "src/Api/Acme.Api.csproj"
COPY . .
RUN dotnet publish "src/Api/Acme.Api.csproj" -c Release -o /app/publish --no-restore

FROM base AS final
WORKDIR /app
COPY --from=build /app/publish .
HEALTHCHECK CMD curl -fsS http://localhost:8080/alive || exit 1   # liveness probe
ENTRYPOINT ["dotnet","Acme.Api.dll"]
```

## Health checks (liveness + readiness probes — the Microsoft way)

Constitution: `docs/backend/ARCHITECTURE.md` §6.1. Health is exposed through
**ASP.NET Core Health Checks** (`AddHealthChecks` / `MapHealthChecks` /
`IHealthCheck`), using the probe convention of Microsoft's .NET service
defaults. **Never hand-write a health endpoint** (`MapGet("/health", () => Ok())`).

| Probe     | Route     | Answers                                   | Runs                     | Exists          |
|-----------|-----------|-------------------------------------------|--------------------------|-----------------|
| Liveness  | `/alive`  | "is the process up?" — restart if not     | checks tagged `live` only | always          |
| Readiness | `/health` | "can it serve traffic?" — hold traffic if not | every registered check | only once the app has a dependency to check |

**Liveness — the baseline, part of the first scaffold:**

```csharp
// Api/Extensions — AddPresentation()
services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"]);

// Api/Extensions — MapEndpoints()
app.MapHealthChecks("/alive", new HealthCheckOptions { Predicate = r => r.Tags.Contains("live") })
   .AllowAnonymous();
```

Liveness never touches a dependency: a database outage must not make the
orchestrator restart a healthy process.

**Readiness — added on demand**, in the same change that adopts the first
dependency the app cannot serve without (on-demand rule, §0.1). Until then there
is no `/health` route and no readiness probe.

```csharp
// Infrastructure/DependencyInjection.cs — one check per dependency in use
services.AddHealthChecks()
    .AddDbContextCheck<AppDbContext>();   // Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore

// Api/Extensions — MapEndpoints()
app.MapHealthChecks("/health").AllowAnonymous();
```

- Dependency checks: `AddDbContextCheck<T>` for EF Core; for anything else
  (Redis, RabbitMQ, S3) a small `IHealthCheck` class in Infrastructure that reuses
  the already-registered client. Each is added with its dependency, removed with it.
- Only gate readiness on dependencies the app truly cannot serve without; an
  optional/degradable dependency reports `Degraded`, not `Unhealthy`.
- Both routes are `.AllowAnonymous()` (they are on the §9.1 allow-list) and keep
  the default response writer — a bare status string, no dependency names,
  versions or exception text.
- The middleware routes are not minimal-API business endpoints: no
  `IEndpointGroup`, no CQRS, no `Idempotency-Key`.

**Who probes what:**

| Consumer                                         | Probe                                   |
|--------------------------------------------------|-----------------------------------------|
| Dockerfile `HEALTHCHECK`, compose `healthcheck`  | `/alive`                                |
| Kubernetes / App Platform `livenessProbe`        | `/alive`                                |
| Kubernetes / App Platform `readinessProbe`, load balancer | `/health` (when it exists)     |
| Deploy gate & post-deploy validation             | `/health` when it exists, else `/alive` |

## docker-compose (local dev)
The local stack — app services plus **only the dependencies the project uses**
(catalog: Postgres, Redis, RabbitMQ, MinIO, OTel Collector,
Tempo/Prometheus/Loki/Grafana, the frontend), with healthchecks, published
localhost ports, named volumes, the IDE debug loop, and the
`docker-compose.dcproj` that makes it a **Visual Studio startup project** — is
owned by the **`local-dev-environment` skill** (rules:
`docs/backend/ARCHITECTURE.md` §10), which also carries the frontend Dockerfile.
Use that template; keep one compose file, don't fork a second one here — and note
that the frontend service builds its **`dev`** target, while images you push in CI
build the default target (static build behind nginx).

## GitHub Actions (restore → build → test → image → deploy)
```yaml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '10.0.x' }
      - run: dotnet restore
      - run: dotnet build --no-restore -c Release
      - run: dotnet test --no-build -c Release --collect:"XPlat Code Coverage"
  image:
    needs: build-test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with: { context: ., file: src/Api/Dockerfile, push: true, cache-from: type=gha, cache-to: type=gha,mode=max, tags: "${{ vars.REGISTRY }}/acme-api:${{ github.sha }}" }
  deploy:
    needs: image
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploy ${{ github.sha }} to target platform"   # DO/ECS/ACA-specific step
```

## Checklist
- [ ] Multi-stage build, `base` stage first (VS debugging), non-root,
      `HEALTHCHECK` on `/alive`, no `:latest`.
- [ ] Health via ASP.NET Core Health Checks only — `/alive` (liveness) always;
      `/health` (readiness) only if there is a dependency to check; no custom
      health endpoint.
- [ ] Dockerfiles and image jobs exist only for projects that exist.
- [ ] Compose `up` from a fresh checkout works (see `local-dev-environment`).
- [ ] CI runs full test suite; image build + deploy gated on green tests.
- [ ] All configuration injected via env/secrets — image is host-agnostic.
