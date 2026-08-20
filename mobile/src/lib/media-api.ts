import Constants from "expo-constants";
import { Platform } from "react-native";

export const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
export const PROFILE_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w185";
export const BACKDROP_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w780";

export interface TMDBMedia {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  backdrop_path: string;
  vote_average: number;
  media_type?: "movie" | "tv";
  release_date?: string;
  first_air_date?: string;
  created_at?: string;
}

export interface Genre {
  id: number;
  name: string;
}

export interface CastMember {
  id: number;
  name: string;
  profile_path: string;
}

export interface Season {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  episode_count: number;
  poster_path?: string;
}

export interface MediaImage {
  file_path: string;
  aspect_ratio: number;
  width: number;
  height: number;
}

export interface MediaVideo {
  key: string;
  name: string;
  site: string;
  type: string;
}

export interface MediaDetails extends TMDBMedia {
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  seasons?: Season[];
  overview: string;
  genres: Genre[];
  cast: CastMember[];
  logos?: MediaImage[];
  trailers?: MediaVideo[];
  status?: string;
  tagline?: string;
  network?: string;
}

export interface Episode {
  id: number;
  name: string;
  overview: string;
  episode_number: number;
  season_number: number;
  still_path?: string;
  air_date?: string;
  runtime?: number;
}

export interface SeasonDetails {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  episodes: Episode[];
}

export interface WatchedItem {
  user_id?: string;
  media_id: number;
  media_type: "movie" | "tv";
  season_number?: number;
  episode_number?: number;
  watched_at?: string;
}

export interface WatchedStatusResponse {
  watched?: boolean;
  episodes?: { season: number; episode: number }[];
}

export interface DiscoverResponse {
  trending: TMDBMedia[];
  popular: TMDBMedia[];
  popular_series: TMDBMedia[];
}

export interface User {
  id: number;
  email: string;
  name?: string;
  avatar_url?: string;
  notifications_enabled?: boolean;
  created_at?: string;
}

export interface ProfileStats {
  total_movies_watched: number;
  total_episodes_watched: number;
  total_watch_time_minutes: number;
  current_xp: number;
  current_level: number;
  streak_days: number;
}

export interface ProfileResponse {
  user: User;
  stats: ProfileStats;
}

export interface AuthResponse {
  token: string;
  user: User;
}

let authToken: string | null = null;

export function setApiToken(token: string | null) {
  authToken = token;
}

type UnauthorizedCallback = () => void;
let unauthorizedCallback: UnauthorizedCallback | null = null;

export function registerUnauthorizedCallback(callback: UnauthorizedCallback) {
  unauthorizedCallback = callback;
}

const getBackendBaseUrls = (): string[] => {
  const customUrl = process.env.EXPO_PUBLIC_API_URL;
  const urls: string[] = [];

  if (customUrl) {
    urls.push(customUrl.replace(/\/$/, ""));
  }

  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.manifest2?.launchAsset?.url ??
    "";
  const hostIp = hostUri.split(":")[0];

  if (hostIp && hostIp !== "localhost" && hostIp !== "127.0.0.1") {
    urls.push(`http://${hostIp}:8080`);
  }

  if (Platform.OS === "android") {
    urls.push("http://localhost:8080");
    urls.push("http://10.0.2.2:8080");
  } else {
    urls.push("http://localhost:8080");
  }

  return [...new Set(urls)];
};

export const imageUrl = (path?: string | null, base = IMAGE_BASE_URL) =>
  path ? `${base}${path}` : "";

export const mediaTitle = (item: TMDBMedia) =>
  item.title || item.name || "Untitled";

export const mediaDate = (item: TMDBMedia) =>
  item.release_date || item.first_air_date || "";

export const releaseYear = (item: TMDBMedia) => {
  const date = mediaDate(item);
  return date ? new Date(date).getFullYear().toString() : "";
};

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const urls = getBackendBaseUrls();
  let lastError = "";

  for (const baseUrl of urls) {
    // If the request was already aborted, exit immediately
    if (init?.signal?.aborted) {
      const abortErr = new Error("The operation was aborted.");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    const url = `${baseUrl}${path}`;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, value]) => {
            headers[key] = value;
          });
        } else {
          Object.assign(headers, init.headers);
        }
      }
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const response = await fetch(url, {
        ...init,
        headers,
        signal: init?.signal ?? AbortSignal.timeout(6000),
      });
      if (!response.ok) {
        // Parse error payload from backend if available
        let errorMsg = `HTTP ${response.status} from ${url}`;
        const isUnauthorized = response.status === 401;
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errorMsg = errData.error;
          }
        } catch {
          // ignore
        }

        if (
          isUnauthorized &&
          authToken &&
          !path.includes("/api/auth/login") &&
          !path.includes("/api/auth/signup")
        ) {
          if (unauthorizedCallback) {
            unauthorizedCallback();
          }
        }

        throw new Error(errorMsg);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    } catch (error: any) {
      const isAbort =
        error?.name === "AbortError" ||
        error?.name === "CanceledError" ||
        init?.signal?.aborted ||
        error?.message?.toLowerCase().includes("aborted") ||
        error?.message?.toLowerCase().includes("cancel");

      if (isAbort) {
        const abortErr = new Error(
          error?.message || "The operation was aborted.",
        );
        abortErr.name = "AbortError";
        throw abortErr;
      }

      lastError = error.message || String(error);
      console.warn(`[API] Failed (${url}): ${lastError}`);
    }
  }

  throw new Error(
    lastError || `Could not reach the backend. Tried: ${urls.join(", ")}`,
  );
}

export const fetchDiscover = () => apiFetch<DiscoverResponse>("/api/discover");

export const searchMedia = (query: string, signal?: AbortSignal) =>
  apiFetch<TMDBMedia[]>(`/api/search?q=${encodeURIComponent(query)}`, {
    signal,
  });

export const loginUser = (payload: any) =>
  apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const signupUser = (payload: any) =>
  apiFetch<AuthResponse>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export interface FavoriteStatusResponse {
  favorited: boolean;
}

export const fetchWatchlist = (options?: {
  userId?: string;
  filterWatched?: boolean;
}) => {
  const params = new URLSearchParams();
  if (options?.filterWatched) {
    params.set("filter_watched", "true");
  }
  return apiFetch<TMDBMedia[]>(`/api/watchlist?${params.toString()}`);
};

export const addToWatchlist = (item: TMDBMedia) =>
  apiFetch<TMDBMedia>("/api/watchlist", {
    method: "POST",
    body: JSON.stringify(item),
  });

export const removeFromWatchlist = (id: number) =>
  apiFetch<void>(`/api/watchlist/${id}`, { method: "DELETE" });

export const fetchFavorites = () => apiFetch<TMDBMedia[]>("/api/favorites");

export const addToFavorites = (item: TMDBMedia) =>
  apiFetch<TMDBMedia>("/api/favorites", {
    method: "POST",
    body: JSON.stringify(item),
  });

export const removeFromFavorites = (id: number) =>
  apiFetch<void>(`/api/favorites/${id}`, { method: "DELETE" });

export const fetchFavoriteStatus = (mediaId: string | number) =>
  apiFetch<FavoriteStatusResponse>(`/api/favorites/status?media_id=${mediaId}`);

export const fetchMediaDetails = (type: string, id: string | number) =>
  apiFetch<MediaDetails>(`/api/media/${type}/${id}`);

export const fetchWatchedStatus = (
  mediaId: string | number,
  mediaType: string,
) =>
  apiFetch<WatchedStatusResponse>(
    `/api/watched/status?media_id=${mediaId}&type=${mediaType}`,
  );

export const fetchWatchedHistory = () =>
  apiFetch<WatchedItem[]>("/api/watched");

export const markWatched = (payload: Omit<WatchedItem, "watched_at">) =>
  apiFetch<WatchedItem>("/api/watched", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const markWatchedBulk = (items: Omit<WatchedItem, "watched_at">[]) =>
  apiFetch<{ added: number }>("/api/watched/bulk", {
    method: "POST",
    body: JSON.stringify({ items }),
  });

export const unmarkWatched = (payload: Omit<WatchedItem, "watched_at">) =>
  apiFetch<void>("/api/watched", {
    method: "DELETE",
    body: JSON.stringify(payload),
  });

export const fetchSeasonEpisodes = (
  seriesId: string | number,
  season: number,
) => apiFetch<SeasonDetails>(`/api/media/tv/${seriesId}/season/${season}`);

export const fetchEpisodeDetails = (
  seriesId: string | number,
  season: number,
  episode: number,
) =>
  apiFetch<Episode>(
    `/api/media/tv/${seriesId}/season/${season}/episode/${episode}`,
  );

export const fetchUserProfile = () => apiFetch<ProfileResponse>("/api/profile");

export const updateUserProfile = (payload: {
  name?: string;
  avatar_url?: string;
  notifications_enabled?: boolean;
}) =>
  apiFetch<User>("/api/profile", {
    method: "PUT",
    body: JSON.stringify(payload),
  });

export const clearWatchHistory = () =>
  apiFetch<{ message: string }>("/api/profile/clear-history", {
    method: "POST",
  });

export const deleteUserAccount = () =>
  apiFetch<{ message: string }>("/api/profile/account", {
    method: "DELETE",
  });
