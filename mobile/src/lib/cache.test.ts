import Storage from "expo-sqlite/kv-store";

import {
  cache,
  CACHE_BYTE_BUDGET,
  COLLECTION_KEY_PREFIX,
  DEFAULT_TTL_MS,
  MEDIA_DETAILS_KEY_PREFIX,
  MEMORY_CACHE_MAX_ENTRIES,
  META_KEY_PREFIX,
  PUBLIC_KEY_PREFIX,
  auditCacheStorage,
  clearMemory,
  invalidateMediaCaches,
  pruneCacheStorage,
  purgeLegacyCacheKeys,
} from "@/lib/cache";

/**
 * Cache hygiene.
 *
 * These rules exist because the previous cache had no TTL on several keys (so
 * they were immortal), no size bound at all, a hand-written invalidation list
 * that had drifted, and three keys no code writes any more. Each of those is a
 * regression this suite is meant to catch.
 */

// The mocked store exposes a reset hook that is not part of the real API.
const resetStorage = () => (Storage as unknown as { __clear: () => void }).__clear();

beforeEach(async () => {
  jest.useRealTimers();
  await cache.clearAll();
  resetStorage();
});

describe("default TTL", () => {
  it("applies a TTL when none is given, so no entry is immortal", async () => {
    jest.useFakeTimers();

    await cache.set("something", { value: 1 });

    // Just inside the default window.
    jest.setSystemTime(Date.now() + DEFAULT_TTL_MS - 1000);
    expect(await cache.get("something")).toEqual({ value: 1 });

    // Past it.
    jest.setSystemTime(Date.now() + 2000);
    expect(await cache.get("something")).toBeNull();
  });

  it("honours an explicit TTL", async () => {
    jest.useFakeTimers();

    await cache.set("short", "value", 5_000);
    jest.setSystemTime(Date.now() + 6_000);

    expect(await cache.get("short")).toBeNull();
  });
});

describe("entries and HTTP validators", () => {
  it("keeps an ETag alongside the data", async () => {
    await cache.setEntry("payload", {
      data: { items: [] },
      timestamp: Date.now(),
      ttl: DEFAULT_TTL_MS,
      etag: 'W/"user-1-ver-4"',
    });

    const entry = await cache.getEntry<{ items: unknown[] }>("payload");
    expect(entry?.etag).toBe('W/"user-1-ver-4"');
    expect(entry?.data).toEqual({ items: [] });
  });

  it("returns an expired entry from getEntry so it can be revalidated", async () => {
    // `get` hides expired entries, but a conditional request needs the old body
    // and its validator to fall back on, so `getEntry` deliberately does not
    // check the TTL. `requestJsonCached` relies on exactly this.
    jest.useFakeTimers();
    await cache.setEntry("revalidatable", {
      data: { stale: true },
      timestamp: Date.now(),
      ttl: 1_000,
      etag: 'W/"user-1-ver-9"',
    });
    jest.setSystemTime(Date.now() + 5_000);

    const entry = await cache.getEntry<{ stale: boolean }>("revalidatable");
    expect(entry).not.toBeNull();
    expect(entry?.etag).toBe('W/"user-1-ver-9"');
    expect(entry?.data).toEqual({ stale: true });
  });

  it("removes an expired entry when read through get", async () => {
    // Reading through `get` is the maintenance path: it reclaims the space. It
    // is therefore important that the HTTP layer uses `getEntry`, which would
    // otherwise lose the validator before it could be sent.
    jest.useFakeTimers();
    await cache.set("disposable", { value: 1 }, 1_000);
    jest.setSystemTime(Date.now() + 5_000);

    expect(await cache.get("disposable")).toBeNull();
    expect(await cache.getEntry("disposable")).toBeNull();
  });

  it("refreshes the timestamp when storing an entry back", async () => {
    jest.useFakeTimers();
    await cache.set("aged", "value", 1_000);
    jest.setSystemTime(Date.now() + 900);

    const entry = await cache.getEntry<string>("aged");
    expect(entry).not.toBeNull();

    await cache.setEntry("aged", { ...entry!, timestamp: entry!.timestamp });
    jest.setSystemTime(Date.now() + 900);

    // A 304 revalidation proves the data is still current, so the freshness
    // window restarts rather than the entry expiring mid-session.
    expect(await cache.get("aged")).toBe("value");
  });
});

describe("in-memory cache bound", () => {
  it("caps how many entries it holds, evicting the oldest", async () => {
    // The eviction is a memory-only affair: an entry dropped from the Map is
    // still in SQLite, so the next read simply goes back to storage. A cap
    // that lost data would be a bug, not a cache.
    for (let i = 0; i < MEMORY_CACHE_MAX_ENTRIES + 5; i++) {
      await cache.set(`entry-${i}`, `value-${i}`);
    }

    const getItem = jest.spyOn(Storage, "getItem");

    // Oldest of all, so it was the first evicted.
    expect(await cache.get("entry-0")).toBe("value-0");
    expect(getItem).toHaveBeenCalledWith("nexton_cache_entry-0");

    getItem.mockClear();

    // The newest is still a memory hit, which is the whole point of keeping a
    // memory cache at all.
    const newest = MEMORY_CACHE_MAX_ENTRIES + 4;
    expect(await cache.get(`entry-${newest}`)).toBe(`value-${newest}`);
    expect(getItem).not.toHaveBeenCalled();

    getItem.mockRestore();
  });

  it("counts a read as a use, so a re-read entry is not the next one out", async () => {
    for (let i = 0; i < MEMORY_CACHE_MAX_ENTRIES; i++) {
      await cache.set(`entry-${i}`, i);
    }

    // Touch the oldest. Eviction by write order — the naive implementation of
    // a Map-based cap — would still discard this one first.
    expect(await cache.get("entry-0")).toBe(0);

    await cache.set("overflow", "x");

    const getItem = jest.spyOn(Storage, "getItem");

    expect(await cache.get("entry-0")).toBe(0);
    expect(getItem).not.toHaveBeenCalled();

    // Its neighbour is now the least recently used, so that is what went.
    expect(await cache.get("entry-1")).toBe(1);
    expect(getItem).toHaveBeenCalledWith("nexton_cache_entry-1");

    getItem.mockRestore();
  });

  it("clearMemory drops the in-memory copy and keeps the persisted one", async () => {
    await cache.set("kept", { value: 1 });

    const getItem = jest.spyOn(Storage, "getItem");

    expect(await cache.get("kept")).toEqual({ value: 1 });
    expect(getItem).not.toHaveBeenCalled();
    getItem.mockClear();

    clearMemory();

    // Still readable, and now served from storage — which is exactly the
    // contract: releasing memory under pressure must not cost the user data
    // they had already fetched.
    expect(await cache.get("kept")).toEqual({ value: 1 });
    expect(getItem).toHaveBeenCalledWith("nexton_cache_kept");

    getItem.mockRestore();
  });
});

describe("invalidateMediaCaches", () => {
  it("clears derived data but keeps bookkeeping and shared payloads", async () => {
    await cache.set("home_schedule", { shows: [] });
    await cache.set("watchlist_progress_filtered", []);
    await cache.set(`${META_KEY_PREFIX}image_cache_cleared_at`, 123);
    await cache.set(`${PUBLIC_KEY_PREFIX}discover_data`, { trending: [] });

    await invalidateMediaCaches();

    expect(await cache.get("home_schedule")).toBeNull();
    expect(await cache.get("watchlist_progress_filtered")).toBeNull();
    // Losing either of these would be a bug: the clear timestamp would reset
    // (wiping the image cache every launch) and Discover would refetch a
    // payload that has nothing to do with the user.
    expect(await cache.get(`${META_KEY_PREFIX}image_cache_cleared_at`)).toBe(123);
    expect(await cache.get(`${PUBLIC_KEY_PREFIX}discover_data`)).toEqual({
      trending: [],
    });
  });

  it("clears a key it has never heard of", async () => {
    // The previous invalidation was a hand-written list that had already
    // drifted; anything not prefixed as protected must be cleared.
    await cache.set("some_future_screen_key", "value");
    await invalidateMediaCaches();
    expect(await cache.get("some_future_screen_key")).toBeNull();
  });

  it("keeps media details and collections, which no mutation can change", async () => {
    // A title's details and a franchise's films depend on the title, not on who
    // is signed in. Clearing them on every mutation made the detail screen and
    // the Discover carousels re-download everything they had already fetched —
    // and invalidateMediaCaches runs on all eight of the detail screen's
    // mutation paths and again after every delta pull.
    await cache.set(`${MEDIA_DETAILS_KEY_PREFIX}movie_603`, { title: "The Matrix" });
    await cache.set(`${COLLECTION_KEY_PREFIX}2344`, { parts: [] });
    await cache.set("watchlist_ids", [603]);

    await invalidateMediaCaches();

    expect(await cache.get(`${MEDIA_DETAILS_KEY_PREFIX}movie_603`)).toEqual({
      title: "The Matrix",
    });
    expect(await cache.get(`${COLLECTION_KEY_PREFIX}2344`)).toEqual({ parts: [] });
    // The derived membership index IS user-scoped, so it must still go.
    expect(await cache.get("watchlist_ids")).toBeNull();
  });

  it("keeps every key a mutation cannot affect, and drops the rest", async () => {
    await cache.set("home_schedule", { shows: [] });
    await cache.set("watchlist_progress_all", []);
    await cache.set("watchlist_ids", [1]);
    await cache.set("discover_watchlist_ids", [1]);
    await cache.set(`${MEDIA_DETAILS_KEY_PREFIX}tv_1396`, { name: "Squid Game" });
    await cache.set(`${COLLECTION_KEY_PREFIX}99`, { parts: [] });
    await cache.set(`${META_KEY_PREFIX}bookkeeping`, 1);
    await cache.set(`${PUBLIC_KEY_PREFIX}discover_data`, { trending: [] });

    await invalidateMediaCaches();

    for (const key of [
      "home_schedule",
      "watchlist_progress_all",
      "watchlist_ids",
      "discover_watchlist_ids",
    ]) {
      expect(await cache.get(key)).toBeNull();
    }
    expect(await cache.get(`${MEDIA_DETAILS_KEY_PREFIX}tv_1396`)).toEqual({
      name: "Squid Game",
    });
    expect(await cache.get(`${COLLECTION_KEY_PREFIX}99`)).toEqual({ parts: [] });
    expect(await cache.get(`${META_KEY_PREFIX}bookkeeping`)).toBe(1);
    expect(await cache.get(`${PUBLIC_KEY_PREFIX}discover_data`)).toEqual({
      trending: [],
    });
  });
});

describe("pruneCacheStorage", () => {
  it("does nothing when the budget is not exceeded", async () => {
    await cache.set("small", "x".repeat(100));

    const result = await pruneCacheStorage(CACHE_BYTE_BUDGET);

    expect(result.removed).toBe(0);
    expect(await cache.get("small")).toBe("x".repeat(100));
  });

  it("evicts the oldest entries first", async () => {
    // Timestamps are set explicitly rather than by clock manipulation, so the
    // eviction order being asserted is unambiguous.
    await cache.setEntry("oldest", { data: "a".repeat(200), timestamp: 1_000 });
    await cache.setEntry("middle", { data: "b".repeat(200), timestamp: 2_000 });
    await cache.setEntry("newest", { data: "c".repeat(200), timestamp: 3_000 });

    const result = await pruneCacheStorage(400);

    expect(result.removed).toBeGreaterThan(0);
    expect(await cache.get("newest")).toBe("c".repeat(200));
    expect(await cache.get("oldest")).toBeNull();
  });

  it("brings the total back under the budget", async () => {
    for (let i = 0; i < 30; i++) {
      await cache.setEntry(`entry-${i}`, {
        data: "z".repeat(500),
        timestamp: 1_000 + i,
      });
    }

    const result = await pruneCacheStorage(2_000);

    // The freed figure is what the audit would have measured, so it must leave
    // the store at or below the budget.
    expect(result.remainingBytes).toBeLessThanOrEqual(2_000);
    expect(result.freedBytes).toBeGreaterThan(0);
  });

  it("removes the evicted entries from the memory cache too", async () => {
    // Otherwise an evicted entry would still be served for the rest of the
    // session, which is how a "pruned" cache silently keeps growing.
    await cache.setEntry("gone", { data: "d".repeat(400), timestamp: 1 });
    await cache.setEntry("kept", { data: "e".repeat(100), timestamp: 2 });

    await pruneCacheStorage(200);

    expect(await cache.get("gone")).toBeNull();
  });
});

describe("auditCacheStorage", () => {
  it("attributes bytes to the right logical key", async () => {
    await cache.set("home_schedule", "a".repeat(1000));
    await cache.set("watchlist_items", "b".repeat(10));

    const audit = await auditCacheStorage();

    const schedule = audit.entries.find((entry) => entry.key === "home_schedule");
    const watchlist = audit.entries.find((entry) => entry.key === "watchlist_items");

    expect(schedule?.bytes).toBeGreaterThan(1000);
    expect(watchlist?.bytes).toBeLessThan(100);
    expect(audit.cacheBytes).toBe(audit.entries.reduce((sum, e) => sum + e.bytes, 0));
  });

  it("reports non-cache keys separately", async () => {
    await cache.set("home_schedule", "x");
    await Storage.setItem("nexton_auth_user", "y".repeat(50));

    const audit = await auditCacheStorage();

    expect(audit.otherKeys.map((entry) => entry.key)).toContain("nexton_auth_user");
    expect(audit.entries.map((entry) => entry.key)).not.toContain("nexton_auth_user");
  });
});

describe("purgeLegacyCacheKeys", () => {
  it("removes keys no current code writes", async () => {
    await Storage.setItem("nexton_cache_watchlist_show_progress", "stale");
    await Storage.setItem("nexton_cache_home_watchlist_items", "stale");
    await cache.set("home_schedule", "keep");

    const removed = await purgeLegacyCacheKeys();

    expect(removed).toBe(2);
    expect(await Storage.getItem("nexton_cache_watchlist_show_progress")).toBeNull();
    expect(await cache.get("home_schedule")).toBe("keep");
  });

  it("reports nothing removed on a clean install", async () => {
    expect(await purgeLegacyCacheKeys()).toBe(0);
  });
});
