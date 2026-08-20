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
