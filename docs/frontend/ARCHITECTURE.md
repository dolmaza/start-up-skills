# Frontend Architecture Constitution

> **Single source of truth for the frontend.** Every skill and every change to
> this codebase MUST obey these rules. When code conflicts with this document,
> the code is wrong. `[GUARD]` markers are the programmatically checkable ones:
> TypeScript `strict`, ESLint boundary rules, tests, and the production build.

This is the frontend counterpart to `docs/backend/ARCHITECTURE.md`. It describes a
**Feature-Based (Vertical Slice)** React application that prioritizes colocation,
modularity, and strict dependency boundaries.

---

## 0. Stack at a glance

| Concern            | Choice                                                          |
|--------------------|-----------------------------------------------------------------|
| Language           | **TypeScript** (`strict: true`) — latest stable, modern idioms (§11) |
| Framework          | **React 19**                                                    |
| Build tool         | **Vite**                                                        |
| Architecture       | Feature-based vertical slices + `shared`                        |
| Server state       | **TanStack Query** (React Query)                                |
| Global client state| **Zustand**                                                     |
| URL state          | Router typed search params (**TanStack Router**)                |
| Local state        | `useState` / `useReducer` (colocated)                           |
| Routing            | TanStack Router (type-safe, file/route tree)                    |
| Data fetching      | Typed HTTP client in `shared/api` + TanStack Query hooks        |
| Schema/validation  | **Zod** (runtime validation at boundaries → inferred types)     |
| Forms              | React Hook Form + Zod resolver                                  |
| Styling            | Tailwind CSS (default; swappable, kept out of feature logic)    |
| Auth               | Token handling + protected routes (pairs with backend security) |
| Lint/format        | ESLint (+ boundary rules) + Prettier                            |
| Tests              | Vitest + React Testing Library + MSW + Playwright (E2E)         |
| Local dev          | A service in the repo's single `docker-compose.yml` (§12)       |

> Choices are concrete for determinism. Router/styling are swappable, but only via
> a documented decision — do not improvise alternates per feature.

---

## 1. Feature-based architecture (vertical slices)

```text
src/
├── app/            # entry, global providers, router setup, app shell
├── components/     # app-wide UI primitives (Button, Input, Modal, ...)
├── features/       # business domains — self-contained vertical slices
│   └── <feature>/
│       ├── api/        # feature requests + TanStack Query hooks (useX, useXMutation)
│       ├── components/ # UI used ONLY inside this feature
│       ├── hooks/      # feature-specific stateful logic
│       ├── stores/     # feature-scoped Zustand store (if needed)
│       ├── types/      # TypeScript + Zod schemas for this domain
│       └── index.ts    # the feature's PUBLIC API (the only legal import surface)
└── shared/         # cross-cutting: http client, global helpers, shared hooks, config
```

### Rules
- **Colocate.** Code lives as close as possible to where it is used. Promote to
  `shared/` or `components/` **only when ≥2 features actually use it** — not
  preemptively.
- `[GUARD]` **Strict dependency boundaries.** A feature MUST NOT import from a
  sibling feature's internals. Cross-feature data flows through a parent
  container/route or a feature's **public API** (`features/<f>/index.ts`).
  Enforced by ESLint (`eslint-plugin-boundaries` / `import/no-restricted-paths`).
- `[GUARD]` **Public API surface.** Other code imports a feature only via its
  `index.ts` barrel. Deep imports (`features/auth/hooks/useLogin`) are forbidden.
- `[GUARD]` Dependency direction: `features/*` and `components/*` may import
  `shared/*`; `shared/*` must NOT import from `features/*` or `app/*`.

---

## 2. Data & state architecture (four distinct layers)

Pick the **narrowest** layer that fits. `[GUARD]` server data is never copied into
Zustand/`useState`; it stays in the query cache.

1. **Server state → TanStack Query.** All network data. Query keys are structured
   and centralized per feature (`['orders', { filters }]`). Mutations invalidate
   the right keys. Loading/error/caching handled by the library, not by hand.
2. **Global client state → Zustand.** Cross-cutting client-only concerns (session,
   theme, UI shell). Small, selector-based stores to avoid broad re-renders.
   `[GUARD]` Avoid React Context for frequently-changing global state.
3. **URL state → router search params.** Filtering, sorting, pagination, and any
   shareable/bookmarkable view state lives in typed URL search params — not in
   component state. Pages are fully reproducible from their URL.
4. **Local state → `useState`/`useReducer`.** Ephemeral UI state, colocated in the
   exact component that needs it. Do not lift it higher than required.

---

## 3. Components & logic decoupling

- `[GUARD]` **Decouple logic from UI.** Data fetching, transformation, and complex
  event handling live in custom hooks; components are primarily a visual skeleton.
  A component with substantial inline business/transformation logic must be
  refactored into a hook + presentational component.
- Composition over configuration; prefer small composable components over
  giant prop-driven monoliths.
- `app/components/` primitives are presentational, reusable, and feature-agnostic.
- **Accessibility is non-negotiable:** semantic HTML, labels, keyboard support,
  focus management. Enforced by `eslint-plugin-jsx-a11y` (`[GUARD]`).
- **Responsive is mandatory, mobile-first.** Unprefixed Tailwind classes style
  mobile; `md:`/`lg:` progressively enhance for tablet/desktop — never the
  reverse. Every screen must be fully usable at mobile and tablet widths:
  components **transform** rather than overflow (table → stacked cards,
  sidebar → drawer, toolbar → overflow menu, modal → full-screen sheet on
  mobile), matching the screen's mapped design (`design/MAPPING.md` →
  `design/mirror/`) when a Claude Design project is connected. No
  page-level horizontal scrolling at any viewport; touch targets ≥ 44×44px;
  nothing hidden on mobile without an explicit control to reach it.

---

## 4. Type safety & validation

- `[GUARD]` TypeScript `strict: true`. No `any` (`@typescript-eslint/no-explicit-any`
  errors); use `unknown` + narrowing. `tsc --noEmit` must pass clean.
- Types stay **local to their feature** unless they cross a public domain boundary
  (then they're exported from the feature's `index.ts`).
- **Validate at the boundary.** Parse all external data (API responses, URL params,
  forms, env) with **Zod**; infer TS types from schemas (`z.infer`) so runtime and
  compile-time agree. Never trust unparsed network JSON as a typed value.

---

## 5. Routing & URL state

- TanStack Router with a typed route tree. Route-level code splitting via lazy
  routes. Search params are schema-validated (Zod) and the canonical home of
  filter/sort/pagination state (see §2.3).
- Route-level **error boundaries** and **pending/suspense** states are defined per
  route; features expose route components through their public API.

---

## 6. Data fetching / HTTP

- One typed HTTP client in `shared/api` (fetch wrapper or axios instance) that
  attaches auth headers, handles refresh, and normalizes errors to a typed shape.
- Feature `api/` folders define request functions + TanStack Query hooks
  (`useOrders`, `usePlaceOrder`). `[GUARD]` Components never call `fetch`/the client
  directly — they consume the feature's query/mutation hooks.
- Responses parsed with Zod before entering the cache.

---

## 7. Auth integration (pairs with backend §9)

- An `auth` feature owns login/register/refresh/logout/password-recovery UI + the
  token lifecycle. Access token kept in memory (or a Zustand store); refresh via the
  HTTP client interceptor using the backend's rotating refresh flow.
- `[GUARD]` Protected routes guard on authentication; unauthorized navigation
  redirects to login. UI authorization (showing/hiding by role/scope) is a
  convenience only — the backend remains the real enforcement point.
- OAuth (Google/Facebook) handled via redirect to backend endpoints; never embed
  provider secrets in the client.

---

## 8. Performance & resilience

- Code-split by route/feature (`React.lazy` / lazy routes). Memoize
  (`useMemo`/`memo`) only where a measured re-render problem exists — not by reflex.
- Stable query keys + correct `staleTime` to avoid refetch storms.
- Error boundaries per feature/route; query errors surfaced through UI states, not
  thrown to a blank screen.

---

## 9. Tooling & programmatic guardrails

- Vite + TS strict. ESLint config encodes the architecture:
  - `eslint-plugin-boundaries` / `import/no-restricted-paths` → §1 boundaries.
  - `jsx-a11y` → accessibility. `@typescript-eslint/no-explicit-any` → §4.
  - `import/no-cycle` → no circular deps.
- `[GUARD]` CI/local gates must pass before "done": `tsc --noEmit`, `eslint`,
  `vitest run`, `playwright test` (critical journeys), and `vite build`.
- Prettier for formatting. Typed env via Zod-parsed `import.meta.env`.

---

## 10. Testing pyramid (mirrors the backend)

- **Unit (most):** hooks, utils, Zustand stores, Zod schemas — isolated (Vitest).
- **Component:** components via React Testing Library, querying by role/text;
  **MSW** mocks the network. Test behavior, not implementation details.
- **E2E (fewest):** critical user journeys with **Playwright** against the running
  app (real or MSW-backed). `[GUARD]` critical journeys run in both a desktop and
  a mobile-viewport Playwright project (e.g. `Pixel 7`, 393×852) — a journey that
  cannot be completed on mobile fails the gate.
- `[GUARD]` Every feature ships with tests. AAA structure, deterministic, isolated.
  Mock only true externals (network via MSW); never assert on internal state.

---

## 11. TypeScript language & code style (latest stable, modern idioms)

Generated code uses the **latest stable TypeScript** (keep the dependency current;
do not pin an old major) and its current best practices. New code written in
outdated idioms is a review finding even when it compiles.

- **ES modules only** (`import`/`export`); type-only imports as `import type`.
- **`satisfies`** for typed configs/maps (checks the shape, keeps the narrow
  inferred type); `as const` for literal tables.
- **No `enum`** — use union-of-literal types or `as const` objects (erasable,
  tree-shakeable, plays well with Zod).
- **Discriminated unions + exhaustiveness** (`never` check in the default branch)
  for state machines and variant types.
- Types are **inferred at boundaries from Zod schemas** (`z.infer`) — never
  hand-duplicated (§4); `unknown` + narrowing instead of assertions; `as` casts
  only at well-justified boundaries.
- Modern syntax by default: optional chaining `?.`, nullish coalescing `??`/`??=`,
  spread over `Object.assign`, immutable array methods (`toSorted`, `toReversed`,
  `with`) over mutate-then-copy.
- **Modern React 19 idioms**: function components + hooks only — no class
  components, no legacy APIs (`defaultProps`, string refs); prefer the current
  form/transition APIs where they fit.
- **Self-documenting code, not commentary.** Names, small components/hooks and
  expressive types carry the meaning; a comment is a last resort, never a habit.
  Write one only where the code genuinely cannot say it: a non-obvious *why*, a
  deliberate trade-off, a browser/library quirk, or a workaround with a link.
  Never narrate *what* a line does, restate props, or leave banner and
  step-by-step (`// 1. …`) blocks. JSDoc only on shared primitives whose use
  isn't evident from the props type. Commented-out code is deleted, not shipped.
  Code sketches in these constitutions and in the skills use comments to explain
  behavior *to the agent* — a teaching device, not a template to copy into
  generated code.
- When a newer stable language feature expresses intent more clearly than an older
  pattern, use it — examples in these docs set a floor, not a ceiling.

---

## 12. Local development (the frontend is part of the one-command stack)

The repo has **one** `docker-compose.yml` and `docker compose up` must run the
whole system — UI included. The stack itself is specified in
`docs/backend/ARCHITECTURE.md` §10 and templated by the `local-dev-environment`
skill; this section is the frontend's obligation to it.

- `[GUARD]` **The frontend is a service in that compose file.** If the file already
  exists when the frontend is scaffolded, the frontend adds itself to it; if the
  frontend comes first, the backend's local-env setup picks it up. Never a second
  compose file for the UI, and never a stack that runs everything *except* the
  thing users actually look at.
- Ship a `Dockerfile` with a **`dev` target** (Vite dev server, used by compose)
  and a default target (build → static server) for deploys. `vite.config.ts` sets
  `server.host: true` and `watch.usePolling: true` so it listens inside the
  container and still sees host edits.
- Source is bind-mounted for HMR, with an anonymous `/app/node_modules` volume so
  the host's `node_modules` cannot shadow the container's platform-specific
  binaries.
- `[GUARD]` The API base URL (`VITE_API_URL`) is **browser-reachable**
  (`http://localhost:8080`), never a compose service name — the request is issued
  by the user's browser on the host, which cannot resolve `api`. The API must allow
  the dev origin (`http://localhost:5173`) in its Development CORS policy.
- Published port is **5173**, not 3000 — Grafana owns 3000 in this stack.
- `--scale frontend=0` drops the container so the UI can run from the host
  (`npm run dev`) against the same API, mirroring the backend's deps-only loop.
- **Done means** `http://localhost:5173` renders *and* its API calls succeed in the
  browser's network tab — a page that loads while every request fails is a broken
  environment, not a working one.
