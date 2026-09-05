---
name: containerization-cicd
description: >-
  Templates for multi-stage Dockerfiles and a GitHub Actions pipeline
  (restore→build→test→image→deploy). Use when containerizing the backend or
  building CI/CD. Images stay platform-agnostic. The local docker-compose stack
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
```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["Directory.Packages.props","."]
COPY ["src/Api/Acme.Api.csproj","src/Api/"]
RUN dotnet restore "src/Api/Acme.Api.csproj"
COPY . .
RUN dotnet publish "src/Api/Acme.Api.csproj" -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
RUN adduser --disabled-password --gecos "" app && chown -R app /app
USER app
COPY --from=build /app .
HEALTHCHECK CMD wget -qO- http://localhost:8080/health || exit 1
ENTRYPOINT ["dotnet","Acme.Api.dll"]
```

## docker-compose (local dev)
The full local stack — **the frontend (when the repo has one)** + app + Postgres +
Redis + RabbitMQ + MinIO + OTel Collector + Tempo/Prometheus/Loki/Grafana, with
healthchecks, published localhost ports, named volumes, and the IDE debug loop — is
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
- [ ] Multi-stage build, non-root, healthcheck, no `:latest`.
- [ ] Compose `up` from a fresh checkout works (see `local-dev-environment`).
- [ ] CI runs full test suite; image build + deploy gated on green tests.
- [ ] All configuration injected via env/secrets — image is host-agnostic.
