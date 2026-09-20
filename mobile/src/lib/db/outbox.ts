import { getLocalDatabase } from "@/lib/db/client";

/**
 * Offline mutation queue.
 *
 * A mutation that cannot reach the server is written here instead of being
 * lost, and replayed in order once connectivity returns. The screens update
 * their own state optimistically, so the user sees the change immediately
 * either way.
 *
 * Replay is safe without idempotency keys because every mutating endpoint in
 * this API is idempotent by construction: adding a watchlist entry that already
 * exists is a no-op, and marking an episode watched is an upsert. A duplicate
 * replay therefore converges on the same state rather than double-applying.
 */

export interface OutboxEntry {
  id: number;
  method: string;
  path: string;
  body: string | null;
  createdAt: number;
  attempts: number;
}

/** Attempts before a stuck entry is discarded, so the queue cannot wedge. */
export const MAX_OUTBOX_ATTEMPTS = 5;

/**
 * Adds a mutation to the queue.
 *
 * An identical mutation that is already pending is not queued twice: toggling a
 * watchlist entry off and on while offline should not replay as two adds.
 */
export const enqueueMutation = async (
  method: string,
  path: string,
  body?: string,
): Promise<void> => {
  const db = await getLocalDatabase();
  const serialized = body ?? null;

  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM outbox
      WHERE method = ? AND path = ? AND (body IS ? OR body = ?)
      LIMIT 1`,
    method,
    path,
    serialized,
    serialized,
  );
  if (existing) {
    return;
  }

  await db.runAsync(
    "INSERT INTO outbox (method, path, body, created_at, attempts) VALUES (?, ?, ?, ?, 0)",
    method,
    path,
    serialized,
    Date.now(),
  );
};

/** Pending mutations, oldest first — which is also replay order. */
export const listPendingMutations = async (): Promise<OutboxEntry[]> => {
  const db = await getLocalDatabase();
  const rows = await db.getAllAsync<{
    id: number;
    method: string;
    path: string;
    body: string | null;
    created_at: number;
    attempts: number;
  }>("SELECT * FROM outbox ORDER BY created_at ASC, id ASC");

  return rows.map((row) => ({
    id: row.id,
    method: row.method,
    path: row.path,
    body: row.body,
    createdAt: row.created_at,
    attempts: row.attempts,
  }));
};

export const countPendingMutations = async (): Promise<number> => {
  const db = await getLocalDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM outbox",
  );
  return row?.count ?? 0;
};

export const deleteMutation = async (id: number): Promise<void> => {
  const db = await getLocalDatabase();
  await db.runAsync("DELETE FROM outbox WHERE id = ?", id);
};

export const recordMutationAttempt = async (id: number): Promise<number> => {
  const db = await getLocalDatabase();
  await db.runAsync("UPDATE outbox SET attempts = attempts + 1 WHERE id = ?", id);
  const row = await db.getFirstAsync<{ attempts: number }>(
    "SELECT attempts FROM outbox WHERE id = ?",
    id,
  );
  return row?.attempts ?? 0;
};

export const clearOutbox = async (): Promise<void> => {
  const db = await getLocalDatabase();
  await db.runAsync("DELETE FROM outbox");
};
