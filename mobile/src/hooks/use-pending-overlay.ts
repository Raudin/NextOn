import { useCallback, useEffect, useState } from "react";

import { listPendingMutations } from "@/lib/db/outbox";
import {
  buildPendingOverlay,
  EMPTY_OVERLAY,
  type PendingOverlay,
} from "@/lib/db/reconcile";
import { useSyncQueue } from "@/context/SyncContext";

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
  // The queue count only. This used to subscribe to the whole sync context, so
  // every `isSyncing`/`lastError` transition re-rendered Home and Watchlist even
  // though neither of them renders sync progress.
  const { pendingCount } = useSyncQueue();
  // Starts at the shared constant, and `buildPendingOverlay` returns that same
  // constant for an empty queue, so the common case never changes the reference
  // and therefore never re-renders.
  const [overlay, setOverlay] = useState<PendingOverlay>(EMPTY_OVERLAY);

  const reload = useCallback(async () => {
    try {
      const entries = await listPendingMutations();
      setOverlay(buildPendingOverlay(entries));
    } catch {
      // Storage unavailable: fall back to "nothing pending" so the screen still
      // renders the server payload rather than failing.
      setOverlay(EMPTY_OVERLAY);
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
  }, [reload, pendingCount]);

  // No AppState listener here.
  //
  // There used to be one, and it duplicated SyncProvider's: on every foreground
  // the provider ran a sync (changing `lastSyncedAt`, which re-ran the effect
  // above) *and* this hook reloaded the overlay directly, so one resume did the
  // work twice. The provider's sync already re-runs the effect through
  // `pendingCount`, which is the value this hook actually depends on.

  return overlay;
};
