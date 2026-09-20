# border-beam-native

React Native port of the [border-beam](https://beam.jakubantalik.com) web
library, rendered with [@shopify/react-native-skia](https://shopify.github.io/react-native-skia/)
and [react-native-reanimated](https://docs.swmansion.com/react-native-reanimated/).
Expo-compatible.

> **Status: beta — iOS-verified only.** All 5 types implemented (`sm`, `md`,
> `line`, `pulse-outside`, `pulse-inner`) × 4 color variants × dark/light.
> Visual parity tuning against the web demo is pending — see `PORT_PLAN.md`
> Phase 3 in the repo root.
>
> **Android: untested.** The code is pure Skia with no platform branches, so it
> *should* run on Android, but no one has verified it — treat it as
> experimental there and please report what you find. The known risk areas:
> `pulse-outside` renders its halo beyond the component's bounds at
> `zIndex: -1` behind an opaque child (ancestor `overflow` handling differs on
> Android), color management can shift saturated colors (sRGB vs wide gamut),
> and blur behavior may differ subtly.

## Install

```sh
npm install border-beam-native @shopify/react-native-skia react-native-reanimated
```

## Usage

```tsx
import { BorderBeam } from 'border-beam-native';

<BorderBeam size="md" colorVariant="ocean" theme="auto" borderRadius={16}>
  <Card />
</BorderBeam>
```

All web props are mirrored: `size`, `colorVariant`, `theme` (`'auto'` follows
the system scheme), `staticColors`, `duration`, `active` (fades in/out with
`onActivate` / `onDeactivate`), `borderRadius` (explicit — no DOM
auto-detection; falls back to the size preset), `brightness`, `saturation`,
`hueRange`, `strength`, plus `style` for the wrapping `View`.

## Using it in this repo (NextOn)

This port is not on npm, so it is vendored here and consumed **from source**.
It is deliberately *not* a dependency of `mobile/`; it is resolved by name
through three pieces of wiring:

- `mobile/metro.config.js` — `watchFolders` so Metro serves and watches files
  outside the app directory, plus `extraNodeModules` aliases for this package
  and for every native peer (Skia, Reanimated and Worklets must exist as a
  single copy, or their JSI bindings break).
- `mobile/tsconfig.json` — a `paths` entry so `tsc` and the editor see this
  package's source types.
- `mobile/eslint.config.js` — lists both ports under `import/core-modules`, so
  `import/no-unresolved` does not have to resolve a workspace-local package
  through ESLint's cached view of `tsconfig`. Without it, a stale ESLint server
  reports "Unable to resolve path to module 'border-beam-native'" while `tsc`,
  `jest` and Metro all resolve it correctly.
- `mobile/scripts/link-packages.mjs` (run by `pnpm install`) — links
  `mobile/node_modules` in as `packages/node_modules`. A file under `packages/`
  cannot otherwise walk up to the app's dependencies, which is what makes
  `react`, `react-native` and `@shopify/react-native-skia` resolvable to `tsc`
  inside this package. A `tsconfig` `paths` mapping cannot replace it: Expo's
  Metro treats `paths` as aliases and uses only the first entry, so a types-only
  target (`@types/react`) breaks the bundle while a runtime target
  (`node_modules/react`) makes tsc infer React's untyped JS as `any`.

To look at it: `pnpm start` in `mobile/`, then open the **effects bench**
(Profile → DEV DIAGNOSTICS → Visual effects, or the `/effects` route). It renders
all five presets with live controls for variant, `active`, `staticColors` and
the demo tuning preset.

### Expo Go

`@shopify/react-native-skia` and `react-native-reanimated` **are** included in
Expo Go — both are documented as `inExpoGo: true` for SDK 57 — so this package
runs in Expo Go provided the app's JS versions match the native versions Expo Go
links: Skia **2.6.2**, Reanimated **4.5.1**, Worklets **0.10.1**. Install with
`npx expo install @shopify/react-native-skia` and confirm with
`npx expo install --check`. A dev build (`npx expo run:android`) is only
required if you deliberately run a newer Skia than Expo Go ships.

### Typechecking

The app's `tsc` covers this package, since the app imports it:

```bash
cd mobile && pnpm exec tsc --noEmit
```

In isolation (run from the app directory so the compiler and the dependency link
are found):

```bash
cd mobile && pnpm exec tsc --noEmit -p ../packages/border-beam-native/tsconfig.json
```

Do not run `pnpm install`/`pnpm exec` *inside* this package: pnpm would install
its devDependencies into the package directory, which is pure churn — the link
above already supplies its peers.

## Tuning

`tuning` exposes the library's consumer hooks (border-beam 1.3.0) — the
equivalent of `--pulse-glow-boost`, `--beam-stroke-opacity`, `--beam-core-blur`
and friends:

```tsx
import { BorderBeam, WEB_DEMO_PULSE_PRESET } from 'border-beam-native';

<BorderBeam size="pulse-outside" tuning={WEB_DEMO_PULSE_PRESET}>…</BorderBeam>
```

Worth knowing: the web demo's `pulse-outside` card is **not** stock output — it
applies a 1.05× glow boost with 1.71× layer opacity. Untuned beams are
deliberately softer than the demo; `WEB_DEMO_PULSE_PRESET` reproduces it.

## How it works

- All visual data comes from `beam-spec.json`, generated from the web library
  (`npm run spec` in the repo root). To sync after a web update:
  `npm run spec && cp spec/beam-spec.json ports/react-native/border-beam-native/src/`.
- `rotateShader.ts` is an SkSL runtime effect mirroring BorderBeamKit's Metal
  shader line-for-line: CSS radial-gradient blob stacks, conic gradients, the
  rotating beam-window mask, rounded-rect ring SDF geometry, and the CSS
  filter chain (`hue-rotate` → `brightness` → `saturate`) via W3C
  feColorMatrix math.
- The beam angle and hue shift run as Reanimated derived values on the UI
  thread (Skia `useClock`); the JS thread is untouched per-frame.
- The SkSL is validated against the real Skia compiler (CanvasKit) in CI-able
  scripts; see `PORT_PLAN.md` Phase 3 for the parity harness.

## Local deviations from upstream

Kept deliberately small, so re-vendoring from
`packages/border-beam/ports/react-native/border-beam-native` stays a
copy-plus:

- `package.json` — `main`, `react-native` and `types` all point at
  `./src/index.ts` rather than a built `lib/`, so the app consumes the source
  and edits hot-reload with no build step. The upstream `build`/`typecheck`
  scripts, `devDependencies` and the committed `package-lock.json` were dropped
  with it (see "Typechecking" above).
- `src/LineBeam.tsx` — `blobEffect` is annotated `SkRuntimeEffect` instead of
  inferred. Without the annotation, declaration emit (`declaration: true`) fails
  with TS2742: the inferred type cannot be named without referencing a path
  inside `node_modules`.

Nothing else in `src/` was touched.

## License

MIT

