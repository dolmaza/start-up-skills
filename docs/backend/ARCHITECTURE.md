# Backend Architecture Constitution

> **This is the single source of truth.** Every skill and every change to this
> codebase MUST obey these rules without exception. When code conflicts with
> this document, the code is wrong. When this document is silent, prefer the
> most testable, loosely-coupled option and record the decision.

The rules below are intentionally **objective and checkable**. Each `[GUARD]`
marker is programmatically checkable — by the build, the tests, and NetArchTest
fitness rules.

---

## 0. Stack at a glance

| Concern              | Choice                                                        |
|----------------------|---------------------------------------------------------------|
| Runtime              | **.NET 10 (LTS)**                                             |
| Language             | **C# — latest stable version**, modern idioms required (§11)  |
| Architecture         | 4-layer Clean Architecture + DDD                              |
| Write persistence    | EF Core (state tracking, transactions)                       |
| Read persistence     | Dapper (raw SQL → DTO)                                        |
| Data access shape    | Repository pattern over `DbContext`                          |
| Request flow         | CQRS (Commands / Queries)                                    |
| Validation           | FluentValidation (pre-handler)                               |
| Error model          | `Result` / `Result<T>` — **no exceptions for control flow**  |
| API surface          | Minimal APIs (no Controllers)                                |
| Caching              | Redis (distributed)                                          |
| Object storage       | S3-compatible                                                |
| Messaging            | RabbitMQ                                                      |
| Logging              | Serilog                                                      |
| Telemetry            | OpenTelemetry → Grafana stack                                |
| Background work      | Separate Worker Service project                              |
| Containers           | Docker + Docker Compose (local)                              |
| Local dev            | `docker compose up` runs the **whole system** — frontend + app + all dependencies (§10) |
| API docs & testing   | OpenAPI + Swagger UI, JWT-enabled, dev-only (§10)            |
| CI/CD                | GitHub Actions                                               |
| LLM access           | Provider-agnostic abstraction (Gemini/Claude/OpenAI)         |
| AuthN                | JWT (access + rotating refresh) · OAuth Google + Facebook    |
| Identity store       | ASP.NET Core Identity (Infrastructure, behind interfaces)    |
| AuthZ                | Roles + scopes/permissions + resource-based policies         |
| Idempotency          | `Idempotency-Key` on writes, backed by Redis                 |
| Tests                | xUnit + FluentAssertions + Moq + WireMock                    |

---

## 1. Layered Architecture (dependencies flow INWARD only)

```
Presentation  ─────►  Application  ─────►  Domain
      │                     │                 ▲
      └─────► Infrastructure ────────────────┘
              (implements Domain/Application interfaces)
```

### Domain (`*.Domain`) — the core
- Entities, Aggregates, Value Objects, Domain Events, Repository **interfaces**,
  domain services, domain exceptions.
- `[GUARD]` **Zero external dependencies.** No EF Core, no ASP.NET, no MediatR,
  no NuGet framework packages. Only BCL + this project.
- Business invariants are enforced inside aggregates. No anemic models.

### Application (`*.Application`) — use cases
- CQRS Commands/Queries, their Handlers, Validators, DTOs, mapping, and
  **interfaces** for infrastructure concerns (e.g. `IEmailSender`, `ICacheStore`).
- `[GUARD]` May reference Domain only. **Must not** reference Infrastructure or
  Presentation. **Must not** reference EF Core types.
- Orchestrates domain objects; returns `Result`/`Result<T>`.

### Infrastructure (`*.Infrastructure`) — concrete implementations
- EF Core `DbContext`, repository implementations, Dapper read services, Redis,
  S3, RabbitMQ, Serilog sinks, LLM providers, migrations.
- `[GUARD]` Implements interfaces declared in Domain/Application. Referenced only
  via DI; no other layer references its concrete types.

### Presentation (`*.Api`) — entry point
- Minimal API endpoints, DI composition, middleware, `Program.cs`.
- `[GUARD]` Endpoints contain **zero** business/orchestration logic — they
  translate HTTP ↔ CQRS message ↔ `Result` ↔ HTTP status only.

### Reference solution layout
```
src/
  Domain/            <Project>.Domain
  Application/       <Project>.Application
  Infrastructure/    <Project>.Infrastructure
  Api/               <Project>.Api          (Minimal API host)
  Worker/            <Project>.Worker       (background jobs, if needed)
  BuildingBlocks/    shared kernel: Result, Error, base Entity/AggregateRoot, events
tests/
  Domain.UnitTests/
  Application.UnitTests/
  Infrastructure.IntegrationTests/
  Api.EndToEndTests/
  ArchitectureTests/   (NetArchTest fitness rules — encode the [GUARD]s)
```

### In-project file organization (inside each layer)

Files are organized into a **logical folder structure**: group by
**feature/aggregate first, then by role** within it. A folder holds exactly one
kind of cohesion — either *one use case* (files that change together) or *one
role* (one kind of type). Never park unrelated types together just because they
belong to the same feature — services and DTOs do not share a folder.

Reference shape (derive the exact structure from the code you actually generate,
applying these grouping principles; keep it consistent solution-wide once chosen):

```
src/Domain/
  Orders/                      # one folder per aggregate
    Order.cs · OrderLine.cs · OrderStatus.cs
    Events/                    #   the aggregate's domain events
    IOrderRepository.cs        #   repository interface colocated with its aggregate
  Common/                      # shared domain concepts (only when ≥2 aggregates need them)

src/Application/
  Abstractions/                # cross-feature interfaces for infra concerns (ICacheStore, IEmailSender, ...)
  Behaviors/                   # pipeline behaviors (validation, logging)
  Orders/                      # one folder per feature/aggregate
    Commands/PlaceOrder/       #   PlaceOrderCommand + Handler + Validator together (one use case)
    Queries/GetOrderById/      #   query + handler (+ its DTO when used only here)
    Dtos/                      #   DTOs shared by several of the feature's use cases

src/Infrastructure/
  Persistence/                 # DbContext, Configurations/, Repositories/, Migrations/, UnitOfWork
  ReadServices/                # Dapper read services
  Caching/ · Storage/ · Messaging/ · Identity/ · Llm/    # one folder per integration concern

src/Api/
  Endpoints/Orders/            # one endpoint group per feature/aggregate
  Middleware/ · Extensions/
```

Rules:
- One public type per file; the file is named after the type; **namespaces mirror
  folder paths**.
- A use case's command/query, handler, and validator are colocated (they change
  together). DTOs/contracts shared across use cases get their own role folder.
- Cross-feature abstractions live in a dedicated `Abstractions/` (or equivalent)
  folder — not scattered through feature folders.
- Reviewers treat a mixed-role grab-bag folder as a finding.

---

## 2. CQRS + Result flow (the canonical write path)

1. Endpoint receives request → maps to a `Command`.
2. A validation behavior runs the `FluentValidation` validator. `[GUARD]`
   validation runs **before** the handler; failures return `Result.Failure`
   (a `ValidationError`), never a thrown exception.
3. Command Handler loads aggregates **through repository interfaces only**.
   `[GUARD]` Handlers must not inject `DbContext`.
4. Handler mutates domain state, persists via `IUnitOfWork`/repository, returns
   `Result<T>`.
5. Endpoint maps `Result` → HTTP (`200/201/400/404/409/...`).

Queries skip the domain: endpoint → `Query` → handler → **Dapper** read service
→ DTO → `Result<TDto>`.

### Result pattern rules
- `[GUARD]` No `throw` for expected outcomes: validation failure, not-found,
  conflict, business-rule violation → all are `Result.Failure(Error)`.
- `Error` is a typed value: `(Code, Message, ErrorType)` where `ErrorType ∈
  {Validation, NotFound, Conflict, Unauthorized, Failure}`.
- Exceptions are reserved for truly unrecoverable system faults; a global
  exception handler logs them (Serilog) and returns `500`.

---

## 3. Presentation rules

- `Program.cs` is **structural only**: builder → `AddApplication()`,
  `AddInfrastructure()`, `AddPresentation()` → `app.MapEndpoints()` → run.
- `[GUARD]` No service registrations or endpoint lambdas with logic inline in
  `Program.cs`; everything lives in extension methods.
- Endpoints grouped by feature/aggregate via `IEndpointGroup` and registered with
  a single `MapEndpoints()` discovery call.
- Every endpoint carries OpenAPI metadata (`.WithName`, `.WithTags`,
  `.Produces<T>()`, `.ProducesProblem()`) — the OpenAPI document doubles as the
  API's documentation and drives the Swagger UI test loop (§10.3).

---

## 4. Infrastructure & SOLID

- Depend on abstractions; one interface per swappable concern.
- Redis for distributed caching (cache-aside via `ICacheStore`).
- S3-compatible storage behind `IFileStorage`.
- RabbitMQ behind `IEventBus` / `IMessagePublisher` for pub/sub & integration
  events. Heavy/long-running consumers live in the **Worker** project, not the API.

---

## 5. AI agent integration (in the generated product)

- `[GUARD]` No direct vendor SDK calls in Application/Domain. All LLM calls go
  through `ILlmProvider` (and `ILlmAgent` for orchestration).
- **Deterministic tooling first:** any step expressible in code is a native C#
  tool exposed to the agent — never ask the LLM to compute/fetch/format what code
  can. The agent orchestrates; tools execute.
- System prompts state concrete, bounded objectives to prevent scope creep.

---

## 6. Observability

- Serilog as the logging pipeline. Log **all** errors with full exception + context.
  `LogInformation` only for crucial lifecycle/process events — no noise.
- OpenTelemetry traces + metrics exported to the Grafana stack
  (Tempo/Prometheus/Loki). Track request duration, throughput, dependency latency.
- Dashboards cover infrastructure (CPU/mem/DB connections) **and** business
  metrics (transaction rates, failure ratios). Alerts wired for critical failures.

---

## 7. Containerization & CI/CD

- Multi-stage Dockerfile per runnable project; platform-agnostic image
  (DigitalOcean App Platform / AWS ECS / Azure Container Apps).
- `docker-compose.yml` runs API + Worker + Postgres + Redis + RabbitMQ +
  MinIO (S3) + OTel Collector + Grafana stack for local dev — the full local
  developer-experience rules live in **§10**.
- GitHub Actions pipeline: **restore → build → test → publish image → deploy**.

---

## 8. Testing pyramid (non-negotiable)

- **Unit (most):** domain rules + handlers in isolation. Moq for collaborators.
- **Integration:** repositories/EF/Dapper/Redis/RabbitMQ/S3 against real
  containers (Testcontainers); WireMock for external HTTP.
- **E2E (fewest):** critical journeys through the API host
  (`WebApplicationFactory`).
- Every feature ships with tests. AAA structure, deterministic, independent,
  descriptively named. Mock only true externals.

---

## 9. Security, Authentication & Authorization

The backend is protected **by default**. Security is not a feature on a few
endpoints — it is the baseline posture of the whole API. Use the `api-security`
skill for templates and the OWASP hardening checklist.

### 9.1 Secure by default
- `[GUARD]` Every endpoint requires authentication **unless** it explicitly opts
  out with `.AllowAnonymous()`. The global fallback policy is
  `RequireAuthenticatedUser()`. There is no implicitly-public endpoint.
- `[GUARD]` Anonymous endpoints are an allow-list, declared explicitly and kept
  minimal (login, register, refresh, forgot/reset password, health, OAuth
  callbacks). Each must justify why it is public.

### 9.2 Tokens (JWT + refresh rotation)
- The API **issues** signed JWT **access tokens** (short-lived, default 15 min)
  and **validates** them on every request (issuer, audience, lifetime, signature,
  `ValidateIssuerSigningKey = true`; `ClockSkew` ≤ 1 min).
- **Refresh tokens** are long-lived, opaque, high-entropy, stored **hashed**
  (never plaintext), one row per session/device. `[GUARD]` Refresh **rotates**:
  using a refresh token invalidates it and issues a new one. Reuse of a consumed
  refresh token revokes the whole token family (reuse detection).
- Tokens carry the subject (`sub`), roles, and scopes/permissions as claims. Keep
  them small; never put secrets/PII in a JWT (it is signed, not encrypted).
- Signing key from configuration/secret store (asymmetric RS256/ES256 preferred so
  validators don't hold the signing key). `[GUARD]` No key material in source.

### 9.3 Authorization models (all three supported)
- **Roles** — coarse buckets (`Admin`, `Manager`).
- **Scopes / permissions** — fine-grained capability claims
  (`orders:read`, `orders:write`). Endpoints require a permission policy, not a
  role, wherever practical.
- **Resource-based** — ownership/tenant checks via
  `IAuthorizationHandler` + `IAuthorizationService` (e.g. "can edit *this* order").
- `[GUARD]` Authorization is enforced server-side on every protected endpoint via a
  policy (`.RequireAuthorization("orders:write")`). Never trust client-supplied
  role/permission claims that weren't minted by this API.

### 9.4 Auth flows (always exposed)
Register · Login · Refresh · Logout (revoke) · Forgot-password · Reset-password.
- External **OAuth**: Google **and** Facebook are always wired. The provider's
  `id_token`/code is verified server-side; on success the user is provisioned or
  linked and the API issues its **own** JWT pair (the external token is never used
  as the API access token).
- Passwords hashed with a memory-hard/adaptive algorithm (ASP.NET Identity default
  / Argon2id / PBKDF2 with high iterations). `[GUARD]` Never store or log plaintext
  passwords or password-reset tokens (store reset tokens hashed, single-use,
  short-TTL). Account lockout on repeated failures.

### 9.5 Idempotency (writes)
- `[GUARD]` State-changing endpoints (POST/PUT/PATCH/DELETE) honor an
  `Idempotency-Key` header. The first request is processed and its response cached
  (Redis) keyed by `(key, route, user)`; a replay returns the stored response
  without re-executing the command. Keys expire after a bounded TTL.

### 9.6 Transport, CORS & hardening (OWASP)
- CORS configured via a **named policy** from configuration (explicit allowed
  origins/methods/headers — `[GUARD]` no `AllowAnyOrigin()` together with
  credentials). HTTPS enforced + HSTS. Security headers (CSP, X-Content-Type,
  X-Frame-Options/`frame-ancestors`, Referrer-Policy).
- Rate limiting / anti-automation on auth endpoints (login, refresh, reset).
- `[GUARD]` Defend against the OWASP API Top 10: parameterized queries only (no
  SQL injection), output never reflects unsanitized input, mass-assignment blocked
  (bind to explicit request DTOs, never to entities), no sensitive data in logs,
  generic auth failure messages (no user enumeration), validated redirects.
- Errors return safe, generic messages; full detail goes to logs only. A failed
  authZ check returns `403`, a missing/invalid token `401` — both as `Result`
  mapped to HTTP, with the reason logged server-side.

### 9.7 Where it lives (layering)
- Domain: `User`/`Role`/`Permission` concepts and invariants if modeled as a
  domain aggregate; otherwise identity is an Infrastructure concern.
- Application: `IIdentityService`, `ITokenService`, `ICurrentUser`,
  `IPasswordResetService` interfaces; auth use cases as CQRS commands returning
  `Result`.
- Infrastructure: ASP.NET Core Identity, JWT issuance/validation, refresh-token
  store, OAuth provider verification, Redis idempotency store.
- Presentation: thin auth endpoints + the authN/authZ middleware pipeline and CORS,
  all wired in extension methods (`Program.cs` stays structural).

---

## 10. Local development environment (docker-compose DX)

Developer experience is a first-class deliverable: from a fresh checkout, one
command runs the whole system, and running, debugging, reading logs/telemetry, and
manually testing endpoints require **zero setup beyond Docker**. Use the
`local-dev-environment` skill for the templates.

### 10.1 One-command stack
- `[GUARD]` `docker compose up` from a fresh checkout brings up the **whole
  system**: the frontend (when the repo has one), API, Worker, Postgres, Redis,
  RabbitMQ, MinIO (S3), OTel Collector, and the Grafana stack
  (Tempo/Prometheus/Loki/Grafana) — with pinned images, healthchecks, and correct
  `depends_on` ordering. Compose is the single source of truth for local
  dependencies; no "install X locally first" steps.
- `[GUARD]` **The frontend is part of the stack, not an afterthought.** If a
  frontend exists when compose is authored, it ships as a service in the same
  file; if one is added later, the frontend scaffolding adds its service to the
  existing compose file rather than leaving `docker compose up` half a system.
  One compose file per repo — never a second one for the UI.
- Every dependency publishes its port on localhost (DB tools, IDE debugging, and
  management UIs — RabbitMQ, MinIO, Grafana, Prometheus — all reachable).
- Named volumes persist data; `docker compose down -v` is the documented reset.

### 10.2 Debug loop (logs & telemetry included)
- **Deps-only mode** (`docker compose up -d --scale api=0 --scale worker=0
  --scale frontend=0`) runs just the backing services so API/Worker run from the
  IDE with breakpoints and hot reload against the same containers, and the
  frontend runs from `npm run dev` on the host.
  `appsettings.Development.json` targets the localhost ports; compose env vars
  target service names — same keys.
- `[GUARD]` The frontend's API base URL is **browser-reachable**
  (`http://localhost:8080`), never the compose service name — that request is
  issued by the user's browser on the host, which cannot resolve `api`. The API's
  Development CORS policy allows the frontend's dev origin so the two halves talk
  out of the box.
- Logs are inspectable two ways: `docker compose logs -f <service>` (structured
  console) and centrally in Grafana → Loki. Traces land in Tempo, metrics in
  Prometheus — all ingested through the OTel Collector, which also accepts OTLP
  from an IDE-run app on localhost.
- The project README documents the URL table: Swagger, Grafana, Prometheus,
  RabbitMQ management, MinIO console, plus DB/Redis ports and seeded credentials.

### 10.3 Swagger UI: manual endpoint testing (with auth)
- OpenAPI document + Swagger UI are enabled in **Development**. `[GUARD]` Swagger
  UI is dev-only (or explicitly authentication-protected in non-dev environments);
  it never ships open to production.
- The OpenAPI document declares the **JWT bearer security scheme** applied to all
  secured operations, so the Authorize button accepts an access token (persisted
  across reloads) and "Try it out" sends it automatically.
- The auth endpoints (login/register/refresh) are visible in the UI, making the
  full loop possible in the browser: login → copy `accessToken` → Authorize →
  call secured endpoints.
- Development seeds **known test users** (admin + least-privileged variants) via
  an idempotent, dev-only seeder so a valid token is always one login away.
- Write operations declare the `Idempotency-Key` header (§9.5) in their OpenAPI
  metadata so Swagger renders an input for it instead of the call failing.
- `[GUARD]` Dev conveniences never leak: seeded credentials, Swagger exposure, and
  any relaxed policies are gated on `Environment.IsDevelopment()`; production
  behavior is byte-for-byte unaffected.

---

## 11. C# language & code style (latest stable, modern idioms)

Generated code uses the **latest stable C# version** shipped with the target
runtime (the SDK default `LangVersion` — do not pin an older one) and its current
best practices. New code written in outdated idioms is a review finding even when
it compiles.

- `[GUARD]` `Nullable` and `ImplicitUsings` are **enabled solution-wide**
  (`Directory.Build.props`); no `#nullable disable` in new code.
- **File-scoped namespaces** everywhere; one public type per file (§1).
- **Records** for immutable data: commands, queries, DTOs, `Error`, domain events
  (`sealed record`). Classes with private setters + behavior for entities and
  aggregates.
- **Primary constructors** for simple DI-style dependency intake; `required` /
  `init` members instead of telescoping constructors for data shapes.
- **Pattern matching** (`is`, `is not null`, property/list patterns) and **switch
  expressions** over `if`/`else` chains and type-checks.
- **Collection expressions** (`[]`, spreads) and target-typed `new` where the type
  is evident.
- **Async end-to-end**: `async`/`await` with a `CancellationToken` accepted and
  propagated through every I/O path; no `.Result`/`.Wait()` blocking.
- `sealed` by default for classes not designed for inheritance.
- Prefer `TimeProvider`/injected clocks over direct `DateTime.UtcNow` where the
  time matters to logic or tests.
- **Self-documenting code, not commentary.** Names, small methods and expressive
  types carry the meaning; a comment is a last resort, never a habit. Write one
  only where the code genuinely cannot say it: a non-obvious *why*, a deliberate
  trade-off, a spec/regulation reference, or a workaround with a link. Never
  narrate *what* a line does, restate a signature, or leave banner and
  step-by-step (`// 1. …`) blocks. XML docs (`///`) only on public contracts
  whose use isn't evident from the type. Commented-out code is deleted, not
  shipped. Code sketches in these constitutions and in the skills use comments to
  explain behavior *to the agent* — a teaching device, not a template to copy
  into generated code.
- When a newer stable language/BCL feature expresses intent more clearly than an
  older pattern, use it — the constitutions' examples set a floor, not a ceiling.
