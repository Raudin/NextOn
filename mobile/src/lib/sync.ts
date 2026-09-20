import type * as SQLite from "expo-sqlite";

import { invalidateMediaCaches } from "@/lib/cache";
import { getLocalDatabase } from "@/lib/db/client";
import {
  deleteMutation,
  listPendingMutations,
  MAX_OUTBOX_ATTEMPTS,
  recordMutationAttempt,
} from "@/lib/db/outbox";
import { fetchSyncChanges, type SyncOp } from "@/lib/media-api";
import { requestJson } from "@/lib/http";

/**
 * Delta sync.
 *
 * The client keeps a version cursor. Bringing itself up to date is one request
 * for the changes after that cursor, rather than re-downloading the library —
 * which is what makes the local store worth having on a reconnect after hours
 * offline.
 *
 * A pruned server-side change log can leave a cursor too old to serve
 * incrementally. The server says so explicitly (`resync_required`) and the
 * client drops its local copy rather than silently missing changes and drifting
 * out of sync forever.
 */

const SYNC_VERSION_KEY = "sync_version";

export interface SyncResult {
  /** Mutations replayed from the outbox. */
  pushed: number;
  /** Remote changes applied to the local store. */
  applied: number;
  /** True when the cursor was too old and the local copy was discarded. */
  resynced: boolean;
  /** Mutations still queued for a later attempt. */
  pending: number;
}

export const getStoredSyncVersion = async (): Promise<number> => {
  const db = await getLocalDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = ?",
    SYNC_VERSION_KEY,
  );
  const parsed = row ? Number(row.value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

export const setStoredSyncVersion = async (version: number): Promise<void> => {
  const db = await getLocalDatabase();
  await db.runAsync(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    SYNC_VERSION_KEY,
    String(version),
  );
};

/**
 * Splits a change-log entity key back into its parts.
 *
 * The key is produced by the server and is the authoritative identity for a
 * change, so it is parsed rather than trusting the payload: a delete op carries
 * no payload at all, and a movie's watched row has no season/episode to read.
 */
export const parseEntityKey = (
  entityKey: string,
): { mediaType: string; mediaId: number; season: number; episode: number } => {
  const parts = entityKey.split(":");
  const mediaType = parts[0] === "tv" ? "tv" : "movie";
  const mediaId = Number(parts[1]);
  const hasEpisode = parts.length >= 4;
  return {
    mediaType,
    mediaId: Number.isFinite(mediaId) ? mediaId : 0,
    season: hasEpisode ? Number(parts[2]) : -1,
    episode: hasEpisode ? Number(parts[3]) : -1,
  };
};

const safeJson = (payload?: string): Record<string, any> => {
  if (!payload) {
    return {};
  }
  try {
    return JSON.parse(payload) as Record<string, any>;
  } catch {
    return {};
  }
};

/** Applies one remote change to the matching local table. */
export async function applySyncOp(db: SQLite.SQLiteDatabase, op: SyncOp): Promise<void> {
  const { mediaType, mediaId, season, episode } = parseEntityKey(op.entity_key);

  const table =
    op.collection === "favorites"
      ? "favorites"
      : op.collection === "watched"
        ? "watched"
        : "watchlist";

  if (op.op_type === "delete") {
    if (table === "watched") {
      await db.runAsync(
        "DELETE FROM watched WHERE media_type = ? AND media_id = ? AND season_number = ? AND episode_number = ?",
        mediaType,
        mediaId,
        season,
        episode,
      );
      return;
    }
    await db.runAsync(
      `DELETE FROM ${table} WHERE media_type = ? AND media_id = ?`,
      mediaType,
      mediaId,
    );
    return;
  }

  const payload = safeJson(op.payload);

  if (table === "watched") {
    await db.runAsync(
      `INSERT INTO watched (media_type, media_id, season_number, episode_number, watched_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(media_type, media_id, season_number, episode_number)
       DO UPDATE SET watched_at = excluded.watched_at`,
      mediaType,
      mediaId,
      season,
      episode,
      payload.watched_at ?? null,
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO ${table}
       (media_type, media_id, title, name, poster_path, backdrop_path, vote_average, release_date, first_air_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_type, media_id) DO UPDATE SET
       title = excluded.title,
       name = excluded.name,
       poster_path = excluded.poster_path,
       backdrop_path = excluded.backdrop_path,
       vote_average = excluded.vote_average,
       release_date = excluded.release_date,
       first_air_date = excluded.first_air_date,
       created_at = excluded.created_at`,
    mediaType,
    mediaId,
    payload.title ?? null,
    payload.name ?? null,
    payload.poster_path ?? null,
    payload.backdrop_path ?? null,
    typeof payload.vote_average === "number" ? payload.vote_average : null,
    payload.release_date ?? null,
    payload.first_air_date ?? null,
    payload.created_at ?? null,
  );
}

/**
 * Replays queued mutations in order.
 *
 * Stops at the first transport failure — replaying later entries out of order
 * could apply a removal before its matching add. An entry that keeps failing is
 * discarded after `MAX_OUTBOX_ATTEMPTS` so a single bad mutation cannot block
 * every later one forever.
 */
export const drainOutbox = async (): Promise<number> => {
  const pending = await listPendingMutations();
  if (pending.length === 0) {
    return 0;
  }

  let pushed = 0;

  for (const entry of pending) {
    try {
      await requestJson(entry.path, {
        method: entry.method,
        body: entry.body ?? undefined,
      });
      await deleteMutation(entry.id);
      pushed += 1;
    } catch (error) {
      const attempts = await recordMutationAttempt(entry.id);

      if (attempts >= MAX_OUTBOX_ATTEMPTS) {
        if (__DEV__) {
          console.warn(
            `[sync] Dropping ${entry.method} ${entry.path} after ${attempts} attempts:`,
            error,
          );
        }
        await deleteMutation(entry.id);
        continue;
      }

      if (__DEV__) {
        console.warn(
          `[sync] ${entry.method} ${entry.path} failed (attempt ${attempts}); will retry`,
          error,
        );
      }
      break;
    }
  }

  return pushed;
};

/**
 * Pulls and applies remote changes since the stored cursor.
 *
 * Returns `applied: 0, resynced: false` when there is nothing to do, which is
 * the common case and costs one small request.
 */
export const pullDelta = async (): Promise<{ applied: number; resynced: boolean }> => {
  const db = await getLocalDatabase();
  const since = await getStoredSyncVersion();
  const delta = await fetchSyncChanges(since);

  if (delta.resync_required) {
    // The cursor is older than the server's retained change log, so a partial
    // delta would leave the local copy subtly wrong. Discard and restart from
    // the new version; the screens refetch their payloads.
    await db.withTransactionAsync(async () => {
      await db.execAsync(
        "DELETE FROM watchlist; DELETE FROM favorites; DELETE FROM watched;",
      );
    });
    await setStoredSyncVersion(delta.version);
    await invalidateMediaCaches();
    return { applied: 0, resynced: true };
  }

  const changes = delta.changes ?? [];

  if (changes.length > 0) {
    await db.withTransactionAsync(async () => {
      for (const op of changes) {
        await applySyncOp(db, op);
      }
    });
    // Remote changes mean this device's cached payloads are behind, so drop
    // them; the next screen focus refetches (or gets a cheap 304).
    await invalidateMediaCaches();
  }

  await setStoredSyncVersion(delta.version);
  return { applied: changes.length, resynced: false };
};

/**
 * Full sync: push what is pending, then pull what is new.
 *
 * Push-then-pull matters: applying remote changes first could overwrite a local
 * mutation that has not been sent yet.
 */
export const runSync = async (): Promise<SyncResult> => {
  const pushed = await drainOutbox();
  const { applied, resynced } = await pullDelta();
  const pending = (await listPendingMutations()).length;

  return { pushed, applied, resynced, pending };
};
