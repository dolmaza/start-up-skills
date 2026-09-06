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

## Modern C# baseline (C# 14 / .NET 10)

Every project targets `net10.0` with nullable reference types, implicit usings, and
`LangVersion latest` — set once in `Directory.Build.props` (see `solution-scaffolder`).
This table is the house style; the other backend skills' examples all follow it.

| Write this | Not this |
|---|---|
| File-scoped namespace: `namespace Acme.Domain.Orders;` | block-bodied `namespace X { … }` |
| Primary constructor: `sealed class Handler(IOrderRepository orders)` | ctor + `private readonly` field + assignment |
| Collection expression: `= []`, `[a, b, .. rest]` | `new List<T>()`, `new T[]{…}`, `Array.Empty<T>()` |
| `field` keyword in an accessor | hand-written backing field |
| Switch expression + patterns | nested `if`/ternary chains |
| Raw string literal `"""…"""` for SQL/JSON | escaped or concatenated strings |
| `required` / `init` members | mutable setters plus runtime null checks |
| `record` / `readonly record struct` | class with hand-written equality |
| `TimeProvider` injected | `DateTime.UtcNow` |
| `System.Threading.Lock` | `lock` on a plain `object` |
| `ArgumentNullException.ThrowIfNull(x)` | `if (x is null) throw new …` |
| `IReadOnlyCollection<T>` / `params ReadOnlySpan<T>` on public APIs | `params T[]`, bare `IEnumerable<T>` you enumerate twice |
| `sealed` on every concrete class | open-by-default |

Two limits worth knowing before reaching for a primary constructor:
- It is **always as accessible as the type**. Factory-only types — `Result`, a
  validated value object — still need an explicit `private`/`internal`/`protected`
  ctor.
- Its parameters are **captured for the object's lifetime**. That is exactly right
  for injected dependencies; for a value used only during construction, assign it
  to a member and stop referencing the parameter.

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
