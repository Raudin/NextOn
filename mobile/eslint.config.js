// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

/**
 * Jest globals, declared explicitly.
 *
 * The `globals` package would be the usual way to get these, but it is only a
 * transitive dependency here (pnpm's strict layout does not hoist it), and
 * pulling in a package just to name eight identifiers is a poor trade.
 */
const jestGlobals = {
  jest: "readonly",
  describe: "readonly",
  it: "readonly",
  test: "readonly",
  expect: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
};

module.exports = defineConfig([
  expoConfig,
  {
    // `dist` is build output. `.expo` holds generated files (notably the typed
    // route declarations from expo-router), which are rewritten on every dev
    // server start and are not ours to lint.
    ignores: ["dist/*", "dist-verify/*", ".expo/*"],
  },
  {
    // The two React Native effect ports under ../packages are workspace-local
    // packages, not npm dependencies (see metro.config.js), so no package
    // resolver can find them in node_modules. Declaring them as core modules
    // tells `import/no-unresolved` — the one rule that flags them — that they
    // exist by construction rather than resolving them on every lint.
    //
    // `tsconfig.json` maps the same two names for tsc/editors, and
    // metro.config.js aliases them for the bundler. Without this entry ESLint
    // resolves them through eslint-import-resolver-typescript's cached view of
    // tsconfig, which is why a stale ESLint server can report
    // "Unable to resolve path to module 'border-beam-native'" while `tsc`,
    // `jest`, Metro and a fresh ESLint run all resolve it fine.
    settings: {
      "import/core-modules": ["border-beam-native", "thinking-orbs-native"],
    },
  },
  {
    // Tests and the Jest configuration run under Jest rather than in the app,
    // so the app-facing config does not know these identifiers.
    files: ["**/*.test.ts", "**/*.test.tsx", "jest.setup.js", "jest.config.js"],
    languageOptions: {
      globals: {
        ...jestGlobals,
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
      },
    },
  },
  {
    // Recommended by the `vercel-react-native-skills` rule
    // `rendering-no-falsy-and`: `{value && <Comp />}` crashes React Native in
    // production when `value` is a JSX-renderable falsy (`""` or `0`), because
    // the falsy value itself gets rendered as text outside a <Text>.
    //
    // The `react` plugin is already registered by `eslint-config-expo/flat`
    // (see its `flat/utils/react.js`), so only the rule is switched on here.
    // Both accepted idioms are allowed: the ternary (`x !== null ? … : null`)
    // and the explicit coercion (`!!x && …`).
    files: ["**/*.tsx"],
    rules: {
      "react/jsx-no-leaked-render": [
        "error",
        { validStrategies: ["ternary", "coerce"] },
      ],
    },
  },
]);
