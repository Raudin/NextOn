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

interface SyncContextValue {
  isSyncing: boolean;
  lastSyncedAt: number | null;
  lastError: string | null;
  /** Mutations still waiting to reach the server. */
  pendingCount: number;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

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

  return (
    <SyncContext.Provider
      value={{ isSyncing, lastSyncedAt, lastError, pendingCount, syncNow }}
    >
      {children}
    </SyncContext.Provider>
  );
};

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (context === undefined) {
    throw new Error("useSync must be used within a SyncProvider");
  }
  return context;
}
