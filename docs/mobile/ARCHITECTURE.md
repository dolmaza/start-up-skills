# Mobile Architecture Constitution

> **Single source of truth for the mobile app.** Every skill and every change to
> a mobile codebase MUST obey these rules. When code conflicts with this
> document, the code is wrong. `[GUARD]` markers are the programmatically
> checkable ones: TypeScript `strict`, ESLint boundary rules, tests,
> `expo-doctor`, and the EAS build.

This is the mobile counterpart to `docs/frontend/ARCHITECTURE.md` and
`docs/backend/ARCHITECTURE.md`. It describes a **React Native + Expo** app for
iOS and Android that is a **sibling of the web frontend**: the same
feature-based vertical slices, the same four state layers, the same
validate-at-the-boundary rule — plus the platform layer that only exists on a
phone (native builds, secure storage, connectivity, app lifecycle, permissions,
push, store release).

**Shared rules are not restated here.** Where this document says "as web", the
referenced section of `docs/frontend/ARCHITECTURE.md` applies unchanged.

---

## 0. Stack at a glance

| Concern             | Choice                                                            |
|---------------------|-------------------------------------------------------------------|
| Language            | **TypeScript** (`strict: true`) — as web §11                      |
| Framework           | **React Native + Expo** (latest stable SDK), New Architecture on  |
| Native workflow     | **Continuous Native Generation** + development builds (§2)        |
| Navigation          | **Expo Router** (file-based, typed routes) (§3)                   |
| Architecture        | Feature-based vertical slices + `shared` — as web §1              |
| Server state        | **TanStack Query**, persisted, connectivity-aware (§5)            |
| Global client state | **Zustand** — as web §2                                           |
| Navigation state    | Route params, Zod-validated (§3)                                  |
| Local state         | `useState` / `useReducer` — as web §2                             |
| API contract        | Types + Zod schemas **generated from the backend's OpenAPI** (§5) |
| Forms               | React Hook Form + Zod resolver                                    |
| Styling             | **NativeWind** (Tailwind vocabulary) behind in-house primitives (§6) |
| Secrets on device   | `expo-secure-store` (Keychain / Keystore) (§4)                    |
| Local storage       | MMKV — persisted cache + non-sensitive preferences (§5)           |
| Auth                | JWT + rotating refresh, system-browser OAuth (PKCE), Sign in with Apple (§4) |
| Build / release     | **EAS** Build · Submit · Update (§9)                              |
| Crash reporting     | Sentry, behind a wrapper — a release gate (§8)                    |
| Lint/format         | ESLint (`eslint-config-expo` + boundary rules) + Prettier         |
| Tests               | Jest (`jest-expo`) + React Native Testing Library + MSW + Maestro (§10) |
| Local dev           | Dev build + `expo start` against the repo's compose stack (§11)   |

> Choices are concrete for determinism. Swapping one is a documented decision —
> never improvised per feature.

### 0.1 Add on demand — nothing is installed "for later"

Same rule as backend §0.1. The table is a **catalog of approved choices**.

- `[GUARD]` A package, config plugin, permission, usage-description string, EAS
  profile, notification channel or native capability exists **only if code in
  the app uses it**. An unused permission is not just clutter — it is a store
  rejection.
- A capability arrives **in the same change as its first consumer**, with all
  its pieces (package, config plugin, permission string, denied-state UI, tests),
  and is removed the same way.
- Not in the baseline, added on demand: push notifications, biometric unlock,
  Universal/App Links, offline writes, analytics, a component kit, i18n,
  in-app purchases.

---

## 1. Where the app lives & how it is organized

```text
<repo>/
├── backend/<name>-api/          # docs/backend/ARCHITECTURE.md §1
├── frontend/<name>-ui/          # docs/frontend/ARCHITECTURE.md §1
├── mobile/
│   ├── <name>-app/              # the mobile app — the one described below
│   └── <name>-<app>-app/        # a separate mobile app — only when requested
└── docs/                        # all documentation and related files
```

- `[GUARD]` Every mobile app is its own folder under `mobile/`: the main one is
  `<name>-app`, any other is `<name>-<app>-app`, where `<app>` is the name
  requested for it (`driver`, `courier`, anything), kebab-cased. `mobile/` is
  created only when a mobile app is requested.
- `[GUARD]` One codebase serves **both** iOS and Android. No platform is
  second-class: every feature works, and is tested, on both (§10).
- The mobile app is **not** part of the docker-compose stack and shares no
  package with the web app (§5 — the contract is generated, not shared).

### Inside an app (`mobile/<name>-app/`)

```text
app.config.ts        # the ONLY home of native configuration (§2)
eas.json             # build / submit / update profiles (§9)
src/
├── app/             # Expo Router: route files + layouts ONLY (§3)
├── features/        # business domains — self-contained vertical slices
│   └── <feature>/
│       ├── api/        # query/mutation hooks over the generated client
│       ├── components/ # UI used only inside this feature
│       ├── hooks/      # feature-specific stateful logic
│       ├── screens/    # the feature's screens (what route files render)
│       ├── stores/     # feature-scoped Zustand store (if needed)
│       ├── types/      # feature-local types + Zod schemas
│       └── index.ts    # the feature's PUBLIC API (exports its screens)
├── components/      # app-wide UI primitives (Screen, Text, Button, Input, ...)
└── shared/          # http client, generated API, storage, config, platform hooks
```

Rules — web §1 applies in full (colocation, promote only at ≥2 consumers,
public API via `index.ts`, no sibling-feature internals), plus:

- `[GUARD]` Dependency direction: `app/` may import `features/*` (public API
  only), `components/*` and `shared/*`. **Nothing imports from `app/`.**
  `features/*` and `components/*` may import `shared/*`; `shared/*` imports
  neither. Enforced by `eslint-plugin-boundaries`.
- `[GUARD]` No `ios/` or `android/` directory is committed (§2).

---

## 2. Native workflow: Continuous Native Generation + development builds

- `[GUARD]` The native projects are **generated artifacts**. `ios/` and
  `android/` are in `.gitignore` and produced by `expo prebuild` (locally or on
  EAS) from `app.config.ts` + config plugins. Nobody edits them by hand.
- `[GUARD]` Every native change — permission, entitlement, URL scheme, build
  setting, SDK key — is expressed in `app.config.ts`, through a library's
  **config plugin** or a small local plugin. If a library offers no plugin and
  needs manual native edits, write a plugin or pick another library.
- The app runs in a **development build** (`expo-dev-client`), not Expo Go.
  Expo Go is acceptable only before the first custom native dependency.
- Native dependencies are installed with `npx expo install` so versions stay
  matched to the SDK. `[GUARD]` `npx expo-doctor` passes.
- The **New Architecture** stays enabled. A library that requires disabling it
  is rejected.
- A change that alters native code (new native dependency, plugin, permission,
  SDK upgrade) requires a **new build**; it cannot ship over the air (§9).

---

## 3. Navigation (Expo Router)

- `[GUARD]` **Route files are a thin shell.** A file under `src/app/` imports a
  screen from a feature's public API, validates its route params, and renders
  the screen. No data fetching, no business logic, no styling beyond layout
  chrome.
- `_layout.tsx` files hold navigation structure (stack/tabs), global providers
  (root only) and the auth guard — nothing else.
- Route groups split the tree: `(auth)` for signed-out screens, `(app)` for
  signed-in ones. `[GUARD]` Protection is declared in the layout
  (`Stack.Protected` / redirect), never re-implemented per screen.
- `[GUARD]` **Params are untrusted input.** Route and deep-link params are
  parsed with Zod at the route file before a screen sees them; an invalid param
  renders the not-found screen, never a crash.
- Typed routes are enabled; navigation uses typed `href`s, not string
  concatenation.
- Filter/sort state that should survive navigation lives in route params (the
  mobile analogue of web §2.3 URL state); ephemeral UI state stays local.
- **Deep links are a baseline feature**: the app scheme is set at scaffold time
  (auth needs it, §4). Every screen reachable by link survives a cold start
  from that link, and a link to a protected screen while signed out resumes
  after login. Universal Links / App Links are added on demand (§7).

---

## 4. Authentication (pairs with backend §9)

- `[GUARD]` **The refresh token lives only in `expo-secure-store`**
  (Keychain / Keystore, device-only accessibility). The access token lives
  **only in memory**. Nothing auth-related is written to MMKV, AsyncStorage,
  the query cache, logs or crash reports.
- The HTTP client attaches the access token and, on `401`, runs the backend's
  rotating refresh. `[GUARD]` **Refresh is single-flight**: concurrent `401`s
  await one in-flight refresh. Two parallel refreshes would replay a consumed
  token and trip the backend's reuse detection, revoking the session.
- On cold start the session is restored from the stored refresh token before
  the first protected screen renders (the splash screen stays up meanwhile).
- **Logout clears everything**: revoke on the backend, delete the refresh
  token, drop the in-memory session, clear the query cache *and its persisted
  copy*, and unregister the push token when one exists.
- **Social login** runs in the **system browser** (`expo-auth-session`,
  authorization code + PKCE) and returns through the app's deep link. The
  provider's code/token goes to the backend, which verifies it and issues its
  **own** JWT pair. `[GUARD]` No provider client secret in the app; no login
  inside an embedded WebView.
- `[GUARD]` **Sign in with Apple is offered on iOS whenever any other social
  login is offered** (App Store Review Guideline 4.8). The backend supports
  Apple as a provider for that reason (backend §9.4).
- Biometric unlock is on demand: `expo-local-authentication` gating access to
  the stored refresh token. It protects the device session; it never replaces
  server-side authentication.
- UI authorization (hiding by role/scope) is a convenience; the backend is the
  enforcement point.

---

## 5. Data, state & the API contract

Web §2 (four layers, narrowest wins, server data never copied into
Zustand/`useState`) and web §6 (components never call the client directly)
apply. Mobile adds:

### 5.1 The contract is generated
- `[GUARD]` Types and Zod schemas for the backend API are **generated from its
  OpenAPI document** into `src/shared/api/generated/` and never edited by hand.
  Feature `api/` folders wrap the generated client in TanStack Query hooks.
  CI fails when the generated output is stale.
- Hand-written Zod schemas remain correct for anything that is *not* the
  backend API: third-party APIs, route params, storage payloads, env.
- No package is shared with the web app. Both generate from the same document,
  so the backend is the single source of truth and each app stays
  self-contained.

### 5.2 Online-first with a persisted cache
- TanStack Query is wired to the device: `onlineManager` ← NetInfo,
  `focusManager` ← `AppState`. Queries pause offline and refetch on reconnect
  and on return to the foreground.
- The query cache is **persisted to MMKV**, so a cold start renders the last
  known data immediately and revalidates.
- `[GUARD]` The persisted cache has a **version buster** (bumped when response
  shapes change), a bounded max age, and is **cleared on logout**. Queries
  holding sensitive data opt out of persistence.
- `[GUARD]` **Every data screen has a defined offline state** — stale data with
  an offline indicator, or an explicit empty/retry state. Never an endless
  spinner, never a raw error.

### 5.3 Storage roles
| Data                                   | Store                         |
|----------------------------------------|-------------------------------|
| Refresh token, any secret              | `expo-secure-store`           |
| Persisted query cache, preferences, flags | MMKV                       |
| Access token, session                  | memory (Zustand)              |
| Large files / downloads                | `expo-file-system`            |

`[GUARD]` AsyncStorage is not used. Secrets never enter MMKV.

### 5.4 Writes
- Writes require connectivity by default: the mutation fails fast offline and
  the UI says so.
- **Offline writes are on demand**, per feature: paused mutations persisted and
  replayed on reconnect, with optimistic UI and rollback. Every replayable
  write sends an `Idempotency-Key` (backend §9.5) generated *once* when the user
  acts, so a replay cannot double-apply.
- A local database as the source of truth (offline-first sync) is **out of
  scope** for this constitution; adopting it is an architecture decision.

### 5.5 API compatibility
Installed app versions live for months. Every request carries
`X-App-Version` and `X-App-Platform`. When the backend answers
`426 Upgrade Required` (backend §9.8), the app shows a blocking
**update required** screen linking to the store. Backend changes stay
backward-compatible with every version at or above the supported minimum.

---

## 6. UI, platform behavior & accessibility

Web §3 applies (logic in hooks, presentational components, composition).

- **NativeWind** provides the Tailwind vocabulary; design tokens (colors,
  spacing, radii, type scale) are defined once in `tailwind.config.js` and
  match the web app's tokens. `[GUARD]` No hard-coded hex colors or magic
  spacing in features — tokens only.
- **Primitives own the styling.** `src/components/` holds `Screen`, `Text`,
  `Button`, `Input`, `Pressable` wrappers etc. Features compose primitives; raw
  brand styling does not leak into feature code. No component kit by default.
- `[GUARD]` **Safe areas**: every screen is wrapped by the `Screen` primitive,
  which applies safe-area insets. Content never sits under the notch, home
  indicator, or Android system bars (edge-to-edge is on).
- `[GUARD]` **Keyboard**: no input is ever covered by the keyboard. Forms
  scroll the focused field into view, the return key advances/submits, and
  tapping outside dismisses.
- **Lists** of unbounded length are virtualized (`FlashList`) with stable keys
  and memoized rows. `[GUARD]` No `.map()` inside a `ScrollView` for
  server-driven lists.
- **Images** go through `expo-image` (caching, placeholders, explicit size).
- **Respect the platform** instead of forcing one look: native back gesture and
  Android hardware back work everywhere; platform differences are handled with
  `Platform.select` / `ios:` `android:` variants or `.ios.tsx`/`.android.tsx`
  files — not with a feature that only works on one OS.
- **Dark mode** follows the system setting through token variants.
- **Motion** runs on the UI thread (Reanimated) and honors reduced-motion.
- **Accessibility is non-negotiable** (`[GUARD]` via lint + role-based tests):
  every interactive element has an `accessibilityRole` and label; touch targets
  are ≥ 44×44 pt; text scales with the system font size without clipping;
  color is never the only signal; VoiceOver/TalkBack order is logical.
- Every async surface defines loading, empty, error and offline states.

---

## 7. Device capabilities (permissions, push, links)

- `[GUARD]` **Permissions are asked in context**, at the moment a feature needs
  them, after an in-app explanation — never in a burst at launch. Every
  permission has a designed **denied** state with a path to system settings,
  and the feature degrades rather than dead-ends.
- `[GUARD]` Usage-description strings and Android permissions are declared in
  `app.config.ts` for **exactly** the capabilities the code uses; strings say
  specifically why. Libraries that add permissions the app does not use have
  them blocked in config.
- **Push notifications (on demand):** Expo push token registered with the
  backend per device and user, refreshed on launch, removed on logout. The
  backend sends through a provider-agnostic `IPushSender` (backend §4) and
  prunes dead tokens from receipts. A notification tap routes through the same
  deep-link handling as any link (§3) — no second navigation path. Payloads
  carry identifiers, never sensitive content.
- **Universal Links / App Links (on demand):** added when the app must open
  from web or email links. The web host serves
  `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`;
  domains are declared in `app.config.ts`. The custom scheme remains for OAuth.
- Any other capability (camera, location, files, biometrics, background work)
  follows the same pattern: Expo module first, config plugin, in-context
  permission, denied state, both platforms.

---

## 8. Observability & resilience

- A **root error boundary** renders a recovery screen; route-level boundaries
  contain failures to one screen. A JS error never leaves a blank screen.
- `[GUARD]` Feature code logs and reports through `shared/` wrappers
  (`logger`, `reportError`) — never a vendor SDK directly.
- **Sentry is a release gate**: it is wired (config plugin, source maps
  uploaded for builds *and* OTA updates, release/environment tags matching the
  build profile) **before the first build reaches a tester**. It is not
  required at scaffold time (§0.1).
- The HTTP client sends a W3C `traceparent` header so a mobile failure links to
  its backend trace (backend §6).
- `[GUARD]` **No sensitive data leaves the device through telemetry**: no
  tokens, passwords, or personal data in logs, breadcrumbs or events; users are
  identified by ID only; session replay is off unless explicitly decided.
- `console.*` calls are stripped from production builds.

---

## 9. Build, release & updates (EAS)

- **Three variants from one `app.config.ts`** — `development`, `preview`,
  `production` — each with its own bundle identifier / application ID, display
  name and icon, so all three install side by side.
- **Three EAS build profiles** match them: `development` (dev client, internal
  distribution), `preview` (release build to TestFlight / Play internal
  testing), `production` (store build). Update **channels** carry the same
  names.
- `[GUARD]` **Nothing in the bundle is secret.** `EXPO_PUBLIC_*` values are
  public by definition and are Zod-parsed at startup; anything truly secret
  stays on the backend or in EAS secrets used only at build time.
- **Versioning:** the user-facing version comes from the release tag; build
  numbers are managed by EAS (remote version source, auto-increment); the
  **runtime version uses the fingerprint policy**, so an update can only reach
  builds whose native code matches.
- **Over-the-air updates (EAS Update):** for JavaScript/asset-only changes,
  rolled out gradually on the matching channel, with a documented rollback.
  `[GUARD]` An update never changes native code, permissions, or the reviewed
  purpose of the app — those go through a store build.
- **Pipeline** (pairs with the `release-pipeline` skill): pull requests run
  typecheck, lint, tests and `expo-doctor`; `main` publishes a preview update;
  **a version tag is the only thing that produces a production build**, which is
  submitted to the stores automatically while the public release stays a
  manual promotion.
- A build is not releasable until the store-readiness checklist in the
  `mobile-release` skill passes (privacy declarations, account deletion,
  permission strings, Sign in with Apple, both-platform E2E).

---

## 10. Testing pyramid (mirrors web §10)

- **Unit (most):** hooks, utils, stores, schemas — Jest (`jest-expo`).
- **Component:** React Native Testing Library, queried by role/label/text;
  **MSW** mocks the network. Behavior, not implementation.
- **E2E (fewest):** critical journeys as **Maestro** flows against a real build.
  `[GUARD]` Critical journeys pass on **both an iOS simulator and an Android
  emulator** before a release.
- `[GUARD]` Every feature ships with tests covering loading / empty / error /
  offline / success for data-driven screens. AAA, deterministic, isolated; mock
  only true externals (network, native modules).

---

## 11. Local development

- The mobile app is **not** a compose service. `docker compose up` (backend
  §10) provides the API and its dependencies; the app runs from
  `mobile/<name>-app` with `npx expo start` in a development build.
- The API URL depends on where the app runs — `EXPO_PUBLIC_API_URL` is:
  `http://localhost:8080` on the iOS simulator, `http://10.0.2.2:8080` on the
  Android emulator, and `http://<machine-LAN-IP>:8080` on a physical device.
- Native apps send no `Origin`, so CORS does not apply to them; nothing is
  added to the API's CORS policy for mobile.
- Cleartext HTTP is permitted **only in the development variant**. Preview and
  production talk HTTPS only.
- **Done means** the app runs on an iOS simulator *and* an Android emulator, a
  seeded dev user can sign in, and API calls succeed.

---

## 12. Code style

Web §11 applies in full (modern TypeScript, no `enum`, discriminated unions,
`satisfies`, function components + hooks only, self-documenting code over
comments). Mobile-specific:

- No inline style objects created during render in list rows; no anonymous
  components defined inside render.
- Platform branching is explicit and local (`Platform.select`, variant
  prefixes, platform file extensions) — never scattered `if (Platform.OS ...)`
  through business logic.
- Native module access is wrapped in a `shared/` hook or module so features do
  not import device APIs ad hoc and tests can mock one seam.
