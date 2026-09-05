---
name: react-component-patterns
description: >-
  Patterns for decoupling logic from UI via custom hooks, presentational vs
  container components, composition, accessibility, and pragmatic performance. Use
  when building components or refactoring logic-heavy ones.
---

# React Component Patterns

Constitution (when the project has one): `docs/frontend/ARCHITECTURE.md` §3, §8. Components are visual skeletons;
logic lives in hooks.

## Decouple logic from UI
```tsx
// ❌ logic tangled in the component
function OrderList() {
  const { data } = useQuery(/* ... */);
  const sorted = [...(data ?? [])].sort(/* ... */);   // transformation in the view
  // ...lots of handlers...
}

// ✅ hook owns data + logic; component renders
function useOrderList(filters: OrderFilters) {
  const { data, isLoading, error } = useOrders(filters);
  const orders = useMemo(() => sortOrders(data ?? []), [data]);
  return { orders, isLoading, error };
}
function OrderList({ filters }: { filters: OrderFilters }) {
  const { orders, isLoading, error } = useOrderList(filters);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  return <ul>{orders.map((o) => <OrderRow key={o.id} order={o} />)}</ul>;
}
```

## Presentational vs container
- **Container** (feature `components/`): wires hooks → passes data/handlers down.
- **Presentational** (`shared/components/`): props in, UI out; no fetching, no
  feature knowledge, reusable.

## Composition over configuration
```tsx
// Prefer compound/children composition to a sprawling prop matrix:
<Modal>
  <Modal.Header>Confirm</Modal.Header>
  <Modal.Body>Delete this order?</Modal.Body>
  <Modal.Footer><Button onClick={onConfirm}>Delete</Button></Modal.Footer>
</Modal>
```

## Accessibility (required; jsx-a11y enforces)
- Semantic elements (`button`, `nav`, `ul`, `label`+`htmlFor`); `aria-*` only to
  fill gaps semantics can't.
- Keyboard operable; visible focus; trap/restore focus for modals/menus.
- Images have `alt`; icon-only buttons have an accessible name.

## Pragmatic performance
- Code-split by route/feature (`React.lazy`/lazy routes).
- `useMemo`/`React.memo`/`useCallback` only where a measured re-render problem
  exists — not by reflex (they add cost + complexity).
- Stable keys (never array index for dynamic lists); stable handler identities where
  they feed memoized children.
- Render loading/empty/error/success states explicitly.

## Error resilience
- Wrap features/routes in error boundaries; surface query errors as UI states.

## Checklist
- [ ] No business/transformation logic inside the component body — it's in a hook.
- [ ] Shared primitives are presentational and feature-agnostic.
- [ ] a11y: semantics, labels, keyboard, focus — zero jsx-a11y suppressions.
- [ ] Memoization only where measured; lists use stable keys.
