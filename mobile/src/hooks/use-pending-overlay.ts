import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { listPendingMutations } from "@/lib/db/outbox";
import {
  buildPendingOverlay,
  emptyOverlay,
  type PendingOverlay,
} from "@/lib/db/reconcile";
import { useSync } from "@/context/SyncContext";

/**
 * The set of changes made offline that the server does not know about yet.
 *
 * Screens layer this over whatever payload they were served, so an offline
 * mutation is still reflected after a restart instead of silently reverting to
 * the cached server state.
 *
 * Recomputed when the sync queue changes: once a mutation is pushed the overlay
 * shrinks, and the next delta pull brings the authoritative row, so nothing
 * stays hidden longer than it should.
 */
export const usePendingOverlay = (): PendingOverlay => {
  const { pendingCount, lastSyncedAt } = useSync();
  const [overlay, setOverlay] = useState<PendingOverlay>(emptyOverlay);

  const reload = useCallback(async () => {
    try {
      const entries = await listPendingMutations();
      setOverlay(buildPendingOverlay(entries));
    } catch {
      // Storage unavailable: fall back to "nothing pending" so the screen still
      // renders the server payload rather than failing.
      setOverlay(emptyOverlay());
    }
  }, []);

  useEffect(() => {
    // Deferred to a macrotask, matching SyncProvider: reload flips state, and
    // doing that synchronously in an effect body causes a cascading render on
    // mount (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      reload();
    }, 0);

    return () => clearTimeout(timer);
  }, [reload, pendingCount, lastSyncedAt]);

  // A mutation queued while the app was backgrounded must be reflected when the
  // user comes back, before the next sync attempt resolves.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        reload();
      }
    });
    return () => subscription.remove();
  }, [reload]);

  return overlay;
};
