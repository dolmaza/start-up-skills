# start-up-skills

The engineering know-how of the [start-up](https://github.com/dolmaza/start-up)
factory, with the factory removed.

**24 skills you invoke yourself, when you decide you want them.** No agents, no
slash commands, no orchestration, no requirements pipeline. You drive the work;
a skill supplies the patterns, templates, and checklists for the thing you are
doing right now, and then gets out of the way.

## Install

```text
/plugin marketplace add C:/Projects/start-up-skills
/plugin install start-up-skills@start-up-skills
```

## Use

Invoke a skill by name whenever you want its know-how in context:

```text
/start-up-skills:ddd-modeling
/start-up-skills:cqrs-result-pattern
/start-up-skills:feature-architecture
```

Or just describe the work — the skill descriptions are written so Claude loads
the right one on its own ("add a query handler for open orders", "this endpoint
is slow", "wire TanStack Query for the orders list").

Skills compose. A backend feature slice is typically `ddd-modeling` →
`cqrs-result-pattern` → `hybrid-persistence` → `minimal-api-endpoints` →
`dotnet-testing`, invoked one at a time as you work through the layers.

## The constitutions (optional but recommended)

`docs/backend/ARCHITECTURE.md` and `docs/frontend/ARCHITECTURE.md` are the full
architecture rules. Each skill is a self-contained cheat sheet and works without
them, but several point at a section for the authoritative detail.

Copy them into a project once to make those pointers resolve:

```powershell
# PowerShell
Copy-Item -Recurse C:\Projects\start-up-skills\docs .\docs
```
```bash
# bash
cp -R /c/Projects/start-up-skills/docs ./docs
```

Then edit them — they are yours, and the skills read whatever they say.

## The skills

### Backend — .NET 10 Clean Architecture + DDD

| Skill | For |
|---|---|
| `clean-architecture` | Which layer a type belongs in; the inward dependency law |
| `ddd-modeling` | Aggregates, entities, value objects, typed IDs, domain events |
| `cqrs-result-pattern` | Commands, queries, handlers, validators, the `Result` type |
| `minimal-api-endpoints` | Endpoint groups, `Result`→HTTP mapping, `Program.cs` composition |
| `hybrid-persistence` | EF Core for writes, Dapper for reads, Redis/S3/RabbitMQ behind interfaces |
| `api-security` | JWT + refresh rotation, roles/scopes/resource policies, OAuth, OWASP |
| `dotnet-testing` | The pyramid with xUnit, FluentAssertions, Moq, WireMock, Testcontainers |
| `observability-stack` | Serilog, OpenTelemetry traces + metrics over OTLP |
| `grafana-dashboards` | Audience-driven dashboards, RED/USE PromQL, SLO alerts as code |
| `performance-optimization` | Baseline → find the root cause → fix → prove it with numbers |
| `llm-provider-abstraction` | LLM/agent features without vendor lock-in |
| `local-dev-environment` | One-command docker-compose stack + Swagger with JWT auth |
| `containerization-cicd` | Multi-stage Dockerfiles and a build/test/image/deploy pipeline |
| `solution-scaffolder` | Bootstrap the solution layout, projects, references, DI skeleton |

### Frontend — feature-based React + TypeScript

| Skill | For |
|---|---|
| `feature-architecture` | Vertical slices, colocation, the `index.ts` boundary |
| `data-state-management` | TanStack Query / Zustand / URL params / local state, and which to use |
| `react-component-patterns` | Logic in hooks, presentational components, composition, a11y |
| `frontend-testing` | Vitest + RTL + MSW + Playwright |
| `frontend-scaffolder` | Bootstrap Vite + TS + Tailwind + boundary lint rules |

### Infrastructure

| Skill | For |
|---|---|
| `digitalocean-infrastructure` | Compose → DO mapping, sizing, cost estimation, `doctl` provisioning |
| `release-pipeline` | Version-driven GitHub Actions: ci / release / deploy / rollback |

### Research and process

| Skill | For |
|---|---|
| `provider-research` | Researching an external site or API as a data source |
| `grill-me` | Interrogating a vague idea into a precise spec before writing anything |
| `git-workflow` | Branch-and-PR discipline; main stays merge-only |

