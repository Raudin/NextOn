import { Image } from "expo-image";

import { cache } from "@/lib/cache";

/**
 * expo-image disk cache maintenance.
 *
 * There is no way to cap or even *measure* expo-image's disk cache from
 * JavaScript: it is SDWebImage on iOS and Glide on Android, and the library
 * exposes no size getter and no limit setter. `clearDiskCache()` is the only
 * lever available.
 *
 * So the strategy is:
 *   - shrink what goes in (see `lib/images.ts` role sizing and cachePolicy),
 *   - clear generationaly so it cannot grow without bound over months of use,
 *   - and give the user an explicit way out, which matters most on iOS where
 *     the OS offers no per-app "clear cache" action at all.
 *
 * The real size is only visible in platform settings:
 *   Android  Settings > Apps > NextOn > Storage > Cache
 *   iOS      Settings > General > iPhone Storage > NextOn > Documents & Data
 */

const LAST_CLEARED_KEY = "meta_image_cache_cleared_at";

/**
 * How often the disk cache is reset. Long enough that it never interferes with
 * a normal session, short enough that a heavy user's footprint cannot grow
 * indefinitely.
 */
const CLEAR_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ImageCacheMaintenanceResult {
  cleared: boolean;
  /** Milliseconds since the previous clear, or null when never recorded. */
  ageMs: number | null;
}

/**
 * Clears the image disk cache when the last clear is older than
 * `CLEAR_INTERVAL_MS`.
 *
 * Never throws: this runs on the launch path, and a cache that cannot be
 * cleared is a storage problem, not a reason to fail startup.
 */
export const maintainImageCache = async (): Promise<ImageCacheMaintenanceResult> => {
  try {
    const stored = await cache.get<number>(LAST_CLEARED_KEY);
    const lastCleared = typeof stored === "number" ? stored : null;

    if (lastCleared !== null && Date.now() - lastCleared < CLEAR_INTERVAL_MS) {
      return { cleared: false, ageMs: Date.now() - lastCleared };
    }

    await Image.clearDiskCache();
    // Use a long TTL: this marker must survive far longer than the default
    // cache lifetime, otherwise the "last cleared" record expires and every
    // launch would clear the cache again.
    await cache.set(LAST_CLEARED_KEY, Date.now(), CLEAR_INTERVAL_MS * 4);

    return { cleared: true, ageMs: lastCleared === null ? null : Date.now() - lastCleared };
  } catch (err) {
    console.warn("[image-cache] Maintenance failed:", err);
    return { cleared: false, ageMs: null };
  }
};

/**
 * Clears both image caches unconditionally. Wired to the Profile preference so
 * a user who is low on storage has a way to reclaim it without reinstalling.
 */
export const clearImageCache = async (): Promise<boolean> => {
  try {
    await Image.clearMemoryCache();
    await Image.clearDiskCache();
    await cache.set(LAST_CLEARED_KEY, Date.now(), CLEAR_INTERVAL_MS * 4);
    return true;
  } catch (err) {
    console.warn("[image-cache] Clear failed:", err);
    return false;
  }
};

/** When the disk cache was last cleared, for the diagnostics panel. */
export const lastImageCacheClearAt = async (): Promise<number | null> => {
  const stored = await cache.get<number>(LAST_CLEARED_KEY);
  return typeof stored === "number" ? stored : null;
};
