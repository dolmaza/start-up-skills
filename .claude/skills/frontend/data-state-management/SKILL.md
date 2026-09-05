---
name: data-state-management
description: >-
  Templates for the four state layers — TanStack Query (server), Zustand (global
  client), router search params (URL), and useState/useReducer (local) — plus the
  typed HTTP client, query keys, mutations with invalidation, and Zod validation.
  Use when wiring data fetching or deciding where state lives.
---

# Data & State Management

Constitution (when the project has one): `docs/frontend/ARCHITECTURE.md` §2, §6. Pick the narrowest layer. Server data
stays in the query cache — never copied into client state.

## Decision guide
| The data is…                              | Layer → tool                       |
|-------------------------------------------|------------------------------------|
| From the network / server-owned           | **Server** → TanStack Query        |
| Client-only, global (session, theme, shell) | **Global** → Zustand             |
| Filter / sort / pagination / shareable view | **URL** → router search params   |
| Ephemeral, one component                  | **Local** → `useState`/`useReducer`|

## Typed HTTP client (`shared/api/httpClient.ts`)
```ts
export async function http<T>(input: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${input}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeader(), ...init?.headers },
  });
  if (res.status === 401) await tryRefresh();        // rotating-refresh flow (backend §9)
  if (!res.ok) throw await toApiError(res);          // normalized typed error
  return schema.parse(await res.json());             // Zod-validate at the boundary
}
```

## Server state — TanStack Query (in a feature's `api/`)
```ts
export const orderKeys = {
  all: ["orders"] as const,
  list: (f: OrderFilters) => [...orderKeys.all, "list", f] as const,
  detail: (id: string) => [...orderKeys.all, "detail", id] as const,
};

export const useOrders = (filters: OrderFilters) =>
  useQuery({ queryKey: orderKeys.list(filters),
             queryFn: () => http(`/orders?${qs(filters)}`, orderListSchema) });

export const usePlaceOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewOrder) => http("/orders", orderSchema, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: orderKeys.all }),  // invalidate precisely
  });
};
```

## Global client state — Zustand (selector-based)
```ts
export const useSession = create<SessionState>((set) => ({
  user: null, accessToken: null,
  setSession: (user, accessToken) => set({ user, accessToken }),
  clear: () => set({ user: null, accessToken: null }),
}));
// Consume with a selector to avoid broad re-renders:
const user = useSession((s) => s.user);
```

## URL state — typed search params (TanStack Router)
```ts
const orderSearchSchema = z.object({
  status: z.enum(["all","open","closed"]).default("all"),
  page: z.number().int().min(1).default(1),
});
export const Route = createFileRoute("/orders")({ validateSearch: orderSearchSchema });
// Read/update — the URL is the source of truth for filter/sort/pagination:
const { status, page } = Route.useSearch();
const navigate = Route.useNavigate();
navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) });
```

## Local state — keep it colocated
`useState`/`useReducer` inside the one component that needs it; don't lift higher.

## Rules
- Don't mirror server data into Zustand/`useState`; derive from the query cache.
- Don't use Context for hot-changing global state — Zustand selectors instead.
- Parse every response with Zod before it enters the cache.
- Stable, structured query keys; mutations invalidate exactly the affected keys.
- Tokens in memory/Zustand, never localStorage.

## Checklist
- [ ] Each datum is in the narrowest correct layer.
- [ ] Query keys centralized; invalidations precise.
- [ ] Responses Zod-validated; errors normalized.
- [ ] No server data duplicated into client state.
