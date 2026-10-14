/**
 * Reports which screen components React Compiler actually compiles.
 *
 * Why this exists: a `try`/`finally` anywhere inside a component makes the
 * compiler skip that ENTIRE component — silently, because
 * `@babel/plugin-react-compiler`'s `panicThreshold` defaults to 'NONE'. In
 * production there is no error and no warning; the component simply gets no
 * automatic memoisation.
 *
 * That matters here because most screens contain try/finally in their data
 * loading, and reasoning about re-renders ("the compiler handles that") is only
 * valid for components the compiler actually compiled. This script answers that
 * question per file instead of leaving it to inference.
 *
 * Run: node scripts/check-react-compiler-coverage.mjs
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, "..");
const pnpmDir = join(mobileRoot, "node_modules", ".pnpm");

/** The real directory of a package inside the pnpm store. */
const storePackageDir = (entryPrefix) => {
  const entry = readdirSync(pnpmDir).find((name) => name.startsWith(entryPrefix));
  if (!entry) {
    throw new Error(`no pnpm store entry starting with ${entryPrefix}`);
  }
  const versionStart = entry.search(/@(?=\d)/);
  const withoutVersion = versionStart > 0 ? entry.slice(0, versionStart) : entry;
  return join(pnpmDir, entry, "node_modules", ...withoutVersion.split("+").filter(Boolean));
};

const compilerDir = storePackageDir("babel-plugin-react-compiler@");
const babelCoreDir = storePackageDir("@babel+core@");

const compilerRequire = createRequire(join(compilerDir, "noop.js"));
const babelRequire = createRequire(join(babelCoreDir, "noop.js"));

const babel = babelRequire(babelCoreDir);
const compilerModule = compilerRequire(compilerDir);
const compiler = compilerModule.default ?? compilerModule;

const FILES = [
  "src/app/(tabs)/index.tsx",
  "src/app/(tabs)/discover.tsx",
  "src/app/(tabs)/watchlist.tsx",
  "src/app/(tabs)/profile.tsx",
  "src/app/_layout.tsx",
  "src/app/media/[type]/[id].tsx",
];

/** Compiles one file and reports which components succeeded or bailed. */
function compileFile(relativePath) {
  const absolute = join(mobileRoot, ...relativePath.split("/"));
  const code = readFileSync(absolute, "utf8");

  const successes = [];
  const failures = [];

  const logger = {
    logEvent(_filename, event) {
      const kind = event?.kind ?? "unknown";
      if (kind === "CompileSuccess") {
        successes.push(event.fnName ?? "<anonymous>");
        return;
      }
      if (kind === "CompileError" || kind === "CompileDiagnostic") {
        const detail = event?.detail?.reason ?? event?.detail ?? "";
        failures.push(
          `${event.fnName ?? "<anonymous>"}: ${String(detail).split("\n")[0]}`,
        );
      }
    },
  };

  try {
    babel.transformSync(code, {
      configFile: false,
      babelrc: false,
      filename: relativePath,
      presets: [],
      plugins: [[compiler, { panicThreshold: "NONE", logger }]],
      parserOpts: { plugins: ["jsx", "typescript"] },
    });
  } catch (error) {
    failures.push(`transform threw: ${error.message.split("\n")[0]}`);
  }

  return { successes, failures };
}

let anyBailed = false;

for (const file of FILES) {
  const { successes, failures } = compileFile(file);
  const name = file.replace("src/app/", "");

  if (failures.length === 0) {
    console.log(`COMPILED   ${name}  (${successes.length} component(s))`);
    continue;
  }

  anyBailed = true;
  console.log(`SKIPPED    ${name}  (${successes.length} compiled, ${failures.length} bailed)`);

  const compiledNames = [...new Set(successes)].join(", ") || "(none)";
  console.log(`             compiled: ${compiledNames}`);

  // Group the bail-outs by function so it is clear WHICH component is losing
  // its optimisation, not just that some are.
  const byFn = new Map();
  for (const failure of failures) {
    const [fn, ...rest] = failure.split(": ");
    const reason = rest.join(": ");
    if (!byFn.has(fn)) {
      byFn.set(fn, new Set());
    }
    byFn.get(fn).add(reason);
  }
  for (const [fn, reasons] of byFn) {
    console.log(`             bailed:   ${fn}`);
    for (const reason of reasons) {
      console.log(`                         ${reason}`);
    }
  }
}

console.log("");
console.log(
  anyBailed
    ? "Some components are NOT compiler-optimised (see SKIPPED above)."
    : "Every listed component is compiler-optimised.",
);
