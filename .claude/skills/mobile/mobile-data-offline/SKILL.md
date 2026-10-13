---
name: mobile-data-offline
description: >-
  Templates for data on a phone: TanStack Query wired to connectivity (NetInfo)
  and app lifecycle (AppState), the query cache persisted to MMKV with a
  version buster, the storage-role rules (secure store / MMKV / memory),
  query hooks over the OpenAPI-generated client, offline and stale UI states,
  pull-to-refresh and infinite lists, and on-demand offline writes with
  idempotency keys. Use when wiring data fetching in a mobile app, handling
  offline or background/foreground behavior, or deciding where data is stored.
---

# Mobile Data & Offline

Constitution (when the project has one): `docs/mobile/ARCHITECTURE.md` §5.
The four state layers, query keys, invalidation and "server data never copied
into client state" are the **`data-state-management` skill** — unchanged on
mobile. This skill adds what a phone changes: the network disappears, the app
gets suspended, and a cold start should not be a blank screen.

Baseline is **online-first with a persisted cache**. Offline writes are on
demand; a local database as source of truth is out of scope.

## Storage roles (decide before writing anything to disk)
| Data                                     | Store               |
|------------------------------------------|---------------------|
| Refresh token, any secret                | `expo-secure-store` (`mobile-auth`) |
| Persisted query cache, preferences, flags | MMKV               |
| Access token, session                    | memory (Zustand)    |
| Downloads / large files                  | `expo-file-system`  |

AsyncStorage is not used (lint error). Secrets never go into MMKV.

```ts
// src/shared/storage/mmkv.ts
import { MMKV } from "react-native-mmkv";          // v4+: `createMMKV()` instead of `new MMKV()`

export const storage = new MMKV({ id: "app" });
export const syncStorage = {                        // the shape TanStack's sync persister wants
  getItem: (key: string) => storage.getString(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};
```
Zustand preferences persist through the same instance
(`persist(..., { storage: createJSONStorage(() => syncStorage) })`) — for
client-only state such as theme or onboarding-seen, never for server data.

## Wire TanStack Query to the device (once, in `shared/api/queryClient.ts`)
```ts
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected) && s.isInternetReachable !== false)));

AppState.addEventListener("change", (status) => focusManager.setFocused(status === "active"));

const DAY = 24 * 60 * 60 * 1000;
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: DAY,                 // must be >= the persister's maxAge or entries are dropped before restore
      retry: (count, error) => !isClientError(error) && count < 2,   // don't retry 4xx
    },
  },
});
```
Effect: queries **pause** while offline instead of failing, resume on
reconnect, and refetch when the app returns to the foreground.

## Persist the cache
```tsx
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

export const persister = createSyncStoragePersister({ storage: syncStorage, key: "rq-cache" });
const CACHE_VERSION = "1";        // BUMP whenever a persisted response shape changes

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister, buster: CACHE_VERSION, maxAge: DAY,
        dehydrateOptions: { shouldDehydrateQuery: (q) =>
          q.state.status === "success" && q.meta?.persist !== false },
      }}
      onSuccess={() => queryClient.resumePausedMutations()}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
```
- **Buster**: a stale shape rehydrated into new code is a crash on launch. Bump
  it with every breaking change to a cached response (a release-checklist item).
- **Sensitive data opts out**: `useQuery({ ..., meta: { persist: false } })` for
  payment details, documents, health data, anything you would not want
  readable on a compromised device.
- **Logout** clears both: `queryClient.clear()` + `persister.removeClient()`.

## Query hooks over the generated client (in a feature's `api/`)
```ts
import { getOrders, getOrdersResponse } from "@/shared/api/generated/orders";   // generated: fn + Zod schema

export const orderKeys = {
  all: ["orders"] as const,
  list: (f: OrderFilters) => [...orderKeys.all, "list", f] as const,
  detail: (id: string) => [...orderKeys.all, "detail", id] as const,
};

export const useOrders = (filters: OrderFilters) =>
  useQuery({ queryKey: orderKeys.list(filters),
             queryFn: async () => getOrdersResponse.parse(await getOrders(filters)) });
```
Never hand-write a type the generator already produced; regenerate
(`npm run api:generate`) after a backend contract change. Screens consume the
feature's hooks — never the client directly.

## Screen states — offline is a state, not an error
```tsx
export function OrderListScreen() {
  const { data, isPending, isError, isPaused, refetch, isRefetching } = useOrders(filters);
  const online = useIsOnline();                       // shared hook over onlineManager

  if (isPending && isPaused) return <OfflineEmpty onRetry={refetch} />;   // offline, nothing cached
  if (isPending) return <OrderListSkeleton />;
  if (isError && !data) return <ErrorState onRetry={refetch} />;

  return (
    <Screen>
      {!online && <OfflineBanner />}                  {/* showing cached data */}
      <FlashList data={data} renderItem={renderOrder} keyExtractor={(o) => o.id}
                 refreshing={isRefetching} onRefresh={refetch}
                 ListEmptyComponent={<EmptyState />} />
    </Screen>
  );
}
```
The five states every data screen defines: **loading, empty, error, offline,
success**. A spinner that never ends because the device is offline is a bug.

Pull-to-refresh uses `isRefetching` (not `isPending`, which would swap the list
for a skeleton). Long lists use `useInfiniteQuery` with `onEndReached` and a
footer spinner.

## Writes
Default: a write needs connectivity. Fail fast and say so:

```ts
export const usePlaceOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    networkMode: "online",                              // paused → UI shows "You're offline"
    mutationFn: (body: NewOrder) => placeOrder(body, { headers: { "Idempotency-Key": body.clientRequestId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: orderKeys.all }),
  });
};
```
The `Idempotency-Key` (backend §9.5) is generated **once, when the user acts**
(`expo-crypto` `randomUUID()` stored with the form), not per attempt — a retry
after a timeout must reuse it or the order is placed twice.

### Offline writes (on demand, per feature)
Only when a requirement says "must work offline":
- Give the mutation a `mutationKey` and register its function with
  `queryClient.setMutationDefaults(key, { mutationFn })` at startup — a paused
  mutation restored from disk has no function otherwise.
- Persist mutations too (`dehydrateOptions.shouldDehydrateMutation`), and keep
  `resumePausedMutations()` in the provider's `onSuccess` (already above).
- Optimistic update in `onMutate`, rollback in `onError`, invalidate in
  `onSettled`; show a "pending sync" marker on the affected row.
- Decide and document what happens when the replay is rejected (validation or
  conflict) hours later — the user must be told; silent loss is not an option.

## App lifecycle
- JS timers stop when the app is suspended — never rely on `setInterval` for
  anything that must happen (polling resumes via refetch-on-focus instead).
- A fetch in flight when the app is backgrounded may be killed; the retry +
  refetch-on-focus policy covers it. Do not show an error for an aborted
  background request.
- Real background work (sync, uploads) is a device capability added on demand
  (`mobile-device-capabilities`).

## Checklist
- [ ] `onlineManager` ← NetInfo and `focusManager` ← AppState wired once.
- [ ] Cache persisted to MMKV; `gcTime >= maxAge`; buster bumped on shape changes.
- [ ] Sensitive queries `meta.persist: false`; logout clears memory + disk cache.
- [ ] No AsyncStorage; no secret or token in MMKV.
- [ ] Hooks wrap the generated client; responses Zod-parsed; no hand-copied types.
- [ ] Every data screen: loading / empty / error / offline / success.
- [ ] Writes carry a once-generated `Idempotency-Key`; offline writes only where required.
