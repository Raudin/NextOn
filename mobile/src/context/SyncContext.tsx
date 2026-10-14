import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { countPendingMutations } from "@/lib/db/outbox";
import { runSync, type SyncResult } from "@/lib/sync";
import { useAuth } from "@/context/AuthContext";

/**
 * Drives delta sync.
 *
 * Sync runs on mount, whenever the app returns to the foreground, and on a slow
 * timer while mutations are still queued. That covers the cases that matter —
 * reconnecting after being offline, and coming back to the app after a while —
 * without taking a dependency on a connectivity library:
 *
 *  - A queued mutation is only ever created by a transport failure, so the
 *    queue's own non-emptiness is the signal that we were offline.
 *  - The periodic retry stops as soon as the queue drains, so an idle app makes
 *    no background requests.
 *
 * Sync is skipped entirely while signed out, and is guarded against overlapping
 * runs: a second concurrent pass could replay the outbox twice.
 */

/**
 * Two contexts, not one.
 *
 * These values change on very different clocks. `isSyncing` and `lastError`
 * flip several times per sync, and sync runs on mount, on every foreground and
 * on a 30s timer while anything is queued. `pendingCount` changes only when the
 * queue actually does.
 *
 * Holding them together meant every consumer re-rendered on every one of those
 * transitions, and the consumers are Home and Watchlist — the two screens that
 * sit on `usePendingOverlay`, which needs the queue and has no use for a syncing
 * flag. With the contexts split, a sync in progress no longer re-renders either
 * screen; only a real queue change does.
 *
 * The React Compiler is enabled (app.json), so the object literal below is not
 * the problem it would otherwise be — the cost being removed here is genuine
 * re-rendering driven by values a consumer never reads, not the identity of a
 * context value.
 */
interface SyncStatusValue {
  isSyncing: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
  syncNow: () => Promise<void>;
}

interface SyncQueueValue {
  /** Mutations still waiting to reach the server. */
  pendingCount: number;
}

const SyncStatusContext = createContext<SyncStatusValue | undefined>(undefined);
const SyncQueueContext = createContext<SyncQueueValue | undefined>(undefined);

/** Retry cadence while the outbox is non-empty. */
const RETRY_INTERVAL_MS = 30_000;

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { token } = useAuth();

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // A ref rather than state: the guard has to be read and written synchronously
  // at the start of a run, and state updates are batched.
  const inFlight = useRef(false);

  const syncNow = useCallback(async () => {
    if (!token || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setIsSyncing(true);

    try {
      const result: SyncResult = await runSync();
      setPendingCount(result.pending);
      setLastSyncedAt(Date.now());
      setLastError(null);
    } catch (error) {
      // Offline is the expected failure here, not an exceptional one, so it is
      // recorded for the diagnostics UI without being surfaced as an error
      // state to the user.
      setLastError((error as { message?: string } | null)?.message ?? String(error));
      try {
        setPendingCount(await countPendingMutations());
      } catch {
        // Storage itself is unavailable; leave the count as-is.
      }
    } finally {
      inFlight.current = false;
      setIsSyncing(false);
    }
  }, [token]);

  // Initial sync, and a fresh one whenever the account changes.
  //
  // Deferred to a macrotask rather than run inline: `syncNow` flips state, and
  // doing that synchronously inside an effect body causes a cascading render on
  // mount (react-hooks/set-state-in-effect). Deferring also keeps sync off the
  // first-paint path.
  useEffect(() => {
    if (!token) {
      return;
    }

    const timer = setTimeout(() => {
      syncNow();
    }, 0);

    return () => clearTimeout(timer);
  }, [syncNow, token]);

  // Foreground sync: the most likely moment for connectivity to have returned.
  useEffect(() => {
    if (!token) {
      return;
    }

    const subscription = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        if (state === "active") {
          syncNow();
        }
      },
    );

    return () => subscription.remove();
  }, [syncNow, token]);

  // Retry loop while anything is still queued.
  useEffect(() => {
    if (!token || pendingCount === 0) {
      return;
    }

    const timer = setInterval(syncNow, RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pendingCount, syncNow, token]);

  const statusValue: SyncStatusValue = { isSyncing, lastSyncedAt, lastError, syncNow };
  const queueValue: SyncQueueValue = { pendingCount };

  return (
    <SyncStatusContext.Provider value={statusValue}>
      <SyncQueueContext.Provider value={queueValue}>
        {children}
      </SyncQueueContext.Provider>
    </SyncStatusContext.Provider>
  );
};

/**
 * Sync progress and control.
 *
 * Use this only where a syncing indicator or diagnostics are actually rendered.
 */
export function useSyncStatus(): SyncStatusValue {
  const context = useContext(SyncStatusContext);
  if (context === undefined) {
    throw new Error("useSyncStatus must be used within a SyncProvider");
  }
  return context;
}

/**
 * The pending-mutation count alone.
 *
 * Preferred by anything that only cares whether work is queued, so that it is
 * not re-rendered by an unrelated sync transition.
 */
export function useSyncQueue(): SyncQueueValue {
  const context = useContext(SyncQueueContext);
  if (context === undefined) {
    throw new Error("useSyncQueue must be used within a SyncProvider");
  }
  return context;
}

/**
 * Both halves.
 *
 * Kept for callers that genuinely need progress and queue together (the
 * diagnostics panel). Anything that needs only one of them should use the
 * narrower hook above.
 */
export function useSync(): SyncStatusValue & SyncQueueValue {
  const status = useSyncStatus();
  const queue = useSyncQueue();
  return { ...status, ...queue };
}
