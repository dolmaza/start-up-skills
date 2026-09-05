---
name: clean-architecture
description: >-
  The 4-layer Clean Architecture + DDD rules: layer responsibilities, the inward
  dependency law, project layout, and naming conventions. Use when deciding which
  layer a type belongs in, or when reviewing/placing code across layers.
---

# Clean Architecture (4 layers)

This skill is the self-contained cheat sheet; when the project carries the
constitution, `docs/backend/ARCHITECTURE.md` §1 is authoritative.

## The dependency law
```
Presentation ─► Application ─► Domain ◄─ Infrastructure
```
Dependencies point **inward**. Outer layers know inner; inner never knows outer.
Infrastructure depends inward and *implements* interfaces declared there.

## "Which layer does this go in?"
| You're writing…                                   | Layer          |
|---------------------------------------------------|----------------|
| Entity / Aggregate / Value Object / Domain Event  | Domain         |
| Repository **interface**                          | Domain         |
| Business invariant / domain service               | Domain         |
| Command/Query + Handler + Validator + DTO         | Application    |
| Interface for infra concern (`ICacheStore` etc.)  | Application    |
| `DbContext` / repository **implementation**       | Infrastructure |
| Dapper read service / Redis / S3 / RabbitMQ client| Infrastructure |
| LLM provider implementation                       | Infrastructure |
| Minimal API endpoint / middleware / `Program.cs`  | Presentation   |

## Smell → fix
- EF Core type imported in Application → move behind a repository/UoW interface.
- `DbContext` injected into a handler → inject the repository interface instead.
- Endpoint with `if`/business logic → move into a handler.
- Logic in `Program.cs` → extract to an extension method.
- Domain `.csproj` with a framework package → remove it; redesign.

## Microservices readiness
Keep modules organized by bounded context so a context can be lifted into its own
service later: no cross-context entity references; communicate across contexts via
integration events (RabbitMQ), never shared tables.

## Naming & file organization
`<Project>.Domain | .Application | .Infrastructure | .Api | .Worker | .BuildingBlocks`.

Inside each project, group **by feature/aggregate first, then by role** (full
reference layout in `docs/backend/ARCHITECTURE.md` §1):
- Domain: `Domain/<Aggregate>/` (root + entities + VOs + `Events/` + the
  repository interface, colocated).
- Application: `Application/<Feature>/Commands/<UseCase>/` (command + handler +
  validator together) · `Queries/<UseCase>/` · shared `Dtos/`; cross-feature
  interfaces in `Abstractions/`, pipeline behaviors in `Behaviors/`.
- Infrastructure: by concern — `Persistence/`, `ReadServices/`, `Caching/`,
  `Storage/`, `Messaging/`, `Identity/`, `Llm/`.
- Api: `Endpoints/<Feature>/`, `Middleware/`, `Extensions/`.

One public type per file; namespaces mirror folders. A folder holds one kind of
cohesion — never a grab-bag (services and DTOs don't share a folder just because
they share a feature). Derive the exact structure from the generated code using
these principles; stay consistent solution-wide.
