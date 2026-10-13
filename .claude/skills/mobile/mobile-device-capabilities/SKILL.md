---
name: mobile-device-capabilities
description: >-
  Method and templates for adding a native device capability to an Expo app the
  right way: in-context permission requests with a designed denied state,
  usage strings and config plugins in app.config.ts, push notifications via
  Expo's push service (token registration, channels, tap routing, backend
  sender), Universal Links / App Links, and the pattern for camera, location,
  files, biometrics and background work. Use when a feature needs a
  permission, push notifications, links from web/email, or any native module.
---

# Mobile Device Capabilities

Constitution (when the project has one): `docs/mobile/ARCHITECTURE.md` §7, §2.
**Everything here is on demand** — a capability is added in the same change as
the feature that uses it, and an unused permission is a store rejection, not
just clutter.

## The recipe (same for every capability)
1. **Expo module first** (`npx expo install expo-…`). A community library only
   when Expo has none — and only one that ships a config plugin and supports
   the New Architecture.
2. **Config plugin** entry in `app.config.ts`, including the usage string. No
   manual edits to `ios/` / `android/` (they are generated).
3. **Wrap it** in a hook/module under `src/shared/` (or the owning feature) so
   features don't import device APIs ad hoc and tests mock one seam.
4. **In-context permission** with a designed denied state (below).
5. **New build** — a native change cannot ship over the air.
6. **Both platforms**, on a real device where the simulator can't do it (push,
   camera, biometrics).

## Permissions: ask in context, design the "no"
```ts
// src/shared/hooks/usePermission.ts
export function usePermission(hook: () => [PermissionResponse | null, () => Promise<PermissionResponse>]) {
  const [status, request] = hook();
  const ensure = async () => {
    if (status?.granted) return true;
    if (status && !status.canAskAgain) return false;       // only Settings can fix it now
    return (await request()).granted;
  };
  return { granted: status?.granted ?? false, blocked: status ? !status.granted && !status.canAskAgain : false, ensure };
}
```
```tsx
function ScanButton() {
  const camera = usePermission(useCameraPermissions);
  if (camera.blocked) return <PermissionBlocked what="camera" onOpenSettings={Linking.openSettings} />;
  return <Button label="Scan code" onPress={async () => { if (await camera.ensure()) openScanner(); }} />;
}
```
- **When**: at the moment the user invokes the feature — never on launch, never
  several prompts in a row. For a high-stakes prompt (notifications, location)
  show a short in-app explanation first; the system dialog can be shown only
  once on iOS.
- **Denied**: the feature offers an alternative or explains what is missing and
  links to Settings. The rest of the app keeps working.
- **Least privilege**: foreground location before background; photo picker
  (no permission needed) before full library access; approximate before precise.

Declare exactly what is used, with a specific reason:

```ts
plugins: [
  ["expo-camera", { cameraPermission: "Scan the QR code on your order to confirm pickup." }],
],
android: { blockedPermissions: ["android.permission.RECORD_AUDIO"] },   // strip what a library adds but you don't use
```
"This app needs camera access" gets rejected; say what the user gets.

## Push notifications (Expo push service)
```bash
npx expo install expo-notifications expo-device     # + "expo-notifications" in plugins
```
Needs a physical device, FCM credentials for Android and an APNs key for iOS
(both uploaded to EAS: `eas credentials`).

**Register after login, in context:**
```ts
// src/features/notifications/registerPush.ts
export async function registerPush() {
  if (!Device.isDevice) return;
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "General", importance: Notifications.AndroidImportance.DEFAULT });

  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return;                                    // app works without push

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await registerDevice({ token, platform: Platform.OS, deviceId: await getInstallationId() });
}
```
- Call it again on every launch while signed in (tokens rotate); the backend
  upserts by device.
- **Logout unregisters** the token (`mobile-auth` logout) — otherwise the next
  user of the phone receives the previous user's notifications.
- Android 13+ needs the runtime permission and at least one channel before the
  prompt appears; create channels per notification category users may mute.

**Foreground behavior and taps — one navigation path:**
```ts
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export function useNotificationRouting() {
  const response = Notifications.useLastNotificationResponse();     // covers cold start too
  useEffect(() => {
    const url = notificationData.safeParse(response?.notification.request.content.data);
    if (url.success) router.push(url.data.url as Href);             // same deep links as everywhere
  }, [response]);
}
```
Payloads carry a relative in-app `url` (Zod-validated) and identifiers — never
sensitive content; lock screens are public. The auth guard applies as for any
link.

**Backend side** (backend constitution §4, on demand):
- `POST /devices` / `DELETE /devices/{id}` — token per user + device.
- `IPushSender` in Application; the Expo implementation in Infrastructure posts
  to `https://exp.host/--/api/v2/push/send` in batches (≤ 100), from the
  **Worker**, never inline in a request.
- Fetch **receipts** afterwards and delete tokens that return
  `DeviceNotRegistered`; back off on rate limits.
- Sending directly through FCM/APNs later is a swap behind `IPushSender`.

## Universal Links (iOS) / App Links (Android)
Add when links from the web, email or SMS must open the app. The custom scheme
stays for OAuth.

```ts
ios: { associatedDomains: ["applinks:app.example.com"] },
android: { intentFilters: [{ action: "VIEW", autoVerify: true,
  data: [{ scheme: "https", host: "app.example.com", pathPrefix: "/orders" }],
  category: ["BROWSABLE", "DEFAULT"] }] },
```
The **web host** must serve, over HTTPS, without redirects, as JSON:
- `/.well-known/apple-app-site-association` — team ID + bundle ID + paths
- `/.well-known/assetlinks.json` — package name + the **signing certificate
  SHA-256** (take it from `eas credentials`; Play App Signing has its own)

Each variant has its own identifier, so list every variant that should open
links (usually production + preview on a staging domain). Path → screen mapping
is automatic when web paths mirror the app's routes; otherwise add a redirect
in `src/app/+native-intent.tsx`. Unmatched paths stay in the browser — only
claim prefixes the app actually handles. Verify:

```bash
npx uri-scheme open "https://app.example.com/orders/123" --ios
adb shell pm get-app-links com.acme.app          # Android verification state
```

## Other capabilities — same recipe
| Need                 | Module                                   | Watch out for                                   |
|----------------------|------------------------------------------|-------------------------------------------------|
| Camera / scanning    | `expo-camera`                            | simulator has no camera — test on device        |
| Pick photo/file      | `expo-image-picker`, `expo-document-picker` | system picker needs no library permission    |
| Location             | `expo-location`                          | background location = extra review + justification |
| Biometrics           | `expo-local-authentication` (`mobile-auth`) | fall back when not enrolled                  |
| Files / downloads    | `expo-file-system`, `expo-sharing`       | clean up cache; no secrets in files             |
| Haptics              | `expo-haptics`                           | meaningful moments only                         |
| Background tasks     | `expo-background-task`                   | OS decides when it runs — never rely on timing  |
| Calendar / contacts  | `expo-calendar`, `expo-contacts`         | high-sensitivity data; strong justification     |

## Checklist
- [ ] Capability added with its first consumer; nothing declared "for later".
- [ ] Config plugin in `app.config.ts`; specific usage string; unused permissions blocked.
- [ ] Permission requested in context; blocked/denied state designed and tested.
- [ ] Device API wrapped behind one hook/module; mocked in tests.
- [ ] Push: token registered per device, refreshed on launch, removed on logout;
      taps route through validated deep links; no sensitive payloads.
- [ ] Links: association files served correctly; cold-start + signed-out tested.
- [ ] Verified on a physical iOS **and** Android device; shipped in a new build.
