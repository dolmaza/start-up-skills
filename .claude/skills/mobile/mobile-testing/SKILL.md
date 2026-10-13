---
name: mobile-testing
description: >-
  Templates and rules for the mobile testing pyramid with Jest (jest-expo) +
  React Native Testing Library + MSW + Maestro: unit tests for hooks, stores
  and schemas, component and screen tests with mocked network and native
  modules, and end-to-end Maestro flows for critical journeys on both iOS and
  Android. Use when adding test coverage for any mobile feature or setting up
  mobile E2E.
---

# Mobile Testing (the pyramid)

Constitution (when the project has one): `docs/mobile/ARCHITECTURE.md` §10.
Same philosophy as the `frontend-testing` skill — test behavior, mock only true
externals, every feature ships with tests — with a different toolchain: Vitest
and Playwright do not run React Native, so mobile uses **Jest** and **Maestro**.

## Setup
```jsonc
// package.json
"jest": {
  "preset": "jest-expo",
  "setupFilesAfterEnv": ["<rootDir>/src/shared/test/setup.ts"],
  "moduleNameMapper": { "^@/(.*)$": "<rootDir>/src/$1" }
}
```
```ts
// src/shared/test/setup.ts
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));   // an unmocked call fails the test
afterEach(() => { server.resetHandlers(); queryClient.clear(); });
afterAll(() => server.close());

jest.mock("expo-secure-store");                                    // native modules: mock at the seam
jest.mock("react-native-mmkv", () => require("./mmkvMock"));
jest.mock("@react-native-community/netinfo", () => require("@react-native-community/netinfo/jest/netinfo-mock"));
```
```tsx
// src/shared/test/render.tsx — one wrapper, shared by every test
export function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
```
Native modules are mocked **once**, in setup or behind the `shared/` wrapper
that owns them — never ad hoc in individual tests.

## Unit — hooks, stores, schemas, utils (the bulk)
```ts
test("useSession_setTokens_persistsRefreshTokenAndSignsIn", async () => {
  await act(() => useSession.getState().setTokens({ accessToken: "a", refreshToken: "r" }));

  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("refresh_token", "r", expect.anything());
  expect(useSession.getState().status).toBe("signedIn");
});

test("refreshAccessToken_calledConcurrently_refreshesOnce", async () => {
  let calls = 0;
  server.use(http.post("*/auth/refresh", () => { calls++; return HttpResponse.json(tokenPair); }));

  await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);

  expect(calls).toBe(1);                       // the single-flight guard (mobile-auth)
});
```

## Component & screen — RNTL + MSW
```tsx
import { screen, userEvent } from "@testing-library/react-native";

test("OrderListScreen_whenRequestFails_showsRetry", async () => {
  server.use(http.get("*/orders", () => HttpResponse.json({}, { status: 500 })));

  renderWithProviders(<OrderListScreen />);

  expect(await screen.findByRole("button", { name: /try again/i })).toBeOnTheScreen();
});

test("LoginForm_validCredentials_submits", async () => {
  const onSubmit = jest.fn();
  const user = userEvent.setup();
  renderWithProviders(<LoginForm onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText(/email/i), "user@local.dev");
  await user.type(screen.getByLabelText(/password/i), "Dev!Passw0rd");
  await user.press(screen.getByRole("button", { name: /sign in/i }));

  expect(onSubmit).toHaveBeenCalledWith({ email: "user@local.dev", password: "Dev!Passw0rd" }, expect.anything());
});
```
- Query by **role / label / text**. A control you cannot find by role or label
  is an accessibility bug — fix the component, don't reach for `testID`.
- Cover **loading / empty / error / offline / success** for data screens.
  Offline: `onlineManager.setOnline(false)` before rendering.
- Screens are tested as components with typed props — route params are parsed
  in the route file (`mobile-navigation`), so no router is needed for most
  tests. For navigation behavior itself use `renderRouter` from
  `expo-router/testing-library`.
- No snapshot tests of whole screens.

## MSW handlers (shared)
```ts
// src/shared/test/server.ts
export const handlers = [
  http.get("*/orders", () => HttpResponse.json([order("a"), order("b")])),
  http.post("*/auth/login", () => HttpResponse.json(tokenPair)),
];
export const server = setupServer(...handlers);          // msw/node
```
Fixtures are built from the **generated** types/schemas, so a contract change
breaks the fixture at compile time instead of silently drifting.

## E2E — Maestro (critical journeys only)
Flows run against a **real build** (the preview variant) on a simulator or
emulator; nothing is compiled into the app.

```yaml
# .maestro/sign-in-and-place-order.yaml
appId: com.acme.app.preview
---
- launchApp: { clearState: true }
- tapOn: "Email"
- inputText: "user@local.dev"
- tapOn: "Password"
- inputText: "Dev!Passw0rd"
- tapOn: "Sign in"
- assertVisible: "Orders"
- tapOn: "New order"
- tapOn: "Customer"
- inputText: "Acme"
- tapOn: "Place order"
- assertVisible: "Order placed"
```
```bash
maestro test .maestro/                       # all flows, on the booted simulator/emulator
maestro test --format junit --output report.xml .maestro/
```
- Select by visible text or accessibility label — the same contract as the
  component tests. `id:` (testID) only where there is no text.
- Flows are independent: each starts from `clearState` and signs in itself
  (extract shared steps with `runFlow: subflows/sign-in.yaml`).
- Run against a seeded backend (the compose stack's dev users) or a dedicated
  test environment — never production.
- Keep the set small: sign in, the core happy path, sign out, plus one per
  revenue-critical journey. Everything else belongs lower in the pyramid.
- **Both platforms are mandatory**: the suite passes on an iOS simulator and an
  Android emulator before a release (`mobile-release`). Use
  `- runFlow: { when: { platform: iOS }, … }` for genuine platform differences.

## What runs where
| Stage              | Runs                                                  |
|--------------------|-------------------------------------------------------|
| Every pull request | `tsc --noEmit`, `expo lint`, `jest`, `expo-doctor`    |
| Before a release   | Maestro flows on the preview build, iOS + Android     |
| By hand, per release | VoiceOver/TalkBack pass on critical flows; a physical device per platform |

## Practices
- AAA; deterministic, isolated, order-independent. Fake timers for anything
  time-based; no real network, no real storage.
- Descriptive `Subject_Scenario_ExpectedOutcome` names; shared wrappers and
  fixtures, no copy-paste.
- A bug fix starts with a failing test at the lowest level that reproduces it.

## Checklist
- [ ] New hook/store/schema/util → unit tests.
- [ ] New screen/component → RNTL tests covering error, offline and success.
- [ ] Queries by role/label/text; `onUnhandledRequest: "error"` in place.
- [ ] Native modules mocked at one seam, not per test.
- [ ] Critical journey → a Maestro flow, green on iOS **and** Android.
