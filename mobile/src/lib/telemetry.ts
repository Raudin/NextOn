/**
 * Development diagnostics.
 *
 * The perf work in this repository is only meaningful if it is measurable, and
 * the two numbers that matter — how many backend requests a screen issues, and
 * how many bytes our own storage namespace is holding — are invisible from the
 * UI otherwise. Counter bookkeeping is a few Map increments, so it stays on in
 * production too; the *rendering* of this data is gated behind `__DEV__`.
 *
 * The third number that matters (the expo-image disk cache) cannot be read from
 * JS at all: expo-image exposes no size getter and no cap. Read it from
 * Android Settings -> Apps -> NextOn -> Storage -> Cache, or iOS Settings ->
 * General -> iPhone Storage -> NextOn -> Documents & Data.
 */

import { auditCacheStorage, type CacheAudit } from "@/lib/cache";

export interface RequestRecord {
  /** Normalised path, with ids and query values collapsed: `/api/media/tv/:id`. */
  path: string;
  /** Screen that issued the request, or "unknown" outside a screen. */
  screen: string;
  durationMs: number;
  ok: boolean;
  /** True when the response came from the local cache with no network call. */
  fromCache: boolean;
  status?: number;
}

export interface PathCount {
  path: string;
  count: number;
  failures: number;
  cacheHits: number;
  avgMs: number;
}

export interface ScreenCount {
  screen: string;
  count: number;
}

export interface TelemetrySnapshot {
  sessionStartedAt: number;
  totalRequests: number;
  totalFailures: number;
  totalCacheHits: number;
  byPath: PathCount[];
  byScreen: ScreenCount[];
}

/**
 * Collapses a request path so counts group usefully: numeric ids become `:id`
 * and the query string is dropped, since `?filter_watched=true` and
 * `?media_id=123` are the same endpoint for counting purposes.
 */
export const normalizePath = (path: string): string => {
  const withoutQuery = path.split("?")[0];
  return withoutQuery.replace(/\/\d+/g, "/:id");
};

const startedAt = Date.now();

let currentScreen = "unknown";

interface PathAccumulator {
  count: number;
  failures: number;
  cacheHits: number;
  totalMs: number;
}

const byPath = new Map<string, PathAccumulator>();
const byScreen = new Map<string, number>();

let totalRequests = 0;
let totalFailures = 0;
let totalCacheHits = 0;

export const setTelemetryScreen = (screen: string) => {
  currentScreen = screen;
};

export const currentTelemetryScreen = () => currentScreen;

export const recordRequest = (record: Omit<RequestRecord, "path" | "screen"> & { path: string }) => {
  const path = normalizePath(record.path);
  const screen = currentScreen;

  const acc = byPath.get(path) ?? {
    count: 0,
    failures: 0,
    cacheHits: 0,
    totalMs: 0,
  };
  acc.count += 1;
  acc.totalMs += record.durationMs;
  if (!record.ok) acc.failures += 1;
  if (record.fromCache) acc.cacheHits += 1;
  byPath.set(path, acc);

  byScreen.set(screen, (byScreen.get(screen) ?? 0) + 1);

  totalRequests += 1;
  if (!record.ok) totalFailures += 1;
  if (record.fromCache) totalCacheHits += 1;
};

export const telemetrySnapshot = (): TelemetrySnapshot => ({
  sessionStartedAt: startedAt,
  totalRequests,
  totalFailures,
  totalCacheHits,
  byPath: Array.from(byPath.entries())
    .map(([path, acc]) => ({
      path,
      count: acc.count,
      failures: acc.failures,
      cacheHits: acc.cacheHits,
      avgMs: acc.count > 0 ? Math.round(acc.totalMs / acc.count) : 0,
    }))
    .sort((a, b) => b.count - a.count),
  byScreen: Array.from(byScreen.entries())
    .map(([screen, count]) => ({ screen, count }))
    .sort((a, b) => b.count - a.count),
});

export const resetTelemetry = () => {
  byPath.clear();
  byScreen.clear();
  totalRequests = 0;
  totalFailures = 0;
  totalCacheHits = 0;
};

export interface DiagnosticsReport {
  uptimeSeconds: number;
  requests: TelemetrySnapshot;
  storage: CacheAudit;
}

export const buildDiagnosticsReport = async (): Promise<DiagnosticsReport> => ({
  uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  requests: telemetrySnapshot(),
  storage: await auditCacheStorage(),
});

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/**
 * Human-readable report for the in-app diagnostics panel. Deliberately plain
 * text: it is meant to be read on a device and copied into a bug report.
 */
export const formatDiagnosticsReport = (report: DiagnosticsReport): string => {
  const lines: string[] = [];
  const { requests, storage } = report;

  lines.push(`session ${report.uptimeSeconds}s`);
  lines.push(
    `requests ${requests.totalRequests} (${requests.totalFailures} failed, ${requests.totalCacheHits} cached)`,
  );

  if (requests.byScreen.length > 0) {
    lines.push("");
    lines.push("requests by screen");
    for (const row of requests.byScreen) {
      lines.push(`  ${row.screen}: ${row.count}`);
    }
  }

  if (requests.byPath.length > 0) {
    lines.push("");
    lines.push("requests by endpoint");
    for (const row of requests.byPath) {
      const extra: string[] = [];
      if (row.cacheHits > 0) extra.push(`${row.cacheHits} cached`);
      if (row.failures > 0) extra.push(`${row.failures} failed`);
      lines.push(
        `  ${row.path}: ${row.count} @ ${row.avgMs}ms${extra.length ? ` (${extra.join(", ")})` : ""}`,
      );
    }
  }

  lines.push("");
  lines.push(`kv storage ${formatBytes(storage.totalBytes)} across ${storage.entryCount} cache keys`);
  if (storage.entries.length > 0) {
    lines.push("  top cache keys");
    for (const entry of storage.entries.slice(0, 10)) {
      lines.push(`    ${entry.key}: ${formatBytes(entry.bytes)}`);
    }
  }
  if (storage.otherKeys.length > 0) {
    lines.push("  non-cache keys");
    for (const entry of storage.otherKeys) {
      lines.push(`    ${entry.key}: ${formatBytes(entry.bytes)}`);
    }
  }

  lines.push("");
  lines.push("image disk cache is not measurable from JS:");
  lines.push("  Android Settings > Apps > NextOn > Storage > Cache");
  lines.push("  iOS Settings > General > iPhone Storage > NextOn");

  return lines.join("\n");
};
