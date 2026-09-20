#!/usr/bin/env node
/**
 * Links this app's `node_modules` into `../packages` (as
 * `packages/node_modules`) so the React Native ports living there can resolve
 * their peers — `react`, `react-native`, `@shopify/react-native-skia`,
 * `react-native-reanimated` and `thinking-orbs`.
 *
 * Why this is needed: the ports are consumed from source (see
 * `mobile/metro.config.js`), and TypeScript resolves a file's imports by
 * walking up from that file's directory. From `../packages/<port>/src` that
 * walk never reaches `mobile/node_modules`.
 *
 * A `tsconfig.json` `paths` entry cannot fix it: Expo's Metro honours `paths`
 * as aliases and uses only the FIRST entry, so a types-only target
 * (`@types/react`) breaks the bundle ("this package itself specifies a `main`
 * module field that could not be resolved"), while a runtime target
 * (`node_modules/react`) makes tsc resolve React's untyped JS and collapses
 * every inferred type to `any` (TS7016 across the app). One link restores the
 * ordinary node_modules walk for everything under `packages/`, and then every
 * tool — tsc, Metro, Jest — finds this app's single copy of each peer by
 * itself, with no aliasing to keep in step.
 *
 * Idempotent, and safe to delete: nothing in the app depends on it at runtime,
 * because Metro resolves the ports through explicit aliases.
 *
 * Run by `pnpm install` via the `postinstall` script in `mobile/package.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(scriptDir, "..", "node_modules");
const linkPath = path.resolve(scriptDir, "..", "..", "packages", "node_modules");

if (!fs.existsSync(target)) {
  console.warn(`[link-packages] no node_modules at ${target}, skipping`);
  process.exit(0);
}

const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
if (existing) {
  if (existing.isSymbolicLink()) {
    process.exit(0);
  }
  console.warn(`[link-packages] ${linkPath} exists and is not a link, leaving it alone`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(linkPath), { recursive: true });
fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
console.log(`[link-packages] linked ${linkPath} -> ${target}`);
