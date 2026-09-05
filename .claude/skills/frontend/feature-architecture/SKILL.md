---
name: feature-architecture
description: >-
  Patterns for feature vertical slices: the folder layout, colocation, the public
  index.ts API surface, strict feature boundaries, and how features communicate
  without importing each other. Use when adding or restructuring a feature.
---

# Feature Architecture (vertical slices)

Constitution (when the project has one): `docs/frontend/ARCHITECTURE.md` §1. Features are self-contained; the only
legal cross-feature surface is `index.ts`.

## Anatomy of a feature
```text
features/orders/
├── api/
│   ├── ordersApi.ts        # request functions (call shared http client)
│   └── queries.ts          # useOrders(), usePlaceOrder() — TanStack Query hooks
├── components/
│   ├── OrderList.tsx        # used ONLY inside this feature
│   └── OrderRow.tsx
├── hooks/
│   └── useOrderFilters.ts   # feature-specific logic (e.g. URL-param filters)
├── stores/
│   └── orderUiStore.ts      # feature Zustand store (optional)
├── types/
│   └── order.ts             # Zod schemas + inferred TS types
└── index.ts                 # PUBLIC API — the only thing other code may import
```

## The public API (`index.ts`)
```ts
// Export ONLY what other features/routes legitimately need.
export { OrdersPage } from "./components/OrdersPage";
export { useOrders } from "./api/queries";
export type { Order } from "./types/order";
// Internals (OrderRow, ordersApi, stores) stay private — never re-exported.
```

## Boundary rules (enforced by ESLint `boundaries`)
- ✅ `features/*` → `shared/*`, `components/*`, and **its own** files.
- ✅ `features/A` needs data from `features/B` → import `B`'s `index.ts`, or lift the
  data into a shared parent route/container that passes props down.
- ❌ `features/A` importing `features/B/hooks/useThing` (deep import).
- ❌ `features/A` importing `features/B/components/...` internals.
- ❌ `shared/*` importing `features/*` or `app/*`.

## Colocation policy
- Start everything **inside the feature**. Only promote a file to `shared/` or
  `components/` when a **second** feature actually imports it — never preemptively.
- A type stays in `features/<f>/types` unless it crosses the public boundary, in
  which case export it from `index.ts`.

## Cross-feature communication
- **Parent container/route** composes sibling features and passes data via props
  (preferred for view composition).
- **Public API import** when feature A genuinely consumes feature B's capability.
- **Shared store/event** in `shared/` for truly global, cross-cutting signals
  (e.g. current session) — kept minimal.

## Checklist
- [ ] Feature has api/components/hooks/types + a curated `index.ts`.
- [ ] No sibling-feature deep imports (ESLint boundaries pass).
- [ ] Internals not leaked through the public API.
- [ ] New shared code justified by ≥2 consumers.
