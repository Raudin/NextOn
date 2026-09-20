// Metro config for this app.
//
// Two React Native ports live outside this app's directory, in ../packages:
// `border-beam-native` and `thinking-orbs-native`. They are consumed straight
// from source (their package.json points `main` at `src/index.ts`), so edits
// hot-reload with no build step. Metro/Babel already transpile their TS/TSX.
//
// Everything below exists because those packages are NOT under this app's
// root:
//
//   1. `watchFolders` — Metro only serves files it has crawled, and it crawls
//      this directory by default. Without this, a module resolved to
//      ../packages/... fails with a "not in the file map" style error.
//   2. `nodeModulesPaths` — a file inside ../packages has no node_modules of
//      its own to walk up to (pnpm keeps every dependency in THIS app's
//      node_modules), so peer imports like `@shopify/react-native-skia` would
//      not resolve from there. Metro tries these paths after the normal
//      hierarchical walk, so this is purely additive.
//   3. `extraNodeModules` — the same for the ports themselves (resolved to the
//      repo's source rather than whatever pnpm put in node_modules, which is
//      what makes live edits land), plus a pin on every native peer: Skia,
//      Reanimated and Worklets must exist as a SINGLE copy, or their JSI
//      bindings break. The subpath case works too — Metro joins the remaining
//      path onto the alias and then honours the package's `exports` map, which
//      is how `thinking-orbs/engine` resolves.
//
// The two ports are deliberately NOT dependencies of this app. pnpm's `file:`
// protocol hard-links a local directory into its store and installs the
// target's own dependencies inside `packages/`, which is churn we do not want
// in a source-of-truth directory (this is also how the upstream example app
// consumes them: watchFolders + extraNodeModules, no dependency entry).
//
// Note that this file only covers the BUNDLER. `tsc` needs the peers to be
// reachable from inside `packages/` too, and that cannot be expressed with
// tsconfig `paths`: Expo's Metro treats `paths` as aliases and uses only the
// first entry, so a types-only target (@types/react) breaks the bundle while a
// runtime target (node_modules/react) makes tsc infer React's untyped JS as
// `any`. `scripts/link-packages.mjs` solves it for every tool at once by
// linking this app's node_modules in as `packages/node_modules`.
//
// Keep the two `paths` entries in mobile/tsconfig.json and the two
// `import/core-modules` names in mobile/eslint.config.js in step with the two
// package aliases here — all three name the same two packages.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const projectRoot = __dirname;
const projectNodeModules = path.resolve(projectRoot, 'node_modules');
const packagesRoot = path.resolve(projectRoot, '..', 'packages');

const fromApp = (name) => path.resolve(projectNodeModules, name);

config.watchFolders = [packagesRoot];
config.resolver.nodeModulesPaths = [projectNodeModules];
config.resolver.extraNodeModules = {
  'border-beam-native': path.resolve(packagesRoot, 'border-beam-native'),
  'thinking-orbs-native': path.resolve(packagesRoot, 'thinking-orbs-native'),
  'thinking-orbs': fromApp('thinking-orbs'),
  react: fromApp('react'),
  'react-native': fromApp('react-native'),
  '@shopify/react-native-skia': fromApp('@shopify/react-native-skia'),
  'react-native-reanimated': fromApp('react-native-reanimated'),
  'react-native-worklets': fromApp('react-native-worklets'),
};

module.exports = config;
