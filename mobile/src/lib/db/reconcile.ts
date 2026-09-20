import type { TMDBMedia } from "@/lib/media-api";
import type { OutboxEntry } from "@/lib/db/outbox";

/**
 * Reconciles queued offline mutations with the cached server payload.
 *
 * The problem this solves: a mutation made offline is queued and reflected in
 * the screen's own state, but the *cached response* from the server still
 * describes the world before that mutation. Restart the app while still offline
 * and the cached payload is served again — so the episode the user marked
 * watched reappears as unwatched, and a title they removed comes back.
 *
 * The fix is to layer the pending mutations over whatever payload was served,
 * which is the piece that makes offline writes durable across a restart rather
 * than only within one session.
 *
 * `buildPendingOverlay` is pure so the reconciliation rules can be tested
 * without a database or a network.
 */

/** A watched-row identity: `movie:603` or `tv:1396:2:7`. */
export type WatchedKey = string;

export interface PendingOverlay {
  /** Watched rows the server does not know about yet. */
  watchedAdded: Set<WatchedKey>;
  /** Watched rows the server still thinks are watched. */
  watchedRemoved: Set<WatchedKey>;
  /**
   * Watchlist entries added offline, with the full media object taken from the
   * queued request. Carrying the payload is what lets these render immediately
   * and survive a restart — the server has never seen them, so no cached
   * payload can contain them.
   */
  watchlistAdded: Map<number, TMDBMedia>;
  /** Watchlist entries to hide, by media id. */
  watchlistRemovedIds: Set<number>;
  /** Favourites to hide, by media id. */
  favoriteRemovedIds: Set<number>;
  /** True when watch history was cleared offline; no watched row is meaningful. */
  watchHistoryCleared: boolean;
}

export const emptyOverlay = (): PendingOverlay => ({
  watchedAdded: new Set(),
  watchedRemoved: new Set(),
  watchlistAdded: new Map(),
  watchlistRemovedIds: new Set(),
  favoriteRemovedIds: new Set(),
  watchHistoryCleared: false,
});

/**
 * Normalises the media type the way the rest of the app does.
 *
 * `TMDBMedia.media_type` is optional in list payloads, and a mismatched type
 * would produce a row that does not match anything the server sends back.
 */
const normalizeMediaType = (media: TMDBMedia): "movie" | "tv" =>
  media.media_type === "tv" ? "tv" : media.title ? "movie" : "tv";

/**
 * Builds the watched-row key the server uses in its change log, so the overlay
 * and the delta apply agree on identity.
 *
 * Movies carry no season/episode; including placeholder segments would produce
 * a key that never matches.
 */
export const watchedKey = (
  mediaType: string,
  mediaId: number,
  seasonNumber?: number | null,
  episodeNumber?: number | null,
): WatchedKey => {
  const type = mediaType === "tv" ? "tv" : "movie";
  const hasEpisode =
    type === "tv" &&
    typeof seasonNumber === "number" &&
    typeof episodeNumber === "number";
  return hasEpisode
    ? `${type}:${mediaId}:${seasonNumber}:${episodeNumber}`
    : `${type}:${mediaId}`;
};

/** Extracts an id from a path like `/api/watchlist/603`. */
export const idFromPath = (path: string): number | null => {
  const match = /\/api\/(?:watchlist|favorites)\/(\d+)/.exec(path);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBody = (body: string | null): any => {
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/** Reads a WatchedItem-shaped body into an overlay entry. */
const addWatchedFromPayload = (overlay: PendingOverlay, payload: any): void => {
  if (!payload || typeof payload.media_id !== "number") {
    return;
  }
  const key = watchedKey(
    payload.media_type,
    payload.media_id,
    payload.season_number,
    payload.episode_number,
  );
  // A later add cancels an earlier removal of the same row.
  overlay.watchedRemoved.delete(key);
  overlay.watchedAdded.add(key);
};

const removeWatchedFromPayload = (overlay: PendingOverlay, payload: any): void => {
  if (!payload || typeof payload.media_id !== "number") {
    return;
  }
  const key = watchedKey(
    payload.media_type,
    payload.media_id,
    payload.season_number,
    payload.episode_number,
  );
  // A later removal cancels an earlier add.
  overlay.watchedAdded.delete(key);
  overlay.watchedRemoved.add(key);
};

/**
 * Folds the pending queue into a single overlay.
 *
 * Entries are processed oldest first and later entries win, so the overlay
 * reflects the user's final intent — mark watched then unmark must not leave the
 * row hidden.
 */
export const buildPendingOverlay = (entries: OutboxEntry[]): PendingOverlay => {
  const overlay = emptyOverlay();
  const ordered = [...entries].sort(
    (a, b) => a.createdAt - b.createdAt || a.id - b.id,
  );

  for (const entry of ordered) {
    const method = entry.method.toUpperCase();
    const path = entry.path.split("?")[0];
    const body = parseBody(entry.body);

    switch (path) {
      case "/api/watched":
        if (method === "POST") {
          addWatchedFromPayload(overlay, body);
        } else if (method === "DELETE") {
          removeWatchedFromPayload(overlay, body);
        }
        break;

      case "/api/watched/bulk":
        if (Array.isArray(body?.items)) {
          for (const item of body.items) {
            addWatchedFromPayload(overlay, item);
          }
        }
        break;

      case "/api/watched/bulk-delete": {
        if (!body || typeof body.media_id !== "number") {
          break;
        }
        if (Array.isArray(body.episodes) && body.episodes.length > 0) {
          for (const episode of body.episodes) {
            removeWatchedFromPayload(overlay, {
              media_type: body.media_type,
              media_id: body.media_id,
              season_number: episode.season,
              episode_number: episode.episode,
            });
          }
        } else {
          // No episode list means "everything for this title", which for a
          // movie is a single row. For a series the app always sends an
          // explicit list, so only the title-level row is affected here.
          removeWatchedFromPayload(overlay, {
            media_type: body.media_type,
            media_id: body.media_id,
          });
        }
        break;
      }

      case "/api/profile/clear-history":
        // Nothing watched survives this, so treat every recorded watched row as
        // gone rather than drawing progress from a stale payload.
        overlay.watchHistoryCleared = true;
        overlay.watchedAdded.clear();
        break;

      default: {
        const id = idFromPath(path);
        if (id === null) {
          break;
        }

        if (path.startsWith("/api/watchlist/") && method === "DELETE") {
          // A later removal cancels an earlier offline add.
          overlay.watchlistAdded.delete(id);
          overlay.watchlistRemovedIds.add(id);
          break;
        }

        if (path.startsWith("/api/favorites/") && method === "DELETE") {
          overlay.favoriteRemovedIds.add(id);
          break;
        }
        break;
      }
    }

    // An offline add is only meaningful for the watchlist, and only when the
    // queued body actually carries the media object.
    if (path === "/api/watchlist" && method === "POST" && body && typeof body.id === "number") {
      const media: TMDBMedia = { ...body, media_type: normalizeMediaType(body) };
      // A later add cancels an earlier removal of the same title.
      overlay.watchlistRemovedIds.delete(media.id);
      overlay.watchlistAdded.set(media.id, media);
    }
  }

  return overlay;
}

/**
 * Reports whether a pending mutation touches anything at all.
 *
 * Used to skip the reconciliation pass entirely in the common case of an empty
 * queue.
 */
export const overlayIsEmpty = (overlay: PendingOverlay): boolean =>
  !overlay.watchHistoryCleared &&
  overlay.watchedAdded.size === 0 &&
  overlay.watchedRemoved.size === 0 &&
  overlay.watchlistAdded.size === 0 &&
  overlay.watchlistRemovedIds.size === 0 &&
  overlay.favoriteRemovedIds.size === 0;
