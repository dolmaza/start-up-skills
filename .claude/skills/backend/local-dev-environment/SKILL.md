---
name: local-dev-environment
description: >-
  The one-command local development environment: a docker-compose stack running
  the app plus every dependency the project actually uses (added on demand from
  a catalog: Postgres, Redis, RabbitMQ, MinIO, OTel Collector,
  Tempo/Prometheus/Loki/Grafana), selectable as the Visual Studio startup
  project (docker-compose.dcproj), an IDE debug loop against the same containers,
  and Swagger UI wired with JWT bearer auth + seeded dev users so endpoints are
  testable in the browser. Use when setting up or fixing local dev / Swagger, or
  when adding a new dependency to the stack.
---

# Local Development Environment

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §10. One command runs everything; debugging,
logs, telemetry, and manual endpoint testing require zero extra setup. All dev
conveniences are gated on `Environment.IsDevelopment()` — production is unaffected.

## The two commands every developer uses

```bash
docker compose up -d --build                       # whole system: every app service + every dependency in use
docker compose up -d --scale api=0 --scale frontend=0   # deps only: run app/UI from the IDE
```

(Scale to zero every *app* service the file has — add `--scale worker=0` once a
Worker exists.) Visual Studio users get the first command as **F5**: see
"Visual Studio startup project" below.

## Only what the project uses (on-demand rule)

The compose file contains **only services something in the code actually talks
to**. A fresh backend starts with `api` alone (plus `postgres` once the first
aggregate is persisted). Never add a `worker`, Redis, RabbitMQ, MinIO or the
Grafana stack "for later" — an unused container is noise in `up`, in the README
and in every developer's RAM.

When a dependency is adopted during development, add all of its pieces **in the
same change** as the code that uses it, and nothing more:

1. its service block from the catalog below (pinned image, healthcheck, port,
   volume);
2. its key in `x-app-env` and its entry in the app's `depends_on`;
3. its localhost counterpart in `appsettings.Development.json`;
4. its row in the README URL table.

Removing a dependency removes the same four things.

In deps-only mode the app runs under the debugger (F5 / `dotnet watch`) and the
frontend from `npm run dev`, both against the same containers — every dependency
publishes its port on localhost, and `appsettings.Development.json` points at those
localhost ports (container env vars point at service names; same keys, different
hosts).

**The frontend is part of this stack.** `docker compose up` must bring up the
whole system, not just the backend half (`docs/backend/ARCHITECTURE.md` §10.1).
Include the `frontend` service below whenever the repo has a frontend — and when a
frontend is added *later*, it adds its own service to this same file. One compose
file per repo.

## docker-compose.yml — starting point

```yaml
services:
  api:
    build: { context: ., dockerfile: src/Api/Dockerfile }
    environment:
      ASPNETCORE_ENVIRONMENT: Development
    ports: ["8080:8080"]
```

That is the whole file for a backend with no dependencies yet. It grows from the
catalog as features need things.

## Service catalog (copy a block only when the code uses it)

| Service(s)                                   | Add when                                         |
|----------------------------------------------|--------------------------------------------------|
| `postgres`                                   | the first aggregate is persisted                 |
| `redis`                                      | caching or the idempotency store is implemented  |
| `rabbitmq`                                   | the first integration event is published/consumed|
| `minio`                                      | the first file is stored                         |
| `otel-collector` + `tempo`/`loki`/`prometheus`/`grafana` | observability is wired (`observability-stack` skill) — as one unit |
| `worker`                                     | the Worker project exists (`solution-scaffolder` §7) |
| `frontend`                                   | the repo has a frontend                          |

The file below is the shape **once everything has been adopted** — a reference to
copy blocks from, not a template to paste whole. Hoist `x-app-env` / `&app-deps`
into anchors once a second app service (worker) needs to share them.

```yaml
x-app-env: &app-env
  ASPNETCORE_ENVIRONMENT: Development
  ConnectionStrings__Db: Host=postgres;Database=acme;Username=acme;Password=acme
  Redis__Connection: redis:6379
  RabbitMq__Host: rabbitmq
  S3__ServiceUrl: http://minio:9000
  Otel__Endpoint: http://otel-collector:4317

services:
  api:
    build: { context: ., dockerfile: src/Api/Dockerfile }
    environment: *app-env
    ports: ["8080:8080"]
    depends_on: &app-deps
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }
      minio: { condition: service_healthy }
      otel-collector: { condition: service_started }
  worker:
    build: { context: ., dockerfile: src/Worker/Dockerfile }
    environment: *app-env
    depends_on: *app-deps

  frontend:                                  # omit ONLY while the repo has no frontend
    build: { context: ./frontend, target: dev }   # ./frontend = wherever package.json lives
    environment:
      # Browser-reachable URL — the fetch runs on the HOST, not in the network.
      VITE_API_URL: http://localhost:8080
    ports: ["5173:5173"]                     # NOT 3000 — Grafana owns that
    volumes:
      - ./frontend:/app                      # bind mount → HMR on host edits
      - /app/node_modules                    # keep the container's node_modules
    depends_on: { api: { condition: service_started } }

  postgres:
    image: postgres:17
    environment: { POSTGRES_USER: acme, POSTGRES_PASSWORD: acme, POSTGRES_DB: acme }
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck: { test: ["CMD-SHELL","pg_isready -U acme"], interval: 5s, retries: 10 }
  redis:
    image: redis:7
    ports: ["6379:6379"]
    healthcheck: { test: ["CMD","redis-cli","ping"], interval: 5s, retries: 10 }
  rabbitmq:
    image: rabbitmq:4-management
    ports: ["5672:5672", "15672:15672"]     # 15672 = management UI
    healthcheck: { test: ["CMD","rabbitmq-diagnostics","ping"], interval: 5s, retries: 10 }
  minio:
    image: minio/minio:RELEASE.2024-12-18T13-15-44Z
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: minio, MINIO_ROOT_PASSWORD: minio123 }
    ports: ["9000:9000", "9001:9001"]       # 9001 = console
    volumes: ["minio:/data"]
    healthcheck: { test: ["CMD","curl","-f","http://localhost:9000/minio/health/live"], interval: 5s, retries: 10 }

  otel-collector:                            # single OTLP ingest point for app + IDE-run app
    image: otel/opentelemetry-collector-contrib:0.116.1
    command: ["--config=/etc/otelcol/config.yaml"]
    volumes: ["./deploy/otel-collector.yaml:/etc/otelcol/config.yaml:ro"]
    ports: ["4317:4317", "4318:4318"]       # OTLP gRPC / HTTP
  tempo:
    image: grafana/tempo:2.6.1
    command: ["-config.file=/etc/tempo.yaml"]
    volumes: ["./deploy/tempo.yaml:/etc/tempo.yaml:ro"]
  loki:
    image: grafana/loki:3.3.2
  prometheus:
    image: prom/prometheus:v3.1.0
    command: ["--web.enable-remote-write-receiver", "--config.file=/etc/prometheus/prometheus.yml"]
    ports: ["9090:9090"]
  grafana:
    image: grafana/grafana:11.4.0
    environment: { GF_AUTH_ANONYMOUS_ENABLED: "true", GF_AUTH_ANONYMOUS_ORG_ROLE: Admin }  # local only: no login
    ports: ["3000:3000"]
    volumes: ["./deploy/grafana/provisioning:/etc/grafana/provisioning:ro"]
    depends_on: [tempo, loki, prometheus]

volumes: { pgdata: {}, minio: {} }
```

Named volumes persist data across restarts; `docker compose down -v` is the reset.

## Visual Studio startup project (`docker-compose.dcproj`)

A bare `docker-compose.yml` is invisible to Visual Studio. To make the stack
selectable as the **startup project** (F5 = compose up + debugger attached to the
.NET services), always create these alongside the compose file:

**1. `docker-compose.dcproj`** at the repo root, next to `docker-compose.yml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="15.0" Sdk="Microsoft.Docker.Sdk">
  <PropertyGroup Label="Globals">
    <ProjectVersion>2.1</ProjectVersion>
    <DockerTargetOS>Linux</DockerTargetOS>
    <ProjectGuid>NEW-GUID-HERE</ProjectGuid>   <!-- generate: uuidgen / [guid]::NewGuid() -->
    <DockerLaunchAction>LaunchBrowser</DockerLaunchAction>
    <DockerServiceName>api</DockerServiceName>
    <DockerServiceUrl>{Scheme}://localhost:{ServicePort}/swagger</DockerServiceUrl>
  </PropertyGroup>
  <ItemGroup>
    <None Include="docker-compose.yml" />
    <None Include=".dockerignore" />
  </ItemGroup>
</Project>
```

**2. Add it to the solution** — at the solution root, not under `src`/`tests`:

```bash
dotnet sln "$P.sln" add docker-compose.dcproj --in-root
```

**3. Link each containerized .NET project to it** (`src/Api/*.csproj`, and
`src/Worker/*.csproj` once it exists):

```xml
<PropertyGroup>
  <DockerDefaultTargetOS>Linux</DockerDefaultTargetOS>
  <DockerComposeProjectPath>..\..\docker-compose.dcproj</DockerComposeProjectPath>
</PropertyGroup>
```

**4. A `.dockerignore` at the repo root** (`**/bin`, `**/obj`, `.git`, `.vs`,
`**/node_modules`) — the build context is the repo root.

What VS needs from the rest of the setup:
- Each .NET service uses `build: { context: ., dockerfile: src/<Project>/Dockerfile }`
  — VS matches a service to its project by the Dockerfile sitting next to the
  `.csproj`; that is how it knows which containers to attach the debugger to.
- The Dockerfile's **first stage is the runtime `base` stage** (see
  `containerization-cicd`): in Debug, VS builds only that stage and
  volume-mounts the compiled output for fast F5.
- Keep the service named `api` and the Dockerfile `EXPOSE 8080` so
  `DockerServiceName` / `{ServicePort}` resolve and the browser opens Swagger.

VS runs the stack under its own compose project name, so it does not share
containers with a CLI `docker compose up` — stop one before starting the other
or the published ports collide. Running the API alone (the `Api` launch profile)
against deps-only containers keeps working as before.

## Observability configs (only when the Grafana stack is adopted)

Commit the small configs under `deploy/` (collector, tempo, prometheus, Grafana
provisioning). The collector fans OTLP out to the stack:

```yaml
# deploy/otel-collector.yaml
receivers: { otlp: { protocols: { grpc: { endpoint: 0.0.0.0:4317 }, http: { endpoint: 0.0.0.0:4318 } } } }
exporters:
  otlp/tempo: { endpoint: tempo:4317, tls: { insecure: true } }
  prometheusremotewrite: { endpoint: http://prometheus:9090/api/v1/write }
  otlphttp/loki: { endpoint: http://loki:3100/otlp }
service:
  pipelines:
    traces:  { receivers: [otlp], exporters: [otlp/tempo] }
    metrics: { receivers: [otlp], exporters: [prometheusremotewrite] }
    logs:    { receivers: [otlp], exporters: [otlphttp/loki] }
```

```yaml
# deploy/grafana/provisioning/datasources/datasources.yaml
apiVersion: 1
datasources:
  - { name: Prometheus, type: prometheus, url: "http://prometheus:9090", isDefault: true }
  - { name: Tempo, type: tempo, url: "http://tempo:3200" }
  - { name: Loki, type: loki, url: "http://loki:3100" }
```

## The frontend service (whenever the repo has a frontend)

`frontend/Dockerfile` — a `dev` target for compose, a default target for deploys:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS dev                              # <- compose targets this
EXPOSE 5173
CMD ["npm","run","dev","--","--host","0.0.0.0"]

FROM deps AS build
COPY . .
ARG VITE_API_URL                              # baked at build time — Vite inlines it
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine AS final               # <- what deploys (digitalocean-engineer reads this)
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf   # SPA fallback: try_files $uri /index.html
HEALTHCHECK CMD wget -qO- http://localhost/ || exit 1
```

Vite must listen on all interfaces and watch a bind mount (`vite.config.ts`):

```ts
server: {
  host: true, port: 5173,
  watch: { usePolling: true },   // bind-mount file events don't propagate on Windows/macOS
}
```

Four things that break this if you skip them:
1. **`VITE_API_URL` must be host-reachable** (`http://localhost:8080`), never
   `http://api:8080`. The request is made by the browser on the host, which cannot
   resolve compose service names. This is the single most common failure.
2. **Do not put the frontend on port 3000** — Grafana already publishes it. 5173
   (Vite's default) is free.
3. **The anonymous `/app/node_modules` volume is required.** Without it the host's
   `node_modules` shadows the container's, and native/platform-specific binaries
   (esbuild, rollup) fail to load.
4. **The API must allow the dev origin.** Add `http://localhost:5173` to the
   Development CORS policy, or every call fails in the browser while `curl` works.

Scale it to zero (`--scale frontend=0`) to run the UI from the host instead —
`npm run dev` against the same API container, same as the deps-only backend loop.

## Where to look (document this table in the project README — rows for services in use only)

| What                                   | URL / port                                |
|----------------------------------------|-------------------------------------------|
| Frontend (the app itself)              | http://localhost:5173                     |
| Swagger UI (test endpoints)            | http://localhost:8080/swagger             |
| Grafana — dashboards, Loki logs, Tempo traces | http://localhost:3000 (no login locally) |
| Prometheus                             | http://localhost:9090                     |
| RabbitMQ management                    | http://localhost:15672 (guest/guest)      |
| MinIO console                          | http://localhost:9001 (minio/minio123)    |
| Postgres / Redis / OTLP                | localhost:5432 / 6379 / 4317              |

Quick logs without Grafana: `docker compose logs -f api` (structured console JSON).

## Swagger UI with JWT auth (Presentation, dev-only)

```csharp
// AddPresentation(): OpenAPI document + bearer scheme
services.AddOpenApi(o => o.AddDocumentTransformer<BearerSecuritySchemeTransformer>());

// UsePresentationPipeline(): UI only in Development — GUARD: never exposed unprotected elsewhere
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();                                  // /openapi/v1.json
    app.UseSwaggerUI(o =>                              // package: Swashbuckle.AspNetCore.SwaggerUI
    {
        o.SwaggerEndpoint("/openapi/v1.json", "API v1");
        o.EnablePersistAuthorization();                // token survives page reloads
    });
}
```

```csharp
// Declares the Bearer scheme and applies it to secured operations, so the
// Authorize button appears and the token is sent on every "Try it out" call.
internal sealed class BearerSecuritySchemeTransformer(IAuthenticationSchemeProvider schemes)
    : IOpenApiDocumentTransformer
{
    public async Task TransformAsync(OpenApiDocument doc, OpenApiDocumentTransformerContext ctx, CancellationToken ct)
    {
        if (!(await schemes.GetAllSchemesAsync()).Any(s => s.Name == JwtBearerDefaults.AuthenticationScheme)) return;
        doc.Components ??= new();
        doc.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT",
            Description = "Paste the accessToken from POST /auth/login (no 'Bearer ' prefix).",
        };
        foreach (var op in doc.Paths.Values.SelectMany(p => p.Operations.Values))
            op.Security.Add(/* reference the "Bearer" scheme */);   // skip ops marked AllowAnonymous
    }
}
```

Writes require `Idempotency-Key` (§9.5) — add an **operation transformer** that
declares that header parameter on every POST/PUT/PATCH/DELETE so Swagger renders an
input box for it instead of the call failing with 400.

## Seeded dev users (a token is always one login away)

```csharp
// Infrastructure; invoked from Program.cs ONLY inside IsDevelopment()
if (app.Environment.IsDevelopment())
    await DevDataSeeder.SeedAsync(app.Services);   // idempotent

// Seeds (document in README):
//   admin@local.dev / Dev!Passw0rd  → Admin role, all scopes
//   user@local.dev  / Dev!Passw0rd  → plain user, read scopes only
```

**The manual test loop:** `docker compose up -d --build` → open
`http://localhost:8080/swagger` → `POST /auth/login` with a seeded user → copy
`accessToken` → **Authorize** → call any secured endpoint → see its logs in
`docker compose logs -f api` and its trace in Grafana → Tempo.

## Checklist
- [ ] `docker compose up -d --build` from a fresh checkout → everything healthy; no
      "install X first" steps beyond Docker.
- [ ] **The whole system is up, not half of it**: if the repo has a frontend, it is
      a service in this file, reachable in a browser, and talking to the API.
- [ ] **Nothing unused**: every compose service, env key, `depends_on` entry and
      volume has code that uses it; no `worker` service without a Worker project.
- [ ] **Visual Studio**: `docker-compose.dcproj` exists at the repo root, is in the
      solution, and can be set as startup project; F5 brings the stack up, attaches
      the debugger to the API and opens Swagger.
- [ ] Deps-only mode (every app service scaled to 0) + F5 and
      `npm run dev` work; localhost ports in `appsettings.Development.json`, service
      names in compose env.
- [ ] Swagger UI reachable in dev only; Authorize accepts a JWT; login → token →
      secured call works end to end; writes show an `Idempotency-Key` input.
- [ ] Dev users seeded only in Development; credentials documented in README.
- [ ] Logs via `compose logs`; once the Grafana stack is adopted, also
      Grafana→Loki, traces in Tempo, metrics in Prometheus. The URL table (services
      in use) is in the project README.
- [ ] Images pinned (no `:latest`); named volumes; `down -v` resets cleanly.
