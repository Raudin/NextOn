import Storage from "expo-sqlite/kv-store";

/**
 * The subset of a key-value store this module needs.
 *
 * The store is now `expo-sqlite/kv-store`, which is API-compatible with
 * AsyncStorage but backed by SQLite. Two reasons for the move: it removes a
 * native module from the build, and it lives in the same SQLite database the
 * local-first store uses, so the app has one storage engine instead of two.
 *
 * The interface is kept so the backing store stays swappable and so tests can
 * inject a fake without touching SQLite.
 */
export interface KVStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiGet(
    keys: readonly string[],
  ): Promise<readonly (readonly [string, string | null])[]>;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number; // optional, in milliseconds
  /**
   * HTTP validator for this response, when the entry came from a cacheable
   * endpoint. Sent back as `If-None-Match` so a revalidation can be answered
   * with a bodyless 304.
   */
  etag?: string;
}

const CACHE_PREFIX = "nexton_cache_";

/**
 * Default lifetime for every entry.
 *
 * Previously several keys (`watchlist_items`, all four `home_*` keys) were
 * written with no TTL at all, which made them immortal: they survived until the
 * user happened to trigger a mutation or log out. A bounded default is the
 * backstop that keeps a bug in any single screen from leaking storage forever.
 */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Byte budget for everything under our namespace.
 *
 * The goal is not to be clever about what to keep, just to guarantee an upper
 * bound: this is a cache, and every entry in it can be rebuilt from the
 * network. Eviction is oldest-first, which is a good proxy for "least likely to
 * be revisited" in an app where the user's current screen is the newest thing
 * written.
 */
export const CACHE_BYTE_BUDGET = 2 * 1024 * 1024;

/**
 * Entry cap for the in-memory mirror of the cache.
 *
 * `CACHE_BYTE_BUDGET` bounds what is on disk but said nothing about the Map
 * held for the life of the session, so a long browse accumulated one parsed
 * payload per key ever read — watchlists, schedules, details for every title
 * opened — and none of it was ever released. Memory is worth far less here
 * than on disk (every entry is re-readable from SQLite), so the cap is small
 * and eviction is silent rather than size-aware.
 */
export const MEMORY_CACHE_MAX_ENTRIES = 50;

// No cast: `SQLiteStorage` satisfies `KVStorage` structurally, so if a future
// version of kv-store changes a signature the compiler will catch it here
// rather than at runtime.
let storage: KVStorage = Storage;

/** Swaps the backing store. Used by tests to inject a fake. */
export const setCacheStorage = (next: KVStorage) => {
  storage = next;
};

/** UTF-8 byte length. `String.length` counts UTF-16 units, which understates
 * the real storage cost for anything outside Latin-1 (show overviews and
 * non-English titles are full of those). */
const utf8Bytes = (value: string): number => {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: the pair encodes a single code point in 4 bytes.
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

/**
 * Key prefixes whose payloads are identical for every user, and which a
 * mutation therefore cannot invalidate.
 *
 *  - `meta_`            bookkeeping, e.g. when the image cache was last cleared.
 *  - `public_`          the Discover feed and anything else app-wide.
 *  - `media_details_v3_` a title's details (cast, images, trailers, ratings).
 *  - `collection_v1_`   a franchise's films.
 *
 * The last two are the reason this list exists. A media detail payload depends
 * on the *title*, not on the signed-in user: marking an episode watched cannot
 * change what TMDB says about a film. Clearing them on every mutation meant the
 * detail screen and the Discover carousels re-downloaded every title they had
 * already fetched, and invalidateMediaCaches runs on each of the detail screen's
 * eight mutation paths and again after every delta pull. Those are the two most
 * expensive payloads in the app (a details response carries the full credits,
 * images and recommendations blocks), so this was the single largest source of
 * avoidable traffic.
 *
 * Everything NOT listed here is treated as user-derived and is cleared. That
 * default is deliberate: a cache key added by a future screen is invalidated
 * correctly without anyone remembering to extend a list, and the cost of
 * over-clearing a user-scoped entry is one refetch rather than stale data.
 */
export const META_KEY_PREFIX = "meta_";
export const PUBLIC_KEY_PREFIX = "public_";
export const MEDIA_DETAILS_KEY_PREFIX = "media_details_v3_";
export const COLLECTION_KEY_PREFIX = "collection_v1_";

/**
 * Cache keys scoped to the signed-in user, in the order they are most likely to
 * be the one that actually changed. Used to make invalidation greppable and to
 * document the intent, even though invalidation itself works by exclusion.
 */
export const USER_SCOPED_KEY_PREFIXES = [
  "home_schedule",
  "watchlist_progress_",
  "watchlist_ids",
  "discover_watchlist_ids",
] as const;

const PROTECTED_KEY_PREFIXES = [
  META_KEY_PREFIX,
  PUBLIC_KEY_PREFIX,
  MEDIA_DETAILS_KEY_PREFIX,
  COLLECTION_KEY_PREFIX,
];

class CacheManager {
  private memoryCache = new Map<string, CacheEntry<any>>();

  /**
   * Generates a fully-qualified cache key.
   */
  private getFullKey(key: string): string {
    return `${CACHE_PREFIX}${key}`;
  }

  /**
   * Records a key as the most recently used.
   *
   * A `Map` iterates in insertion order, so re-inserting an existing key is
   * what moves it to the young end — `set` alone would leave it where it was.
   * That makes the Map's own order the LRU order, with no timestamps, counters
   * or second structure to keep in step.
   */
  private touch(key: string, entry: CacheEntry<any>): void {
    this.memoryCache.delete(key);
    this.memoryCache.set(key, entry);

    // Trim here rather than on a timer: an over-cap cache is only ever caused
    // by an insert, and evicting the oldest read is exactly the LRU rule.
    while (this.memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
      const oldest = this.memoryCache.keys().next();
      if (oldest.done) {
        break;
      }
      this.memoryCache.delete(oldest.value);
    }
  }

  /**
   * Drops the in-memory mirror only.
   *
   * Deliberately not `clearAll`: the memory cache is a pure optimisation over
   * the entries in SQLite, so forgetting it costs a re-read and nothing else.
   * That is what makes this safe under OS memory pressure, where the correct
   * response is to release memory now and refill lazily.
   */
  clearMemory(): void {
    this.memoryCache.clear();
  }

  /**
   * Reads an entry without applying its TTL.
   *
   * Callers that may usefully fall back to a stale value (revalidation, where
   * the entry's `etag` enables a 304) need the entry itself, not just its data.
   */
  async getEntry<T>(key: string): Promise<CacheEntry<T> | null> {
    const memoryItem = this.memoryCache.get(key);
    if (memoryItem !== undefined) {
      // A hit is a use, so it refreshes this entry's place in the eviction
      // order. Skipping this would evict by write order instead, which is the
      // wrong answer for a screen that re-reads the same payload on every focus.
      this.touch(key, memoryItem);
      return memoryItem as CacheEntry<T>;
    }

    try {
      const valueStr = await storage.getItem(this.getFullKey(key));
      if (!valueStr) {
        return null;
      }

      const entry = JSON.parse(valueStr) as CacheEntry<T>;
      this.touch(key, entry);
      return entry;
    } catch (err) {
      console.warn(`[CacheManager] Failed to read key "${key}":`, err);
      return null;
    }
  }

  /**
   * Gets a value from the cache.
   * If not found in memory, it checks persistent storage.
   * If the item has expired according to its TTL, it returns null.
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = await this.getEntry<T>(key);
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      await this.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Writes an entry verbatim, preserving any ETag it carries.
   *
   * The timestamp is refreshed here rather than by the caller so that a `304`
   * revalidation — which keeps the existing data but proves it is still current
   * — cannot accidentally extend freshness without also refreshing the age.
   */
  async setEntry<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    const stored: CacheEntry<T> = { ...entry, timestamp: Date.now() };
    this.touch(key, stored);

    try {
      await storage.setItem(this.getFullKey(key), JSON.stringify(stored));
    } catch (err) {
      console.warn(`[CacheManager] Failed to write key "${key}":`, err);
    }
  }

  /**
   * Sets a value in both memory and persistent storage.
   * @param key Cache key.
   * @param data Data to cache.
   * @param ttl Optional Time-To-Live in milliseconds. Defaults to
   *            `DEFAULT_TTL_MS` so nothing is written without an expiry.
   */
  async set<T>(key: string, data: T, ttl: number = DEFAULT_TTL_MS): Promise<void> {
    await this.setEntry(key, { data, timestamp: Date.now(), ttl });
  }

  /** Records the HTTP validator for an existing entry, so a later request can
   * be answered with a 304. */
  async setEtag(key: string, etag: string | undefined): Promise<void> {
    const entry = await this.getEntry(key);
    if (!entry) {
      return;
    }
    await this.setEntry(key, { ...entry, etag });
  }

  /**
   * Removes a specific item from both memory and storage.
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    try {
      await storage.removeItem(this.getFullKey(key));
    } catch (err) {
      console.warn(`[CacheManager] Failed to delete key "${key}":`, err);
    }
  }

  /**
   * Clears all cache items matching the nexton cache prefix.
   */
  async clearAll(): Promise<void> {
    await this.clearAllExcept([]);
  }

  /**
   * Clears every cache entry whose logical key does not start with one of
   * `protectedPrefixes` (pass an empty list to clear everything).
   */
  async clearAllExcept(protectedPrefixes: string[]): Promise<number> {
    const isProtected = (key: string) =>
      protectedPrefixes.some((prefix) => key.startsWith(prefix));

    for (const key of Array.from(this.memoryCache.keys())) {
      if (!isProtected(key)) {
        this.memoryCache.delete(key);
      }
    }

    try {
      const allKeys = await storage.getAllKeys();
      const doomed = allKeys.filter(
        (key) =>
          key.startsWith(CACHE_PREFIX) &&
          !isProtected(key.slice(CACHE_PREFIX.length)),
      );
      if (doomed.length > 0) {
        await storage.multiRemove([...doomed]);
      }
      return doomed.length;
    } catch (err) {
      console.warn("[CacheManager] Failed to clear cache:", err);
      return 0;
    }
  }

  /**
   * Helper to determine if a cache entry is expired.
   */
  private isExpired(entry: CacheEntry<any>): boolean {
    if (!entry.ttl) {
      return false;
    }
    const age = Date.now() - entry.timestamp;
    return age > entry.ttl;
  }
}

export const cache = new CacheManager();

/**
 * Releases the in-memory cache without touching what is persisted.
 *
 * Two callers, one reason each:
 *
 *  - The OS `memoryWarning` signal, where the whole point is to give memory
 *    back now. Wiping the on-disk entries there would be actively harmful —
 *    the device is short on RAM, not storage, and re-downloading everything
 *    the user had already fetched is the worst possible answer.
 *  - Logout, where the session's parsed payloads should not outlive the
 *    account that produced them. `logout` already clears the durable store;
 *    this is the part `clearAll` cannot reach on its own because it is a
 *    different lifetime.
 *
 * Synchronous on purpose: `Map.clear()` is, and a promise here would only
 * invite a caller to await something that has already happened.
 */
export const clearMemory = (): void => {
  cache.clearMemory();
};

/**
 * Clears every user-derived media cache.
 *
 * Safe to call after any watchlist/watched/favorite mutation. Clears everything
 * except `PROTECTED_KEY_PREFIXES` — the caches whose contents do not depend on
 * who is signed in — so a cache key added by a future screen is invalidated
 * correctly without anyone remembering to extend a list here, while a title's
 * details and a franchise's films survive a mutation that cannot have changed
 * them.
 */
export const invalidateMediaCaches = async () => {
  try {
    await cache.clearAllExcept(PROTECTED_KEY_PREFIXES);
  } catch (err) {
    console.warn("Failed to invalidate media caches:", err);
  }
};

export interface CacheKeyAudit {
  /** Logical key, with the internal storage prefix stripped. */
  key: string;
  bytes: number;
}

export interface CacheAudit {
  totalBytes: number;
  cacheBytes: number;
  entryCount: number;
  /** Largest first, so the biggest blobs are obvious at a glance. */
  entries: CacheKeyAudit[];
  /** Everything under our namespace that is NOT a `cache.set` entry — auth
   * tokens, theme mode, and any legacy keys left behind by older builds. */
  otherKeys: CacheKeyAudit[];
}

/**
 * Reports how many bytes our own storage namespace is holding, broken
 * down per logical key.
 *
 * This exists because the on-device "Cache" figure in Android Settings and
 * "Documents & Data" on iOS mix together two very different things: the
 * expo-image disk cache (which we cannot measure or cap from JS) and our own
 * key-value entries (which we can). Without this breakdown it is impossible to
 * tell which one is actually growing.
 */
export const auditCacheStorage = async (): Promise<CacheAudit> => {
  const empty: CacheAudit = {
    totalBytes: 0,
    cacheBytes: 0,
    entryCount: 0,
    entries: [],
    otherKeys: [],
  };

  try {
    const allKeys = await storage.getAllKeys();
    if (allKeys.length === 0) {
      return empty;
    }

    const pairs = await storage.multiGet(allKeys);

    let totalBytes = 0;
    let cacheBytes = 0;
    const entries: CacheKeyAudit[] = [];
    const otherKeys: CacheKeyAudit[] = [];

    for (const [storageKey, value] of pairs) {
      const bytes = value ? utf8Bytes(value) : 0;
      totalBytes += bytes;

      if (storageKey.startsWith(CACHE_PREFIX)) {
        cacheBytes += bytes;
        entries.push({ key: storageKey.slice(CACHE_PREFIX.length), bytes });
      } else {
        otherKeys.push({ key: storageKey, bytes });
      }
    }

    const bySizeDesc = (a: CacheKeyAudit, b: CacheKeyAudit) => b.bytes - a.bytes;

    return {
      totalBytes,
      cacheBytes,
      entryCount: entries.length,
      entries: entries.sort(bySizeDesc),
      otherKeys: otherKeys.sort(bySizeDesc),
    };
  } catch (err) {
    console.warn("[CacheManager] Failed to audit storage:", err);
    return empty;
  }
};

export interface PruneResult {
  removed: number;
  freedBytes: number;
  remainingBytes: number;
}

/**
 * Enforces `budgetBytes` by evicting the oldest entries.
 *
 * Runs at startup rather than on every write: it has to read every entry to
 * know their sizes and ages, so doing it inline would make writes pay for a
 * full sweep. Startup is also when it matters — it reclaims whatever the
 * previous session accumulated.
 *
 * Never throws: this runs on the launch path and must not be able to break it.
 */
export const pruneCacheStorage = async (
  budgetBytes: number = CACHE_BYTE_BUDGET,
): Promise<PruneResult> => {
  const result: PruneResult = { removed: 0, freedBytes: 0, remainingBytes: 0 };

  try {
    const allKeys = await storage.getAllKeys();
    const cacheKeys = allKeys.filter((key) => key.startsWith(CACHE_PREFIX));
    if (cacheKeys.length === 0) {
      return result;
    }

    const pairs = await storage.multiGet(cacheKeys);

    let totalBytes = 0;
    const candidates: { storageKey: string; bytes: number; timestamp: number }[] =
      [];

    for (const [storageKey, raw] of pairs) {
      const bytes = raw ? utf8Bytes(raw) : 0;
      totalBytes += bytes;

      let timestamp = 0;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as CacheEntry<unknown>;
          timestamp = typeof parsed.timestamp === "number" ? parsed.timestamp : 0;
        } catch {
          // Unparseable entry: treat it as the oldest possible so it is
          // evicted first. A corrupt entry is exactly what we want gone.
          timestamp = 0;
        }
      }
      candidates.push({ storageKey, bytes, timestamp });
    }

    result.remainingBytes = totalBytes;
    if (totalBytes <= budgetBytes) {
      return result;
    }

    candidates.sort((a, b) => a.timestamp - b.timestamp);

    const toRemove: string[] = [];
    let remaining = totalBytes;
    for (const candidate of candidates) {
      if (remaining <= budgetBytes) {
        break;
      }
      toRemove.push(candidate.storageKey);
      remaining -= candidate.bytes;
    }

    if (toRemove.length === 0) {
      return result;
    }

    await storage.multiRemove(toRemove);

    // Keep the memory cache consistent with what is now on disk; without this
    // an evicted entry would still be served from memory for this session.
    for (const storageKey of toRemove) {
      cache.delete(storageKey.slice(CACHE_PREFIX.length));
    }

    result.removed = toRemove.length;
    result.freedBytes = totalBytes - remaining;
    result.remainingBytes = remaining;
    return result;
  } catch (err) {
    console.warn("[CacheManager] Failed to prune cache:", err);
    return result;
  }
};

/**
 * Removes keys under our namespace that no current code path writes. These are
 * leftovers from earlier builds: they were stored without a TTL and are only
 * removed when something triggers a full cache clear, which until now meant
 * they could hold their last-written value indefinitely.
 *
 * Deliberately uses raw storage access and never throws — this runs at startup.
 */
export const LEGACY_CACHE_KEYS = [
  "watchlist_show_progress",
  "home_watchlist_items",
  "home_watched_history",
] as const;

export const purgeLegacyCacheKeys = async (): Promise<number> => {
  let removed = 0;
  try {
    // One `multiGet` and one `multiRemove` rather than a read/write pair per
    // key. Three legacy keys is not a large number, but each of the six calls
    // was a separate SQLite round trip on the launch path.
    const storageKeys = LEGACY_CACHE_KEYS.map((key) => `${CACHE_PREFIX}${key}`);
    const pairs = await storage.multiGet(storageKeys);

    const present: string[] = [];
    for (const [storageKey, value] of pairs) {
      if (value !== null) {
        present.push(storageKey);
      }
    }
    if (present.length === 0) {
      return 0;
    }

    await storage.multiRemove(present);
    for (const storageKey of present) {
      cache.delete(storageKey.slice(CACHE_PREFIX.length));
    }
    removed = present.length;
  } catch (err) {
    console.warn("[CacheManager] Failed to purge legacy keys:", err);
  }
  return removed;
};

/**
 * Startup maintenance: drop dead keys, then enforce the byte budget.
 *
 * Intended to be called once from the root layout. Failures are swallowed —
 * cache maintenance must never prevent the app from starting.
 */
export const runCacheMaintenance = async (): Promise<{
  purgedLegacy: number;
  pruned: PruneResult;
}> => {
  const purgedLegacy = await purgeLegacyCacheKeys();
  const pruned = await pruneCacheStorage();
  return { purgedLegacy, pruned };
};
