import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Text, XStack, YStack } from "tamagui";

import { useSync } from "@/context/SyncContext";
import { getStoredSyncVersion } from "@/lib/sync";
import {
  buildDiagnosticsReport,
  formatDiagnosticsReport,
  resetTelemetry,
  type DiagnosticsReport,
} from "@/lib/telemetry";

/**
 * Development-only diagnostics panel.
 *
 * Rendered from the Profile screen behind `__DEV__`. It answers the two
 * questions that the perf work depends on and that nothing else in the app can
 * answer: how many backend requests each screen issues, and how many bytes our
 * key-value namespace is holding. The image disk cache is deliberately not
 * shown as a number — expo-image exposes no size API, so the report prints the
 * platform settings path instead of inventing a figure.
 */
export default function DiagnosticsSection() {
  const { isSyncing, lastSyncedAt, lastError, pendingCount, syncNow } = useSync();
  const { push } = useRouter();
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [syncVersion, setSyncVersion] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await buildDiagnosticsReport());
      setSyncVersion(await getStoredSyncVersion());
    } finally {
      setBusy(false);
    }
  }, []);

  // The first load deliberately resolves in a promise callback rather than
  // synchronously in the effect body: setting state synchronously here would
  // trigger a cascading render on every mount (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    buildDiagnosticsReport().then((next) => {
      if (!cancelled) {
        setReport(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReset = useCallback(async () => {
    resetTelemetry();
    await refresh();
  }, [refresh]);

  if (!report) {
    return null;
  }

  const storageKb = Math.round(report.storage.totalBytes / 1024);

  return (
    <YStack
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$4"
      p="$3.5"
      gap="$2"
    >
      <Pressable onPress={() => setExpanded((current) => !current)}>
        <XStack ai="center" jc="space-between" gap="$2">
          <YStack f={1}>
            <Text color="$orange10" fow="900" fos="$1" letterSpacing={0.5}>
              DEV DIAGNOSTICS
            </Text>
            <Text color="$color" fow="800" fos="$4">
              {report.requests.totalRequests} requests · {storageKb} KB cached
            </Text>
          </YStack>
          <Text color="$color" opacity={0.5} fos="$2" fow="700">
            {expanded ? "Hide" : "Show"}
          </Text>
        </XStack>
      </Pressable>

      {expanded ? (
        <>
          <Text color="$color" opacity={0.75} fos="$1" style={styles.mono}>
            {[
              `sync version ${syncVersion ?? "unknown"}${isSyncing ? " (syncing)" : ""}`,
              `pending mutations ${pendingCount}`,
              `last synced ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "never"}`,
              lastError ? `last sync error: ${lastError}` : "last sync error: none",
              "",
              formatDiagnosticsReport(report),
            ].join("\n")}
          </Text>

          <XStack gap="$2" mt="$1" flexWrap="wrap">
            <Pressable onPress={refresh} disabled={busy} style={styles.action}>
              <Text color="$color" fow="700" fos="$2" opacity={busy ? 0.5 : 1}>
                {busy ? "Refreshing..." : "Refresh"}
              </Text>
            </Pressable>
            <Pressable onPress={() => syncNow()} style={styles.action}>
              <Text color="$color" fow="700" fos="$2">
                Sync now
              </Text>
            </Pressable>
            <Pressable onPress={handleReset} style={styles.action}>
              <Text color="$color" fow="700" fos="$2">
                Reset counters
              </Text>
            </Pressable>
            {/* The two Skia effect ports, verified on a device rather than in Jest. */}
            <Pressable onPress={() => push("/effects")} style={styles.action}>
              <Text color="$color" fow="700" fos="$2">
                Visual effects
              </Text>
            </Pressable>
          </XStack>
        </>
      ) : null}
    </YStack>
  );
}

const styles = StyleSheet.create({
  mono: {
    fontFamily: "monospace",
    lineHeight: 16,
  },
  action: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(128,128,128,0.4)",
  },
});
