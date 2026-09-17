// eslint-disable-next-line import/no-unresolved
import AsyncStorage from "@react-native-async-storage/async-storage";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number; // optional, in milliseconds
}

const CACHE_PREFIX = "nexton_cache_";

class CacheManager {
  private memoryCache = new Map<string, any>();

  /**
   * Generates a fully-qualified cache key.
   */
  private getFullKey(key: string): string {
    return `${CACHE_PREFIX}${key}`;
  }

  /**
   * Gets a value from the cache.
   * If not found in memory, it checks AsyncStorage.
   * If the item has expired according to its TTL, it returns null.
   */
  async get<T>(key: string): Promise<T | null> {
    const memoryItem = this.memoryCache.get(key);
    if (memoryItem !== undefined) {
      if (this.isExpired(memoryItem)) {
        this.memoryCache.delete(key);
        // Async cleanup
        AsyncStorage.removeItem(this.getFullKey(key)).catch(() => {});
        return null;
      }
      return memoryItem.data as T;
    }

    try {
      const fullKey = this.getFullKey(key);
      const valueStr = await AsyncStorage.getItem(fullKey);
      if (!valueStr) {
        return null;
      }

      const entry = JSON.parse(valueStr) as CacheEntry<T>;
      if (this.isExpired(entry)) {
        await AsyncStorage.removeItem(fullKey);
        return null;
      }

      // Populate memory cache
      this.memoryCache.set(key, entry);
      return entry.data;
    } catch (err) {
      console.warn(`[CacheManager] Failed to read key "${key}":`, err);
      return null;
    }
  }

  /**
   * Sets a value in both memory and persistent AsyncStorage.
   * @param key Cache key.
   * @param data Data to cache.
   * @param ttl Optional Time-To-Live in milliseconds.
   */
  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    };

    // Update memory cache
    this.memoryCache.set(key, entry);

    try {
      const fullKey = this.getFullKey(key);
      await AsyncStorage.setItem(fullKey, JSON.stringify(entry));
    } catch (err) {
      console.warn(`[CacheManager] Failed to write key "${key}":`, err);
    }
  }

  /**
   * Removes a specific item from both memory and AsyncStorage.
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    try {
      const fullKey = this.getFullKey(key);
      await AsyncStorage.removeItem(fullKey);
    } catch (err) {
      console.warn(`[CacheManager] Failed to delete key "${key}":`, err);
    }
  }

  /**
   * Clears all cache items matching the nexton cache prefix.
   */
  async clearAll(): Promise<void> {
    this.memoryCache.clear();
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const nextonKeys = allKeys.filter((key) => key.startsWith(CACHE_PREFIX));
      if (nextonKeys.length > 0) {
        await AsyncStorage.multiRemove(nextonKeys);
      }
    } catch (err) {
      console.warn("[CacheManager] Failed to clear cache:", err);
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

// All derived, screen-level caches. These must be cleared whenever watchlist or
// watched state changes anywhere in the app (Home schedule, Watchlist list +
// progress, Discover badge ids, plus legacy keys). Keeping the full set in one
// place prevents each screen invalidating only its own subset, which previously
// left the Home schedule stale after titles were added/removed elsewhere.
export const MEDIA_CACHE_KEYS = [
  "watchlist_items",
  "watchlist_show_progress",
  "watchlist_show_progress_v2",
  "home_watchlist_items",
  "home_watched_history",
  "discover_watchlist_ids",
  "home_shows_ready",
  "home_shows_upcoming",
  "home_movies_ready",
  "home_movies_upcoming",
  "home_data",
] as const;

/**
 * Clears every derived media cache. Safe to call after any watchlist/watched
 * mutation (add/remove title, mark/unmark watched, bulk ops, clear history).
 */
export const invalidateMediaCaches = async () => {
  try {
    await Promise.all(MEDIA_CACHE_KEYS.map((key) => cache.delete(key)));
  } catch (err) {
    console.warn("Failed to invalidate media caches:", err);
  }
};
