# thinking-orbs-native

Dotted thought-orb loading indicators for React Native, rendered with Skia.
Port of [thinking-orbs](https://orbs.jakubantalik.com) — nine hand-tuned
animated states, two purpose-tuned sizes, automatic dark/light.

Vendored from `packages/thinking-orbs/ports/react-native/thinking-orbs-native`
in [Jakubantalik/Libraries.dev](https://github.com/Jakubantalik/Libraries.dev)
(MIT, © Jakub Antalik) — it is not published to npm yet. Consumed by `mobile/`
straight from source; see `mobile/metro.config.js`.

> **Status:** geometry and the Skia draw sequence are verified upstream
> (golden vectors + CanvasKit pixel diff). Still unverified: physical devices
> and Android.

## Install

```sh
npm install thinking-orbs-native @shopify/react-native-skia react-native-reanimated
```

## Usage

```tsx
import { ThinkingOrb } from 'thinking-orbs-native';

<ThinkingOrb state="searching" size={64} />;
```

Props mirror the web package: `state`, `size` (`64 | 20`), `theme`
(`'auto' | 'dark' | 'light'`), `speed`, `paused`, `accessibilityLabel`,
`style` — plus one addition, `displaySize`.

`displaySize` renders the orb at an arbitrary dp size while keeping the tuned
`size` preset's geometry: the Skia canvas is sized to `displaySize` and the
drawing is scaled into it, so it stays sharp at any factor (unlike a transform
on the view, which upscales an already-rasterised canvas).

### Theme

`theme="auto"` follows the **OS** appearance only (`useColorScheme()`): React
Native has no `data-theme` ancestor to walk, unlike the web build. A host app
that themes independently of the OS (this repo pins a `themeMode` in
`AuthContext`) must pass `theme` explicitly.

### Performance

The frame is built and recorded into an `SkPicture` on the **JS** thread every
frame and rasterised on the UI thread. In lists, drive `paused` from your own
viewport/focus tracking rather than rendering many live orbs.

## How parity is achieved

The geometry is not re-implemented: this package depends on
`thinking-orbs/engine` — the same compiled, React-free frame functions the web
component runs — and only translates the resulting dot list into Skia draw
calls. A frame arrives already z-sorted, radius-clamped and culled, so the
renderer draws the array in order and derives nothing.

Downstream of that dependency the upstream repo's `scripts/` parity harness
(`verify:golden`, `render:canvaskit`, `diff`) was dropped when vendoring: it
needs `canvaskit-wasm`/`pngjs` and browser-captured reference frames, none of
which belong in this repo. The `thinking-orbs` version pin in `package.json`
is what keeps the geometry in step.

## Using it in this repo (NextOn)

Vendored and consumed **from source**: it is not a dependency of `mobile/`, and
is resolved by name through `mobile/metro.config.js` (`watchFolders` +
`extraNodeModules`), `mobile/tsconfig.json` (`paths`),
`mobile/eslint.config.js` (`import/core-modules`) and
`mobile/scripts/link-packages.mjs`, which links `mobile/node_modules` in as
`packages/node_modules` so a file under `packages/` can walk up to the app's
dependencies (see the `border-beam-native` README for why a `tsconfig` `paths`
mapping cannot do that job).

`mobile/` installs `thinking-orbs` itself — the pin below is what keeps this
port's geometry in step with the web package's, since the frames come from
`thinking-orbs/engine` rather than from a re-implementation.

Check it on a device: **effects bench** (Profile → DEV DIAGNOSTICS → Visual
effects, or the `/effects` route) renders all nine states at both sizes, plus a
`displaySize` and a `speed` case.

```bash
cd mobile && pnpm exec tsc --noEmit -p ../packages/thinking-orbs-native/tsconfig.json
```

Do not run `pnpm install`/`pnpm exec` *inside* this package: it would install a
second copy of Skia/React Native here for no benefit.

## License

MIT
