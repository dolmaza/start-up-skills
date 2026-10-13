---
name: mobile-navigation
description: >-
  Templates for Expo Router navigation in a feature-based React Native app:
  thin route files that re-export feature screens, layouts and route groups,
  the auth guard, typed routes, Zod-validated route params, tabs and modals,
  and deep-link handling including resume-after-login. Use when adding a
  screen, route, tab, modal or deep link, or protecting part of the app.
---

# Mobile Navigation (Expo Router)

Constitution (when the project has one): `docs/mobile/ARCHITECTURE.md` §3.
`src/app/` is the URL map of the app and **nothing else** — screens live in
features.

## The route tree
```text
src/app/
├── _layout.tsx              # root: providers + session bootstrap + guard
├── +not-found.tsx
├── (auth)/                  # signed-out
│   ├── _layout.tsx
│   ├── login.tsx
│   └── register.tsx
└── (app)/                   # signed-in
    ├── _layout.tsx
    ├── (tabs)/
    │   ├── _layout.tsx      # the tab bar
    │   ├── index.tsx        # home tab
    │   └── orders/
    │       ├── index.tsx
    │       └── [id].tsx
    └── order-create.tsx     # presented as a modal
```
Groups in parentheses organize without adding a URL segment.

## A route file is a thin shell
```tsx
// src/app/(app)/(tabs)/orders/index.tsx — the whole file
export { OrderListScreen as default } from "@/features/orders";
```
With params: validate, then hand a typed prop to the screen.

```tsx
// src/app/(app)/(tabs)/orders/[id].tsx
import { Redirect, useLocalSearchParams } from "expo-router";
import { z } from "zod";
import { OrderDetailScreen } from "@/features/orders";

const params = z.object({ id: z.string().uuid() });

export default function OrderDetailRoute() {
  const parsed = params.safeParse(useLocalSearchParams());
  if (!parsed.success) return <Redirect href="/+not-found" />;   // a bad link never crashes
  return <OrderDetailScreen orderId={parsed.data.id} />;
}
```
Rules for anything under `src/app/`:
- Imports features **only through their `index.ts`**; contains no `useQuery`, no
  business logic, no styling.
- Params are untrusted input (they arrive from deep links and notifications) —
  always Zod-parsed here. Screens take typed props, not `useLocalSearchParams`.
- A screen component lives in `features/<feature>/screens/` and is exported from
  the feature's public API.

## The auth guard lives in the layout
```tsx
// src/app/_layout.tsx (inside the providers)
function RootNavigator() {
  const status = useSession((s) => s.status);          // "loading" | "signedIn" | "signedOut"
  if (status === "loading") return null;               // splash stays up (mobile-auth)
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
```
When the guard flips, the router leaves the protected group by itself — no
manual `router.replace` on login/logout. On an SDK without `Stack.Protected`,
put `if (status !== "signedIn") return <Redirect href="/login" />` in
`(app)/_layout.tsx`. Never re-check auth inside individual screens.

## Tabs and modals
```tsx
// src/app/(app)/(tabs)/_layout.tsx
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index"  options={{ title: "Home",   tabBarIcon: HomeIcon }} />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: OrdersIcon }} />
    </Tabs>
  );
}

// src/app/(app)/_layout.tsx
<Stack>
  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
  <Stack.Screen name="order-create" options={{ presentation: "modal", title: "New order" }} />
</Stack>
```
- 3–5 tabs; each tab keeps its own stack. A detail screen pushes onto the
  current tab's stack rather than hiding the tab bar arbitrarily.
- Use native stack headers and the platform back behavior; don't hand-build a
  header with a custom back button unless the design requires it. Android
  hardware back and the iOS edge swipe must work on every screen.

## Navigating (typed)
```tsx
import { Link, router } from "expo-router";

<Link href={{ pathname: "/orders/[id]", params: { id: order.id } }} asChild>
  <OrderRow order={order} />
</Link>

router.push("/order-create");
router.back();
router.replace("/");          // only for flows the user must not return into
```
`experiments.typedRoutes` makes a wrong `href` a compile error — never build
paths by string concatenation. Navigation is triggered from screens/hooks in
features; `shared/` and primitives stay navigation-agnostic.

## Where view state lives
| State                                         | Home                         |
|-----------------------------------------------|------------------------------|
| Which entity a screen shows                   | route param                  |
| Filter / sort that should survive navigation or be linkable | route params (`router.setParams`) |
| Scroll position, open accordion, draft input  | local state                  |
| Session, theme                                | Zustand                      |

## Deep links
The scheme set at scaffold time makes every route a link:
`acme://orders/123` → `(app)/(tabs)/orders/[id]`.

```bash
npx uri-scheme open "acme-dev://orders/123" --ios       # or --android
```
Requirements for every linkable screen:
- **Cold start**: opened from a killed app, it renders with a sensible back
  stack (declare `unstable_settings = { initialRouteName: "(tabs)" }` in the
  group layout so Back goes somewhere).
- **Signed out**: the guard sends the user to login; remember the target and
  go there after sign-in.

```tsx
// (auth)/login.tsx route → LoginScreen receives `returnTo`
const { returnTo } = z.object({ returnTo: z.string().startsWith("/").optional() })
  .parse(useLocalSearchParams());
// after a successful login: router.replace(returnTo ?? "/")
```
Only **relative, in-app** paths are accepted as `returnTo` (validated redirect —
no open redirect through a link).

Notification taps route through the same links (`mobile-device-capabilities`);
Universal/App Links are added there too. The OAuth callback
(`acme://auth/callback`) is consumed by `mobile-auth`, not a visible screen.

## Checklist
- [ ] Route files only re-export/compose feature screens; no logic in `src/app/`.
- [ ] Every param Zod-parsed at the route; invalid → not-found.
- [ ] Guard declared once in a layout; no per-screen auth checks.
- [ ] Typed `href`s everywhere; no concatenated paths.
- [ ] Back gesture / hardware back works on every screen, both platforms.
- [ ] Each linkable screen tested from cold start, signed in and signed out.
