---
name: mobile-ui-patterns
description: >-
  Templates and rules for building React Native screens that feel native on
  both iOS and Android: NativeWind design tokens and in-house primitives
  (Screen, Text, Button, Input), safe areas and edge-to-edge, keyboard-safe
  forms, virtualized lists, images, platform differences, dark mode,
  accessibility, and render performance. Use when building or reviewing any
  mobile screen, component, form or list.
---

# Mobile UI Patterns

Constitution (when the project has one): `docs/mobile/ARCHITECTURE.md` §6.
Logic-in-hooks, presentational components and composition are the
**`react-component-patterns` skill** — unchanged on mobile. This skill covers
what the device adds: notches, keyboards, touch, two platforms, and a UI thread
that drops frames when you are careless.

## Tokens once, primitives everywhere
Tokens live in `tailwind.config.js` (`theme.extend`): semantic colors
(`background`, `surface`, `foreground`, `muted`, `primary`, `danger`), spacing,
radii, font sizes — the same names as the web app's when there is one.
Feature code uses **tokens through primitives**; no hex values, no magic numbers.

```tsx
// src/components/Text.tsx
const variants = { title: "text-2xl font-semibold", body: "text-base", caption: "text-sm text-muted" } as const;

export function Text({ variant = "body", className, ...props }: TextProps & { variant?: keyof typeof variants }) {
  return <RNText className={cn("text-foreground", variants[variant], className)} {...props} />;
}
```
```tsx
// src/components/Button.tsx
export function Button({ label, onPress, loading, disabled, variant = "primary" }: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress} disabled={inactive}
      accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      className={cn("min-h-12 flex-row items-center justify-center rounded-xl px-4 active:opacity-80",
                    styles[variant], inactive && "opacity-50")}
    >
      {loading ? <ActivityIndicator /> : <Text className={labelStyles[variant]}>{label}</Text>}
    </Pressable>
  );
}
```
- Use `Pressable`, not `TouchableOpacity`. Give every press visible feedback
  (`active:` variant or an `android_ripple`).
- `min-h-12` (48) keeps the target ≥ 44×44 pt; add `hitSlop` for small icons.
- Text must be inside a `Text` — a bare string in a `View` crashes on native.
- No component kit by default; adding one is a documented decision.

## Every screen starts with `Screen`
```tsx
// src/components/Screen.tsx — safe areas in exactly one place
export function Screen({ children, scroll, edges = ["top", "bottom"], className }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: edges.includes("top") ? insets.top : 0,
    paddingBottom: edges.includes("bottom") ? insets.bottom : 0,
  };
  const Container = scroll ? KeyboardAwareScrollView : View;
  return (
    <Container className={cn("flex-1 bg-background", className)} style={padding}
               {...(scroll && { keyboardShouldPersistTaps: "handled", bottomOffset: 16 })}>
      {children}
    </Container>
  );
}
```
- Android is edge-to-edge: content draws behind the status and navigation bars
  unless inset. Screens under a native header or tab bar pass
  `edges={["bottom"]}` / `[]` — don't double-pad.
- Never hard-code a status-bar height or a bottom offset; read insets.
- Don't use `SafeAreaView` from `react-native` (iOS-only, deprecated).

## Keyboard-safe forms
```bash
npx expo install react-native-keyboard-controller     # + <KeyboardProvider> in the root layout
```
```tsx
export function LoginForm({ onSubmit }: Props) {
  const { control, handleSubmit } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  const passwordRef = useRef<TextInput>(null);
  return (
    <Screen scroll>
      <FormInput control={control} name="email" label="Email"
        keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress"
        returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
      <FormInput ref={passwordRef} control={control} name="password" label="Password"
        secureTextEntry autoComplete="current-password" textContentType="password"
        returnKeyType="done" onSubmitEditing={handleSubmit(onSubmit)} />
      <Button label="Sign in" onPress={handleSubmit(onSubmit)} />
    </Screen>
  );
}
```
- The focused field scrolls above the keyboard; the submit button stays
  reachable; tapping outside dismisses (`keyboardShouldPersistTaps="handled"`
  so the button still works on first tap).
- Set `keyboardType`, `autoComplete`, `textContentType`, `autoCapitalize` on
  every input — that is what enables password managers and OTP autofill.
- Return key walks the fields and submits on the last one.
- `Input` shows label, error text and helper text; the error is announced
  (`accessibilityLiveRegion="polite"` / `accessibilityHint`).

## Lists
```tsx
import { FlashList } from "@shopify/flash-list";

const renderOrder = ({ item }: { item: Order }) => <OrderRow order={item} />;   // stable reference

<FlashList data={orders} renderItem={renderOrder} keyExtractor={(o) => o.id}
           ItemSeparatorComponent={Separator} ListEmptyComponent={<EmptyState />}
           onEndReached={fetchNextPage} onEndReachedThreshold={0.5} />
```
- Server-driven or unbounded data → a virtualized list. `ScrollView` + `.map()`
  is only for short, fixed content.
- `OrderRow` is `memo`'d, takes primitives or a stable object, and creates no
  inline closures/styles that change per render.
- Never nest a vertical list inside a vertical `ScrollView`; use the list's
  header/footer components instead.
- Fixed row heights where possible; heavy rows defer images to `expo-image`.

## Images
```tsx
import { Image } from "expo-image";

<Image source={{ uri: product.imageUrl }} placeholder={{ blurhash: product.blurhash }}
       contentFit="cover" transition={150} style={{ width: 96, height: 96 }}
       accessibilityLabel={product.name} />
```
Always give an explicit size or aspect ratio (no layout jump), request
appropriately sized images from the API/CDN, and label informative images
(decorative ones: `accessible={false}`). Bundle icons as SVG or an icon font,
not PNG sets.

## Two platforms, one codebase
| Need                               | Tool                                              |
|------------------------------------|---------------------------------------------------|
| A different class                  | `ios:` / `android:` NativeWind variants           |
| A different value                  | `Platform.select({ ios: …, android: … })`         |
| A different component              | `Thing.ios.tsx` / `Thing.android.tsx`             |
| Shadows                            | `shadow-*` (iOS) **and** `elevation` (Android)    |

Respect each platform's conventions rather than cloning one onto the other:
native back gesture/hardware back, system date/time pickers and share sheet,
platform haptics (`expo-haptics`, sparingly), ripple vs. opacity feedback.
Check every screen on a small phone, a large phone, and with the system font
size turned up. Support tablets by letting layouts stretch with max-widths, not
by fixed pixel widths.

## Dark mode
`userInterfaceStyle: "automatic"` + `dark:` variants bound to tokens
(`bg-background` resolves per scheme) — never `isDark ? "#000" : "#fff"` in
components. Test both schemes; status-bar style follows the theme.

## Accessibility (every interactive element)
- `accessibilityRole` + `accessibilityLabel` (and `accessibilityState` for
  disabled/selected/checked/busy). Icon-only buttons always need a label.
- Group a row that acts as one control (`accessible` on the container) so the
  screen reader reads it once.
- Let text scale: no fixed heights around text, `numberOfLines` only where
  truncation is designed; cap extremes with `maxFontSizeMultiplier` rather
  than disabling scaling.
- Contrast ≥ 4.5:1; never color alone for meaning; focus order follows reading order.
- Verify with VoiceOver (iOS) and TalkBack (Android) on the critical journeys.

## Performance
- Measure before optimizing (the Perf Monitor / React DevTools profiler in a
  **release** build — dev builds are slow by design).
- Animations and gestures run on the UI thread with Reanimated + Gesture
  Handler; never animate layout with `setState` in a loop. Honor
  `useReducedMotion()`.
- Zustand via selectors; split contexts; keep expensive work out of render
  (`useMemo` only where measured).
- Screens fetch in parallel, not in waterfalls; prefetch on press-in for
  predictable navigation.
- Keep the JS bundle lean: no moment/lodash-wholesale; lazy-require heavy,
  rarely used screens.

## Checklist
- [ ] Built from primitives; tokens only — no hex colors or magic spacing.
- [ ] Wrapped in `Screen`; correct on notched iOS and edge-to-edge Android.
- [ ] No input hidden by the keyboard; return key flows; autofill attributes set.
- [ ] Unbounded data in a virtualized list with memoized rows.
- [ ] Images sized, cached, labeled.
- [ ] Verified on iOS **and** Android, light **and** dark, large font size.
- [ ] Roles/labels on every control; targets ≥ 44 pt; screen reader pass on critical flows.
- [ ] Loading / empty / error / offline states designed, not defaulted.
