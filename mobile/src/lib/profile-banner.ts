import { cache } from "@/lib/cache";
import { imageUrl } from "@/lib/images";
import {
  fetchMediaDetails,
  type WatchedItem,
} from "@/lib/media-api";

export interface ProfileBannerInfo {
  backdropUrl: string;
  mediaTitle?: string;
  updatedAt: number;
}

const PROFILE_BANNER_CACHE_KEY = "profile_banner_backdrop_v1";
/** 7 days in milliseconds */
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Curated high-res default backdrop (The Americans / cinematic dark tone)
const DEFAULT_BACKDROP_PATH = "/h9Wz6p4fD961s0O5W42y8H0C0XW.jpg"; // Fallback backdrop
const DEFAULT_BACKDROP_FALLBACK_URL = "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&q=80";

/**
 * Resolves the backdrop image for the profile banner.
 *
 * 1. Checks SQLite-backed persistent cache for an active 7-day backdrop.
 * 2. If missing or expired, scans recently watched titles to find a media item with a backdrop.
 * 3. Saves the resolved backdrop with a 7-day TTL so it stays stable and refreshes weekly.
 */
export async function getProfileBannerBackdrop(
  watchedHistory: WatchedItem[],
): Promise<string> {
  // 1. Check existing cached backdrop
  try {
    const cached = await cache.get<ProfileBannerInfo>(PROFILE_BANNER_CACHE_KEY);
    if (cached && cached.backdropUrl) {
      return cached.backdropUrl;
    }
  } catch {
    // Storage read failure: proceed to resolve fresh backdrop
  }

  // 2. Find a recently watched title with a valid backdrop
  let selectedUrl = "";
  let selectedTitle = "";

  if (watchedHistory && watchedHistory.length > 0) {
    // Sort descending by watched date
    const sorted = [...watchedHistory].sort((a, b) => {
      const timeA = a.watched_at ? new Date(a.watched_at).getTime() : 0;
      const timeB = b.watched_at ? new Date(b.watched_at).getTime() : 0;
      return timeB - timeA;
    });

    // Inspect the top 6 most recent unique media titles
    const seenMediaIds = new Set<number>();
    const candidates: WatchedItem[] = [];
    for (const item of sorted) {
      if (item.media_id && !seenMediaIds.has(item.media_id)) {
        seenMediaIds.add(item.media_id);
        candidates.push(item);
        if (candidates.length >= 6) break;
      }
    }

    for (const candidate of candidates) {
      try {
        const details = await fetchMediaDetails(
          candidate.media_type || "tv",
          candidate.media_id,
        );
        if (details.backdrop_path) {
          selectedUrl = imageUrl(details.backdrop_path, "backdrop");
          selectedTitle = details.title || details.name || "";
          break;
        }
      } catch {
        // Continue to next candidate if lookup fails
      }
    }
  }

  // 3. Fallback if no watched items with a backdrop were found
  if (!selectedUrl) {
    selectedUrl = DEFAULT_BACKDROP_FALLBACK_URL;
  }

  // 4. Save to persistent cache with 1-week TTL
  try {
    await cache.set<ProfileBannerInfo>(
      PROFILE_BANNER_CACHE_KEY,
      {
        backdropUrl: selectedUrl,
        mediaTitle: selectedTitle,
        updatedAt: Date.now(),
      },
      ONE_WEEK_MS,
    );
  } catch {
    // Non-fatal cache write error
  }

  return selectedUrl;
}
