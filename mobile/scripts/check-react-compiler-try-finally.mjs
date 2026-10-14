/**
 * Verifies a React Compiler behaviour that silently affects every screen in
 * this app: a `try`/`finally` anywhere in a component makes the compiler skip
 * that ENTIRE component, with no error at build time and no warning in
 * production (the compiler's `panicThreshold` is 'NONE').
 *
 * If this is true, the practical consequence is that any component relying on
 * the compiler for memoisation must not contain try/finally — and the five
 * screens that do contain it are getting no automatic memoisation at all.
 *
 * pnpm does not hoist @babel/core to the top level, so both it and the compiler
 * plugin are resolved from their real store paths via createRequire rather than
 * by bare specifier.
 *
 * Run: node scripts/check-react-compiler-try-finally.mjs
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pnpmDir = join(here, "..", "node_modules", ".pnpm");

/**
 * The real directory of a package inside the pnpm store.
 *
 * pnpm names store entries `<scope>+<name>@<version>[_peerHash]` and puts the
 * package under `<entry>/node_modules/<scope>/<name>`, so the version suffix has
 * to be stripped before the path can be built. Both name forms occur here
 * (`@babel+core@…`, `babel-plugin-react-compiler@…`).
 */
const storePackageDir = (entryPrefix) => {
  const entry = readdirSync(pnpmDir).find((name) => name.startsWith(entryPrefix));
  if (!entry) {
    throw new Error(`no pnpm store entry starting with ${entryPrefix}`);
  }

  // Drop the trailing "@version" (and any peer-hash suffix) from the entry.
  //
  // Entries look like `babel-plugin-react-compiler@1.0.0` or
  // `@babel+core@7.29.7_supports-color@8.1.1`. The version always begins with a
  // digit, while the package name never contains an `@` other than the leading
  // scope marker, so anchoring the cut on `@` immediately followed by a digit
  // is unambiguous — anchoring on the *last* `@` would land inside the peer
  // hash instead.
  const versionStart = entry.search(/@(?=\d)/);
  const withoutVersion =
    versionStart > 0 ? entry.slice(0, versionStart) : entry;
  const segments = withoutVersion.split("+").filter(Boolean);

  return join(pnpmDir, entry, "node_modules", ...segments);
};

const compilerDir = storePackageDir("babel-plugin-react-compiler@");
const babelCoreDir = storePackageDir("@babel+core@");

const compilerRequire = createRequire(join(compilerDir, "noop.js"));
const babelRequire = createRequire(join(babelCoreDir, "noop.js"));

const babel = babelRequire(babelCoreDir);
const compilerModule = compilerRequire(compilerDir);
const compiler = compilerModule.default ?? compilerModule;

const diagnostics = [];

const makeOptions = (logger) => ({
  configFile: false,
  babelrc: false,
  filename: "probe.tsx",
  presets: [],
  plugins: [[compiler, { panicThreshold: "NONE", logger }]],
  parserOpts: { plugins: ["jsx", "typescript"] },
});

const WITHOUT_FINALLY = `
function Probe({ items }) {
  const [v, setV] = React.useState(0);
  const handler = () => { setV(v + 1); };
  return <div onClick={handler}>{items.map((i) => <span key={i}>{i}</span>)}</div>;
}
`;

const WITH_FINALLY = `
function Probe({ items }) {
  const [v, setV] = React.useState(0);
  const load = async () => {
    try { setV(v + 1); } catch (e) { console.warn(e); } finally { setV(0); }
  };
  const handler = () => { load(); };
  return <div onClick={handler}>{items.map((i) => <span key={i}>{i}</span>)}</div>;
}
`;

function compile(label, code) {
  diagnostics.length = 0;
  let compiled = false;
  let threw = null;

  const logger = {
    logEvent(_filename, event) {
      const kind = event?.kind ?? "unknown";
      const detail = event?.detail?.reason ?? event?.detail ?? "";
      diagnostics.push(`${kind}: ${String(detail).split("\n")[0]}`);
    },
  };

  try {
    const result = babel.transformSync(code, makeOptions(logger));
    // The compiler emits its memo-cache runtime calls when it compiles a
    // component; their absence means the component was skipped.
    compiled = /_c\(|useMemoCache|react-compiler-runtime/.test(result.code);
  } catch (error) {
    threw = error.message.split("\n")[0];
  }

  const bailed = diagnostics.some((d) => /CompileError|Bail|bail/i.test(d));

  console.log(`\n=== ${label} ===`);
  console.log(`  memo code emitted     : ${compiled}`);
  console.log(`  bail/error reported   : ${bailed}`);
  if (threw) console.log(`  threw                 : ${threw}`);
  for (const d of diagnostics.slice(0, 5)) {
    console.log(`    - ${d}`);
  }
  return { compiled, bailed };
}

const compilerPkg = JSON.parse(
  readFileSync(join(compilerDir, "package.json"), "utf8"),
);
console.log(`babel-plugin-react-compiler: ${compilerPkg.version}`);

const clean = compile("component WITHOUT try/finally (control)", WITHOUT_FINALLY);
const dirty = compile("component WITH try/finally (subject)", WITH_FINALLY);

console.log("\n=== VERDICT ===");
if (clean.compiled && !dirty.compiled) {
  console.log("CONFIRMED: try/finally makes the compiler skip the whole component.");
} else if (clean.compiled && dirty.compiled) {
  console.log("REFUTED: the component still compiled with try/finally present.");
} else {
  console.log("INCONCLUSIVE: the control did not compile, so this proves nothing.");
}

