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
 * The resource a mutation acts on, used to decide what a new entry supersedes.
 *
 * A DELETE carries its identity in the path (`/api/watchlist/603`), while a
 * POST carries it in the body, so both sides are reduced to the same shape. A
 * path with no extractable id falls back to the path itself, which keeps
 * unrelated endpoints from being treated as the same resource.
 */
export const resourceKeyFor = (
  method: string,
  path: string,
  body?: string | null,
): string => {
  const barePath = path.split("?")[0];
  const pathIdMatch = barePath.match(/^(.*)\/(\d+)$/);
  const collection = pathIdMatch ? pathIdMatch[1] : barePath;
  const idFromPath = pathIdMatch ? pathIdMatch[2] : undefined;

  // Only a create-with-body has an id outside the path. Never read an id out of
  // a DELETE body, and never out of a POST whose body identifies an *episode*
  // rather than the resource: `/api/watched` would otherwise look like the same
  // resource as `/api/watched/5`.
  //
  // The id is appended to the *collection* path, not to the raw path, so that
  // `/api/watchlist` + body {id:603} and `/api/watchlist/603` produce the same
  // key. Building it from the raw path instead would give `/api/watchlist/603`
  // for the delete, which can never equal the add's key.
  let id = idFromPath;
  if (!id && method === "POST" && body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.id === "number") {
        id = String(parsed.id);
      }
    } catch {
      // A body we cannot parse has no identity to share; fall through to the
      // collection so it can only ever supersede itself.
    }
  }

  return id ? `${collection}:${id}` : collection;
};

/** The shape compared when deciding whether a queued mutation is a duplicate. */
interface QueuedMutation {
  method: string;
  path: string;
  body: string | null;
}

/**
 * Decides whether a new mutation should be queued, given the pending entries.
 *
 * A mutation is dropped only when it is byte-identical to the *most recent*
 * pending entry for the same resource. Comparing against the whole queue (as
 * this did) is wrong in both directions:
 *
 *  - It suppresses a genuine state change. Marking an episode watched and then
 *    unmarking it queues POST /api/watched and DELETE /api/watched. The DELETE
 *    matched the POST already in the queue, so it was discarded and the episode
 *    stayed marked.
 *  - It is unnecessary for the duplicates it was meant to stop. A repeated
 *    identical mutation is idempotent server-side, and comparing with the
 *    latest entry for the resource already collapses it.
 *
 * `pending` may be in any order; only the newest entry per resource matters, so
 * it is chosen by `createdAt`/`id` rather than by array position.
 */
export const shouldEnqueue = (
  method: string,
  path: string,
  body: string | null,
  pending: (QueuedMutation & { id: number; createdAt: number })[],
): boolean => {
  const key = resourceKeyFor(method, path, body);

  let latest: (QueuedMutation & { id: number; createdAt: number }) | undefined;
  for (const entry of pending) {
    if (resourceKeyFor(entry.method, entry.path, entry.body) !== key) {
      continue;
    }
    if (
      !latest ||
      entry.createdAt > latest.createdAt ||
      (entry.createdAt === latest.createdAt && entry.id > latest.id)
    ) {
      latest = entry;
    }
  }

  if (!latest) {
    return true;
  }

  return !(
    latest.method === method &&
    latest.path === path &&
    latest.body === body
  );
};

/**
 * Adds a mutation to the queue, unless it is redundant.
 *
 * The queue is read in full and reduced in memory rather than filtered in SQL:
 * "the newest entry for this resource" depends on `resourceKeyFor`, which reads
 * the path and the JSON body, and expressing that in SQL would mean duplicating
 * the identity rules in a second language where they could drift. The outbox is
 * bounded in practice by the size of one user's offline session.
 */
export const enqueueMutation = async (
  method: string,
  path: string,
  body?: string,
): Promise<void> => {
  const db = await getLocalDatabase();
  const serialized = body ?? null;

  const rows = await db.getAllAsync<{
    id: number;
    method: string;
    path: string;
    body: string | null;
    created_at: number;
  }>("SELECT id, method, path, body, created_at FROM outbox");

  const pending = rows.map((row) => ({
    id: row.id,
    method: row.method,
    path: row.path,
    body: row.body,
    createdAt: row.created_at,
  }));

  if (!shouldEnqueue(method, path, serialized, pending)) {
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
