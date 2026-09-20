import { getLocalDatabase } from "@/lib/db/client";
import {
  fetchWatchlistWithProgress,
  type WatchlistEntry,
} from "@/lib/media-api";

/**
 * Reads and writes for the local-first watchlist mirror.
 *
 * The mirror exists so the screen has something to render when there is no
 * cached payload *and* no connection — a cold start after an update, or a first
 * launch on a train. The response cache already covers the warm case; this
 * covers the one it cannot.
 *
 * It is a mirror, not a source of truth: every successful fetch replaces it
 * wholesale, so it can never drift into being subtly wrong. The per-entity
 * change log applies into the same table when a delta arrives.
 */

interface WatchlistRow {
  media_type: string;
  media_id: number;
  title: string | null;
  name: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number | null;
  release_date: string | null;
  first_air_date: string | null;
  created_at: string | null;
}

/**
 * Replaces the mirror with the authoritative list.
 *
 * Wholesale rather than incremental: the payload is the truth, and a delete +
 * insert cannot leave a stale row behind the way a merge could. Never throws —
 * a mirror that fails to update must not fail the fetch that produced it.
 */
export const replaceLocalWatchlist = async (
  entries: WatchlistEntry[],
): Promise<void> => {
  try {
    const db = await getLocalDatabase();

    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM watchlist");

      for (const entry of entries) {
        const mediaType = entry.media_type === "tv" ? "tv" : "movie";
        await db.runAsync(
          `INSERT INTO watchlist
             (media_type, media_id, title, name, poster_path, backdrop_path, vote_average, release_date, first_air_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(media_type, media_id) DO NOTHING`,
          mediaType,
          entry.id,
          entry.title ?? null,
          entry.name ?? null,
          entry.poster_path ?? null,
          entry.backdrop_path ?? null,
          typeof entry.vote_average === "number" ? entry.vote_average : null,
          entry.release_date ?? null,
          entry.first_air_date ?? null,
          entry.created_at ?? null,
        );
      }
    });
  } catch (error) {
    if (__DEV__) {
      console.warn("[watchlist-mirror] Failed to update the local mirror:", error);
    }
  }
};

/**
 * The mirrored watchlist.
 *
 * Progress is not stored here, so entries come back without it — the screens
 * render them without progress bars rather than not at all.
 */
export const getLocalWatchlist = async (): Promise<WatchlistEntry[]> => {
  const db = await getLocalDatabase();
  const rows = await db.getAllAsync<WatchlistRow>(
    "SELECT * FROM watchlist ORDER BY created_at DESC",
  );

  return rows.map((row) => ({
    id: row.media_id,
    media_type: row.media_type === "tv" ? "tv" : "movie",
    title: row.title ?? undefined,
    name: row.name ?? undefined,
    poster_path: row.poster_path ?? "",
    backdrop_path: row.backdrop_path ?? "",
    vote_average: row.vote_average ?? 0,
    release_date: row.release_date ?? undefined,
    first_air_date: row.first_air_date ?? undefined,
    created_at: row.created_at ?? undefined,
  }));
};

export interface LoadedWatchlist {
  items: WatchlistEntry[];
  /** Where the data came from, so the UI can say when it is showing a mirror. */
  source: "network" | "local";
}

/**
 * Loads the watchlist, falling back to the local mirror.
 *
 * `fetchWatchlistWithProgress` already falls back to its own cached payload on a
 * transport failure, so reaching the mirror means there was no cached payload
 * either. The mirror is only used when it holds something: an empty mirror is
 * indistinguishable from "this account has no watchlist", and showing an empty
 * list would be a worse lie than an error message.
 */
export const loadWatchlistWithFallback = async (): Promise<LoadedWatchlist> => {
  try {
    const items = await fetchWatchlistWithProgress({ filterWatched: true });
    await replaceLocalWatchlist(items);
    return { items, source: "network" };
  } catch (error) {
    let local: WatchlistEntry[] = [];
    try {
      local = await getLocalWatchlist();
    } catch {
      // The mirror is unavailable too; fall through to rethrowing the network
      // error, which is the more useful message.
    }

    if (local.length > 0) {
      return { items: local, source: "local" };
    }
    throw error;
  }
};
