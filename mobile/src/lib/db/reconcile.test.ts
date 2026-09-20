import {
  buildPendingOverlay,
  emptyOverlay,
  idFromPath,
  overlayIsEmpty,
  watchedKey,
} from "@/lib/db/reconcile";
import type { OutboxEntry } from "@/lib/db/outbox";

/**
 * Offline reconciliation.
 *
 * These rules are what make an offline mutation survive an app restart. Without
 * them the mutation lives only in screen state: restart while offline and the
 * cached server payload is served again, so a watched episode reappears and a
 * removed title comes back.
 */

let nextId = 1;

const entry = (
  method: string,
  path: string,
  body?: unknown,
  createdAt?: number,
): OutboxEntry => ({
  id: nextId++,
  method,
  path,
  body: body === undefined ? null : JSON.stringify(body),
  createdAt: createdAt ?? nextId,
  attempts: 0,
});

beforeEach(() => {
  nextId = 1;
});

describe("watchedKey", () => {
  it("builds an episode key for a series", () => {
    expect(watchedKey("tv", 1396, 2, 7)).toBe("tv:1396:2:7");
  });

  it("builds a title-level key for a movie", () => {
    // A placeholder season/episode would produce a key that never matches the
    // server's change log.
    expect(watchedKey("movie", 603)).toBe("movie:603");
    expect(watchedKey("movie", 603, null, null)).toBe("movie:603");
  });

  it("treats a series with no episode as title-level", () => {
    expect(watchedKey("tv", 1396)).toBe("tv:1396");
  });

  it("normalises an unknown media type to movie", () => {
    expect(watchedKey("", 5)).toBe("movie:5");
  });
});

describe("idFromPath", () => {
  it("extracts the id from a removal path", () => {
    expect(idFromPath("/api/watchlist/603")).toBe(603);
    expect(idFromPath("/api/favorites/1396")).toBe(1396);
  });

  it("returns null for a path with no id", () => {
    expect(idFromPath("/api/watchlist")).toBeNull();
    expect(idFromPath("/api/profile/clear-history")).toBeNull();
  });
});

describe("buildPendingOverlay", () => {
  it("produces an empty overlay for an empty queue", () => {
    expect(overlayIsEmpty(buildPendingOverlay([]))).toBe(true);
  });

  it("records a queued mark-watched for a series", () => {
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watched", {
        media_id: 1396,
        media_type: "tv",
        season_number: 2,
        episode_number: 7,
      }),
    ]);

    expect(overlay.watchedAdded.has("tv:1396:2:7")).toBe(true);
    expect(overlayIsEmpty(overlay)).toBe(false);
  });

  it("records a queued mark-watched for a movie", () => {
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watched", { media_id: 603, media_type: "movie" }),
    ]);

    expect(overlay.watchedAdded.has("movie:603")).toBe(true);
  });

  it("records every item of a queued bulk mark", () => {
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watched/bulk", {
        items: [
          { media_id: 1396, media_type: "tv", season_number: 1, episode_number: 1 },
          { media_id: 1396, media_type: "tv", season_number: 1, episode_number: 2 },
        ],
      }),
    ]);

    expect(overlay.watchedAdded.size).toBe(2);
    expect(overlay.watchedAdded.has("tv:1396:1:1")).toBe(true);
    expect(overlay.watchedAdded.has("tv:1396:1:2")).toBe(true);
  });

  it("records an explicit bulk unmark per episode", () => {
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watched/bulk-delete", {
        media_id: 1396,
        media_type: "tv",
        episodes: [
          { season: 1, episode: 1 },
          { season: 1, episode: 2 },
        ],
      }),
    ]);

    expect(overlay.watchedRemoved.has("tv:1396:1:1")).toBe(true);
    expect(overlay.watchedRemoved.has("tv:1396:1:2")).toBe(true);
  });

  it("records a watchlist removal by media id", () => {
    const overlay = buildPendingOverlay([entry("DELETE", "/api/watchlist/603")]);

    expect(overlay.watchlistRemovedIds.has(603)).toBe(true);
    expect(overlay.favoriteRemovedIds.size).toBe(0);
  });

  it("keeps the full media object for an offline watchlist add", () => {
    // The server has never seen this title, so no cached payload can contain
    // it; rendering it offline requires carrying the payload in the overlay.
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watchlist", {
        id: 603,
        title: "The Matrix",
        poster_path: "/matrix.jpg",
        vote_average: 8.2,
      }),
    ]);

    const added = overlay.watchlistAdded.get(603);
    expect(added).toBeDefined();
    expect(added?.poster_path).toBe("/matrix.jpg");
    // media_type is optional in list payloads; a missing one must still resolve
    // to something the server agrees with.
    expect(added?.media_type).toBe("movie");
  });

  it("normalises a series add from a title-less payload", () => {
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watchlist", { id: 1396, name: "Breaking Bad" }),
    ]);

    expect(overlay.watchlistAdded.get(1396)?.media_type).toBe("tv");
  });

  it("lets a later removal cancel an offline add", () => {
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watchlist", { id: 603, title: "M" }, 100),
      entry("DELETE", "/api/watchlist/603", undefined, 200),
    ]);

    expect(overlay.watchlistAdded.has(603)).toBe(false);
    expect(overlay.watchlistRemovedIds.has(603)).toBe(true);
  });

  it("lets a later add cancel an offline removal", () => {
    const overlay = buildPendingOverlay([
      entry("DELETE", "/api/watchlist/603", undefined, 100),
      entry("POST", "/api/watchlist", { id: 603, title: "M" }, 200),
    ]);

    expect(overlay.watchlistRemovedIds.has(603)).toBe(false);
    expect(overlay.watchlistAdded.has(603)).toBe(true);
  });

  it("keeps watchlist and favourite removals apart", () => {
    const overlay = buildPendingOverlay([
      entry("DELETE", "/api/favorites/9"),
      entry("DELETE", "/api/watchlist/8"),
    ]);

    expect(overlay.favoriteRemovedIds.has(9)).toBe(true);
    expect(overlay.watchlistRemovedIds.has(8)).toBe(true);
    expect(overlay.watchlistRemovedIds.has(9)).toBe(false);
  });

  it("flags a queued history clear and discards recorded watched rows", () => {
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watched", { media_id: 1, media_type: "movie" }),
      entry("POST", "/api/profile/clear-history"),
    ]);

    expect(overlay.watchHistoryCleared).toBe(true);
    // Nothing watched survives the clear, so keeping the earlier add would
    // wrongly hide a card.
    expect(overlay.watchedAdded.size).toBe(0);
  });

  it("lets a later unmark cancel an earlier mark", () => {
    // Oldest-first ordering, later entry wins: the row must not stay hidden.
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watched", {
        media_id: 1396,
        media_type: "tv",
        season_number: 2,
        episode_number: 7,
      }, 100),
      entry("DELETE", "/api/watched", {
        media_id: 1396,
        media_type: "tv",
        season_number: 2,
        episode_number: 7,
      }, 200),
    ]);

    expect(overlay.watchedAdded.has("tv:1396:2:7")).toBe(false);
    expect(overlay.watchedRemoved.has("tv:1396:2:7")).toBe(true);
  });

  it("lets a later mark cancel an earlier unmark", () => {
    const overlay = buildPendingOverlay([
      entry("DELETE", "/api/watched", { media_id: 603, media_type: "movie" }, 100),
      entry("POST", "/api/watched", { media_id: 603, media_type: "movie" }, 200),
    ]);

    expect(overlay.watchedAdded.has("movie:603")).toBe(true);
    expect(overlay.watchedRemoved.has("movie:603")).toBe(false);
  });

  it("orders by timestamp, not by insertion into the queue", () => {
    // The queue is drained oldest-first, so the overlay has to agree with that
    // order or it would show a different result than the eventual sync.
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watched", { media_id: 5, media_type: "movie" }, 300),
      entry("DELETE", "/api/watchlist/5", undefined, 100),
      entry("DELETE", "/api/watched", { media_id: 5, media_type: "movie" }, 200),
    ]);

    expect(overlay.watchedAdded.has("movie:5")).toBe(true);
    expect(overlay.watchedRemoved.has("movie:5")).toBe(false);
  });

  it("ignores unparseable and unknown entries instead of throwing", () => {
    const overlay = buildPendingOverlay([
      { id: 1, method: "POST", path: "/api/watched", body: "{not json", createdAt: 1, attempts: 0 },
      { id: 2, method: "PUT", path: "/api/profile", body: "{}", createdAt: 2, attempts: 0 },
      entry("GET", "/api/discover"),
    ]);

    expect(overlayIsEmpty(overlay)).toBe(true);
  });

  it("ignores a watched body with no media id", () => {
    const overlay = buildPendingOverlay([
      entry("POST", "/api/watched", { media_type: "movie" }),
    ]);

    expect(overlayIsEmpty(overlay)).toBe(true);
  });

  it("strips a query string before matching the path", () => {
    const overlay = buildPendingOverlay([
      entry("DELETE", "/api/watchlist/12?unused=1"),
    ]);

    expect(overlay.watchlistRemovedIds.has(12)).toBe(true);
  });
});

describe("emptyOverlay", () => {
  it("is empty and distinct per call", () => {
    const a = emptyOverlay();
    const b = emptyOverlay();

    expect(overlayIsEmpty(a)).toBe(true);
    a.watchedAdded.add("movie:1");
    // Sharing one instance would leak state between screens.
    expect(overlayIsEmpty(b)).toBe(true);
  });
});
