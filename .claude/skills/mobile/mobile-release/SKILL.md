---
name: mobile-release
description: >-
  Version-driven release engineering for an Expo app with EAS: eas.json build
  profiles for the development / preview / production variants, credentials
  and signing, versioning (remote build numbers, fingerprint runtime version),
  EAS Submit to TestFlight and Play, EAS Update over-the-air rollouts and
  rollback, Sentry as a release gate, the forced-update mechanism, the GitHub
  Actions jobs, and the App Store / Google Play readiness checklist. Use when
  setting up mobile builds or CI, shipping to testers or the stores, publishing
  an OTA update, or preparing a store submission.
---

# Mobile Release (EAS build · submit · update)

Constitution (when the project has one): `docs/mobile/ARCHITECTURE.md` §8, §9.
Rule zero is the `release-pipeline` skill's: **a production release happens
because a version was cut** — the tag is the only trigger. This skill is the
mobile half of that pipeline; never run a second, competing one.

## 1. Profiles (`eas.json`)
```jsonc
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "base":        { "node": "22.x", "env": { } },
    "development": { "extends": "base", "developmentClient": true, "distribution": "internal",
                     "channel": "development", "env": { "APP_VARIANT": "development" } },
    "preview":     { "extends": "base", "distribution": "store",
                     "channel": "preview", "autoIncrement": true,
                     "env": { "APP_VARIANT": "preview", "EXPO_PUBLIC_API_URL": "https://api.staging.example.com" } },
    "production":  { "extends": "base", "distribution": "store",
                     "channel": "production", "autoIncrement": true,
                     "env": { "APP_VARIANT": "production", "EXPO_PUBLIC_API_URL": "https://api.example.com" } }
  },
  "submit": {
    "preview":    { "ios": { "ascAppId": "…" }, "android": { "track": "internal" } },
    "production": { "ios": { "ascAppId": "…" }, "android": { "track": "production", "releaseStatus": "draft" } }
  }
}
```
- One profile per variant in `app.config.ts` (`mobile-scaffolder` §3); the
  channel has the same name.
- `EXPO_PUBLIC_*` values are **public** — fine here. Real secrets
  (`SENTRY_AUTH_TOKEN`, store API keys) are EAS environment secrets, used at
  build time only, never referenced by app code.
- Add a profile only when it is used (no `production` profile on day one).

## 2. Credentials & signing
```bash
eas login && eas init                 # links the project (extra.eas.projectId)
eas credentials                       # let EAS generate and hold signing credentials
```
- Let EAS manage the iOS distribution certificate / provisioning profiles and
  the Android upload keystore; enable **Play App Signing**.
- CI authenticates with `EXPO_TOKEN`; store submission with an **App Store
  Connect API key** and a **Google Play service account** stored in EAS — no
  personal Apple ID password in CI.
- Each variant's bundle identifier / package must exist in App Store Connect /
  Play Console before its first submit. The very first Android upload to a new
  Play app is manual.

## 3. Versioning
| Value                      | Source                                              |
|----------------------------|-----------------------------------------------------|
| `version` (user-facing)    | the release tag (`v1.4.0` → `1.4.0`), written by the release workflow |
| `buildNumber` / `versionCode` | EAS, `appVersionSource: "remote"` + `autoIncrement` |
| `runtimeVersion`           | `{ policy: "fingerprint" }` — hash of the native project |

The fingerprint runtime version is what makes OTA safe: an update is delivered
only to builds whose native code matches the one it was built against.

## 4. Build and submit
```bash
eas build  --profile development --platform all                    # dev client for the team
eas build  --profile preview     --platform all --auto-submit      # → TestFlight + Play internal
eas build  --profile production  --platform all --auto-submit      # → stores (tag-triggered, in CI)
```
Production submit uploads the build; the **public release is a manual
promotion** in App Store Connect / Play Console (review, phased release) — the
mobile equivalent of the approval gate on production deploys. Use phased
release (iOS) and staged rollout (Android) for anything non-trivial.

## 5. Over-the-air updates (EAS Update)
```bash
eas update --channel preview    --message "fix: order total rounding"
eas update --channel production --message "fix: order total rounding" --rollout-percentage 10
eas update:edit                         # raise the rollout once crash-free rate holds
eas update:rollback                     # back to the previous update or the embedded bundle
```
**What may ship over the air:** JavaScript and asset changes — bug fixes, copy,
styling, behavior behind existing native capabilities.
**What needs a store build:** anything that changes the fingerprint (new native
dependency, config plugin, permission, SDK upgrade) or changes what the app
*is* compared to what was reviewed.

- Roll out gradually and watch Sentry for the new release before going to 100%.
- An update for runtime version X never reaches builds on Y — after a new store
  build, older builds stop receiving fixes; decide the support window.
- Bump the persisted-cache buster (`mobile-data-offline`) when a response shape
  changed, or an update will rehydrate stale data into new code.
- Updates apply on the next cold start by default; a critical fix can prompt a
  reload via `expo-updates`, never mid-task.

## 6. Sentry — a gate before the first tester build
```bash
npx expo install @sentry/react-native
```
```ts
plugins: [["@sentry/react-native/expo", { organization: "acme", project: "acme-app" }]],
```
```ts
// src/shared/observability/reporting.ts — the only file that imports the SDK
Sentry.init({
  dsn: env.EXPO_PUBLIC_SENTRY_DSN, environment: variant, enabled: !__DEV__,
  tracesSampleRate: 0.2, sendDefaultPii: false,
  beforeBreadcrumb: scrubBreadcrumb,              // strip tokens, emails, request bodies
});
export const reportError = (error: unknown, context?: Record<string, unknown>) =>
  Sentry.captureException(error, { extra: context });
export const identify = (userId: string | null) => Sentry.setUser(userId ? { id: userId } : null);
```
- `metro.config.js` uses `getSentryExpoConfig` so source maps carry debug IDs;
  EAS Build uploads them with `SENTRY_AUTH_TOKEN`; after each `eas update`
  upload the update's maps too (`npx sentry-expo-upload-sourcemaps dist`).
  Verify a test error shows a **readable** stack trace on both platforms.
- Feature code calls `logger` / `reportError` from `shared/` — never `Sentry.*`.
- User identified by ID only; no tokens, passwords or personal data; session
  replay off unless explicitly decided.
- The HTTP client sends `traceparent` so an error links to the backend trace.

## 7. Forced update
Old versions stay installed for months. Every request sends `X-App-Version` and
`X-App-Platform` (`mobile-auth` HTTP client). When the backend's
minimum-version check answers `426 Upgrade Required` (backend constitution
§9.8), the app shows a blocking screen with a store link. Raise the minimum
only when an old version is unsafe or truly unsupportable; otherwise keep the
API backward-compatible.

## 8. CI (the mobile jobs of `release-pipeline`)
```yaml
# ci.yml — on pull_request, paths: ["mobile/**"]
mobile:
  defaults: { run: { working-directory: mobile/acme-app } }
  steps:
    - uses: actions/checkout@<pinned-sha>
    - uses: actions/setup-node@<pinned-sha>
      with: { node-version: 22, cache: npm, cache-dependency-path: mobile/acme-app/package-lock.json }
    - run: npm ci
    - run: npm run typecheck && npm run lint && npm test -- --ci
    - run: npx expo-doctor
    - run: npm run api:generate && git diff --exit-code src/shared/api/generated   # contract not stale
```
```yaml
# on push to main → preview update;  on release published (tag v*) → production build
- uses: expo/expo-github-action@<pinned-sha>
  with: { eas-version: latest, token: "${{ secrets.EXPO_TOKEN }}" }
- run: eas update --channel preview --message "${{ github.event.head_commit.message }}" --non-interactive   # main
- run: eas build --profile production --platform all --auto-submit --non-interactive --no-wait               # tag
```
A native change merged to `main` needs a new preview **build**, not an update —
detect it by comparing fingerprints (`npx @expo/fingerprint`) and build when it
changed. Before promoting a production build: Maestro flows green on iOS and
Android against the preview build (`mobile-testing`).

## 9. Store readiness (before the first submission, re-checked on big changes)
**Both stores**
- [ ] App name, icon (no alpha on iOS), splash, screenshots for required sizes.
- [ ] Privacy policy URL; support URL / contact.
- [ ] **In-app account deletion** if accounts can be created in the app.
- [ ] A working **demo account** in the review notes (plus steps for any
      gated feature).
- [ ] No placeholder content, dead buttons, debug menus or references to the
      other platform.
- [ ] Every declared permission is used and has a specific usage string.

**App Store (iOS)**
- [ ] **Sign in with Apple** present if any third-party login is offered.
- [ ] App Privacy "nutrition labels" match what the app and its SDKs collect
      (Sentry, analytics); privacy manifest reasons declared for required APIs.
- [ ] Export compliance answered (`ios.config.usesNonExemptEncryption: false`
      when only standard HTTPS is used).
- [ ] Digital goods use in-app purchase; no links to external payment for them.

**Google Play (Android)**
- [ ] Data safety form matches actual collection; content rating done.
- [ ] Target API level meets Play's current requirement (follows the Expo SDK —
      keep the SDK current).
- [ ] Background location / all-files / other sensitive permissions justified
      or removed.
- [ ] New personal developer accounts: closed-testing requirement satisfied
      before production access.

## Deliverables
```text
mobile/<name>-app/eas.json
.github/workflows/…                 # mobile jobs inside the existing workflows
docs/mobile/RELEASE.md              # how to cut a release, publish/roll back an update, raise the minimum version
```

## Checklist
- [ ] Profiles match variants and channels; no unused profile.
- [ ] Credentials held by EAS; CI uses tokens/API keys, no personal passwords.
- [ ] Remote build numbers; fingerprint runtime version; version from the tag.
- [ ] Production build only from a tag; public release manually promoted.
- [ ] OTA: JS-only, gradual, rollback rehearsed once.
- [ ] Sentry wired with readable stack traces **before** the first tester build.
- [ ] Forced-update screen works against a raised minimum version.
- [ ] Store-readiness list passes for both stores.
