---
name: mobile-auth
description: >-
  Templates for authentication in a React Native + Expo app against the JWT +
  rotating-refresh backend: refresh token in expo-secure-store, access token in
  memory, the single-flight refresh HTTP client, session bootstrap behind the
  splash screen, full logout, system-browser OAuth with PKCE, Sign in with
  Apple, and on-demand biometric unlock. Use when implementing or fixing mobile
  login, token storage, session restore, social login or logout.
---

# Mobile Auth

Constitution (when the project has one): `docs/mobile/ARCHITECTURE.md` §4;
backend counterpart `docs/backend/ARCHITECTURE.md` §9 (`api-security` skill).
The backend is the enforcement point; the app's job is to hold the session
safely and never leak it.

```bash
npx expo install expo-secure-store expo-application expo-splash-screen expo-auth-session expo-web-browser expo-crypto
```
(`expo-auth-session` / `expo-web-browser` only once social login is built.)

## Where each credential lives
| Credential     | Store                                   | Never in                         |
|----------------|-----------------------------------------|----------------------------------|
| Refresh token  | `expo-secure-store` (Keychain/Keystore) | MMKV, AsyncStorage, logs, Sentry |
| Access token   | memory (Zustand)                        | any disk storage                 |
| User profile   | TanStack Query cache                    | secure store                     |

```ts
// src/shared/storage/secureSession.ts
import * as SecureStore from "expo-secure-store";

const KEY = "refresh_token";
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,  // not synced, not in backups
};
export const secureSession = {
  read:  () => SecureStore.getItemAsync(KEY, options),
  write: (token: string) => SecureStore.setItemAsync(KEY, token, options),
  clear: () => SecureStore.deleteItemAsync(KEY, options),
};
```

## Session store (in the `auth` feature)
```ts
type SessionState = {
  status: "loading" | "signedIn" | "signedOut";
  accessToken: string | null;
  setTokens: (t: TokenPair) => Promise<void>;
  clear: () => Promise<void>;
};
export const useSession = create<SessionState>((set) => ({
  status: "loading", accessToken: null,
  setTokens: async ({ accessToken, refreshToken }) => {
    await secureSession.write(refreshToken);            // rotation: always store the NEW one
    set({ accessToken, status: "signedIn" });
  },
  clear: async () => { await secureSession.clear(); set({ accessToken: null, status: "signedOut" }); },
}));
```

## Single-flight refresh (the part that must be right)
The backend rotates refresh tokens and treats reuse of a consumed one as theft,
revoking the whole family. Several requests failing with 401 at once must
therefore share **one** refresh call.

```ts
// src/shared/api/refresh.ts
let inFlight: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  inFlight ??= (async () => {
    try {
      const refreshToken = await secureSession.read();
      if (!refreshToken) return null;
      const res = await fetch(`${env.EXPO_PUBLIC_API_URL}/auth/refresh`, {
        method: "POST", headers: baseHeaders(), body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) { await useSession.getState().clear(); return null; }   // revoked/expired → signed out
      const tokens = tokenPairSchema.parse(await res.json());
      await useSession.getState().setTokens(tokens);
      return tokens.accessToken;
    } finally { inFlight = null; }
  })();
  return inFlight;
}
```
A network failure during refresh is **not** a logout: keep the stored token and
surface the offline state. Only a definitive `400/401` from `/auth/refresh`
clears the session.

## HTTP client (`src/shared/api/httpClient.ts` — the generated client's mutator)
```ts
const baseHeaders = () => ({
  "Content-Type": "application/json",
  "X-App-Version": Application.nativeApplicationVersion ?? "0",   // expo-application
  "X-App-Platform": Platform.OS,
});

export async function http<T>(url: string, init: RequestInit = {}): Promise<T> {
  const send = (token: string | null) => fetch(`${env.EXPO_PUBLIC_API_URL}${url}`, {
    ...init,
    headers: { ...baseHeaders(), ...(token && { Authorization: `Bearer ${token}` }), ...init.headers },
  });

  let res = await send(useSession.getState().accessToken);
  if (res.status === 401) {
    const token = await refreshAccessToken();
    if (!token) throw new ApiError("unauthorized", 401);
    res = await send(token);                                       // retry ONCE
  }
  if (res.status === 426) { useAppGate.getState().requireUpdate(); throw new ApiError("upgrade_required", 426); }
  if (!res.ok) throw await toApiError(res);                        // normalized typed error
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
```
`426 Upgrade Required` flips a global gate that renders the blocking "update
required" screen (constitution §5.5; store link via `expo-linking`). Responses
are validated by the generated Zod schemas in the feature hooks.

## Bootstrap behind the splash screen
```tsx
SplashScreen.preventAutoHideAsync();

export function useSessionBootstrap() {
  useEffect(() => {
    (async () => {
      const token = await refreshAccessToken();          // restores the session if a refresh token exists
      if (!token) useSession.setState({ status: "signedOut" });
      await SplashScreen.hideAsync();
    })();
  }, []);
}
```
Called once in the root layout. The navigator renders nothing while
`status === "loading"`, so a signed-in user never sees the login screen flash.
Offline at launch with a stored token: treat as signed in and let queries show
cached data; the first successful refresh confirms it.

## Logout clears everything
```ts
export async function logout() {
  const refreshToken = await secureSession.read();
  await unregisterPushToken().catch(() => {});                     // only once push exists
  if (refreshToken) await http("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).catch(() => {});
  queryClient.clear();
  await persister.removeClient();                                  // the persisted cache too
  await useSession.getState().clear();                             // guard routes to (auth) by itself
}
```
Local cleanup always runs, even when the revoke call fails offline.

## Social login — system browser + PKCE
```ts
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();
const redirectUri = AuthSession.makeRedirectUri({ path: "auth/callback" });   // acme://auth/callback

export function useGoogleLogin() {
  const discovery = AuthSession.useAutoDiscovery("https://accounts.google.com");
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    { clientId: env.EXPO_PUBLIC_GOOGLE_CLIENT_ID, redirectUri, scopes: ["openid", "email", "profile"],
      responseType: AuthSession.ResponseType.Code, usePKCE: true },
    discovery);

  return async () => {
    const result = await promptAsync();
    if (result.type !== "success") return;                           // cancelled is not an error
    const tokens = await http<TokenPair>("/auth/external/google", { method: "POST",
      body: JSON.stringify({ code: result.params.code, codeVerifier: request?.codeVerifier, redirectUri }) });
    await useSession.getState().setTokens(tokens);
  };
}
```
- The **backend** exchanges the code (with the PKCE verifier) and issues its own
  JWT pair. The app holds a public client ID only — no client secret, ever.
- Always the system browser (`ASWebAuthenticationSession` / Custom Tabs). An
  embedded WebView for login is forbidden: it breaks SSO, and Google blocks it.
- Register the variant's scheme/redirect with each provider — the three app
  variants have three redirect URIs.

## Sign in with Apple (required on iOS alongside any social login)
```bash
npx expo install expo-apple-authentication     # + "expo-apple-authentication" in plugins, ios.usesAppleSignIn: true
```
```tsx
{Platform.OS === "ios" && (
  <AppleAuthentication.AppleAuthenticationButton
    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
    cornerRadius={8} style={{ height: 48 }}
    onPress={async () => {
      const cred = await AppleAuthentication.signInAsync({ requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL ] });
      const tokens = await http<TokenPair>("/auth/external/apple", { method: "POST",
        body: JSON.stringify({ identityToken: cred.identityToken, fullName: cred.fullName }) });
      await useSession.getState().setTokens(tokens);
    }} />
)}
```
- Apple returns name and email **only on the first sign-in** — send them with
  that first request; the backend must persist them then.
- Use Apple's own button component (its look is part of review).
- Users may hide their email (relay address); never require a "real" one.
- A user-cancelled prompt throws `ERR_REQUEST_CANCELED` — swallow it.
- App Store apps with account creation must also offer **in-app account
  deletion** (see `mobile-release` checklist).

## Biometric unlock (on demand)
Only when asked for. Gate the refresh token itself rather than a UI flag:

```ts
await SecureStore.setItemAsync(KEY, token, { ...options, requireAuthentication: true });
```
Reading the item then prompts Face ID / fingerprint. Needs the
`NSFaceIDUsageDescription` string via the `expo-secure-store` plugin config,
`expo-local-authentication` to check enrollment first, and a fallback to full
login when biometrics are unavailable or changed.

## Checklist
- [ ] Refresh token only in secure store (device-only); access token only in memory.
- [ ] One in-flight refresh shared by all 401s; rotated token always persisted.
- [ ] Network error during refresh ≠ logout; definitive rejection = signed out.
- [ ] Session restored behind the splash; no login-screen flash.
- [ ] Logout revokes, clears secure store, query cache **and** persisted cache.
- [ ] OAuth via system browser + PKCE; code exchanged by the backend; no secret in the app.
- [ ] Apple sign-in present on iOS when any social login is; first-login name/email sent.
- [ ] `X-App-Version` / `X-App-Platform` on every request; 426 shows the update screen.
- [ ] No token, password or reset code in logs, breadcrumbs or analytics.
