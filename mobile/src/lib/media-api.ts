import {
  configureHttp,
  requestJson,
  requestJsonCached,
  type RequestOptions,
} from "@/lib/http";
import { mutateWithOutboxFallback } from "@/lib/mutations";

// Image sizing now lives in `lib/images.ts`, keyed by the role the artwork plays
// (list cell, grid card, hero backdrop, ...). The old fixed `w500`/`w780` base
// URLs that used to live here are gone: requesting w500 for a 60pt cell was the
// single largest contributor to the on-device image cache.

export interface TMDBMedia {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  backdrop_path: string;
  vote_average: number;
  imdb_rating?: number;
  metascore?: number;
  rotten_tomatoes?: number;
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
  /**
   * The role the actor plays in this title ("Luke Skywalker"). Optional: the
   * server omits it when TMDB leaves it blank, and mock/fallback payloads have
   * no credits at all, so the cast cell hides the second line rather than
   * rendering an empty one.
   */
  character?: string;
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
  /** Community score, used to rank alternate poster variants. */
  vote_average?: number;
  /** ISO-639-1 code, or empty for language-neutral artwork. */
  iso_639_1?: string;
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
  /**
   * Alternate poster variants, ranked server-side. The list cards always show
   * `poster_path`, so the detail hero prefers one of these to avoid repeating
   * the exact artwork the user just tapped. Absent on older cached payloads
   * and on mock data, in which case the hero falls back to `poster_path`.
   */
  posters?: MediaImage[];
  trailers?: MediaVideo[];
  status?: string;
  tagline?: string;
  network?: string;
  /**
   * Age rating — "PG", "PG-13", "R", "TV-MA", "TV-14" — resolved server-side
   * from TMDB's per-country release dates (movies) or content ratings (TV),
   * preferring the US entry. Absent when no rating could be resolved anywhere,
   * in which case the meta row simply omits the badge.
   */
  certification?: string;
  /**
   * The film franchise this title belongs to, if any. Movies only: TMDB does
   * not model collections for TV. Summary only — the films themselves come from
   * `fetchCollection`, which the detail screen requests only when this exists.
   */
  collection?: MediaCollectionSummary;
  /**
   * "More like this" titles for the detail screen's related row. Trimmed,
   * capped and de-duplicated against this title server-side, so the client can
   * render it directly. Absent when TMDB has nothing to suggest.
   */
  recommendations?: TMDBMedia[];
}

/** A film franchise, as embedded in the details payload. */
export interface MediaCollectionSummary {
  id: number;
  name: string;
  poster_path?: string;
  backdrop_path?: string;
}

/** A franchise and its films, as returned by `fetchCollection`. */
export interface CollectionDetails {
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  backdrop_path: string;
  /** The franchise's films, oldest first. */
  parts: TMDBMedia[];
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
  /** Only present when the caller opts in with `includeTvProgress`. */
  tv_progress?: TvProgress;
}

/**
 * Progress for the media-detail hero, fetched per title rather than per list.
 *
 * `caught_up` here means "nothing that has already aired is left unwatched",
 * which is deliberately *not* `ShowProgress.caught_up` (fully watched among
 * announced episodes): a viewer who is up to date mid-season still has
 * announced-but-unaired episodes outstanding but is caught up in the sense the
 * "Next: 3 days" pill cares about.
 */
export interface TvProgress {
  watched_episodes: number;
  total_episodes: number;
  progress: number;
  /** False while a show has not started airing yet. */
  released: boolean;
  caught_up: boolean;
  /** The first unwatched episode, when there is one. */
  next_episode?: Episode;
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
  configureHttp({ getToken: () => authToken, onUnauthorized: handleUnauthorized });
}

type UnauthorizedCallback = () => void;
let unauthorizedCallback: UnauthorizedCallback | null = null;

/** Invoked by the transport on a 401 so the app can clear the session. */
const handleUnauthorized = () => {
  unauthorizedCallback?.();
};

export function registerUnauthorizedCallback(callback: UnauthorizedCallback) {
  unauthorizedCallback = callback;
  configureHttp({ getToken: () => authToken, onUnauthorized: handleUnauthorized });
}

export const mediaTitle = (item: TMDBMedia) =>
  item.title || item.name || "Untitled";

export const mediaDate = (item: TMDBMedia) =>
  item.release_date || item.first_air_date || "";

/**
 * Freshness windows for the two cached list payloads.
 *
 * Kept short because the server already answers unchanged payloads with a 304
 * (a header comparison, no database work), so revalidating often is cheap. The
 * window only exists to avoid a network round trip while a user is moving
 * between tabs.
 */
const HOME_SCHEDULE_TTL_MS = 60 * 1000;
const WATCHLIST_TTL_MS = 60 * 1000;

/**
 * Media details are effectively immutable (cast, runtime, artwork), so they are
 * kept far longer than list payloads. Ratings can drift, but the server
 * revalidates them with an ETag when the entry does expire.
 */
const MEDIA_DETAILS_TTL_MS = 12 * 60 * 60 * 1000;

export const releaseYear = (item: TMDBMedia) => {
  const date = mediaDate(item);
  return date ? new Date(date).getFullYear().toString() : "";
};

/**
 * Normalises the several shapes `HeadersInit` can take into a plain object.
 *
 * The transport takes a plain record because it needs to merge in the auth
 * header, which is awkward to do through the `Headers` API.
 */
const normalizeHeaders = (
  headers?: HeadersInit,
): Record<string, string> | undefined => {
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers as [string, string][]);
  }
  return headers as Record<string, string>;
};

const toRequestOptions = (init?: RequestInit): RequestOptions => {
  if (!init) {
    return {};
  }
  return {
    method: init.method,
    // Only string bodies are supported; every call site passes
    // `JSON.stringify(...)`. Anything else would silently send nothing.
    body: typeof init.body === "string" ? init.body : undefined,
    signal: init.signal ?? undefined,
    headers: normalizeHeaders(init.headers),
  };
};

/**
 * Performs an API request and parses the JSON body.
 *
 * A thin wrapper: base-URL fallback, bounded concurrency, retries, request
 * timeouts, in-flight coalescing and 401 handling all live in `lib/http.ts`.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return requestJson<T>(path, toRequestOptions(init));
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

// ------------------------------------------------------------ home schedule

/**
 * Trimmed media details as returned by the schedule endpoint.
 *
 * Deliberately not `MediaDetails`: the server sends only what the schedule
 * cards render, which is what keeps the four schedule lists small enough to
 * cache. The full details (cast, logos, trailers, overviews) are fetched by the
 * media-detail screen instead.
 */
export interface MediaDetailsLite {
  id: number;
  runtime?: number;
  episode_run_time?: number[];
  tagline?: string;
  status?: string;
  release_date?: string;
  first_air_date?: string;
  seasons?: { season_number: number; episode_count: number }[];
}

export interface HomeShowItem {
  show: TMDBMedia;
  details: MediaDetailsLite;
  episode: Episode;
  formatted_date: string;
  is_new_season: boolean;
  is_season_finale: boolean;
  /**
   * Episodes that have already aired and are still unwatched — the backlog the
   * Home poster's count badge shows.
   *
   * Server-computed on purpose: this payload has no watched counts, so working
   * it out here would have to count announced-but-unaired episodes too.
   * Optional because a schedule cached by an older build has no such field.
   */
  episodes_remaining?: number;
}

export interface HomeMovieItem {
  movie: TMDBMedia;
  details: MediaDetailsLite;
  formatted_date: string;
}

export interface HomeScheduleResponse {
  generated_at: string;
  shows_ready: HomeShowItem[];
  shows_upcoming: HomeShowItem[];
  movies_ready: HomeMovieItem[];
  movies_upcoming: HomeMovieItem[];
}

/**
 * The whole Home schedule in one request.
 *
 * Replaces the previous fan-out (watchlist + a watched-status and details call
 * per title, plus a full season fetch per season searched) which cost ~4
 * requests per watchlist entry.
 *
 * A failure falls back to the last cached schedule instead of throwing, so a
 * flaky connection shows stale data rather than an error screen.
 */
export const fetchHomeSchedule = async (): Promise<HomeScheduleResponse> => {
  const { data } = await requestJsonCached<HomeScheduleResponse>(
    "/api/home/schedule",
    { cacheKey: "home_schedule", ttl: HOME_SCHEDULE_TTL_MS },
  );
  return data;
};

// -------------------------------------------------------- watchlist + progress

/** Server-computed per-show progress, so the client needs no per-show calls. */
export interface ShowProgress {
  watched_episodes: number;
  total_episodes: number;
  progress: number;
  released: boolean;
  caught_up: boolean;
}

/** A watchlist row with its progress attached, as returned by `include=progress`. */
export interface WatchlistEntry extends TMDBMedia {
  progress?: ShowProgress;
}

export interface WatchlistProgressResponse {
  generated_at: string;
  items: WatchlistEntry[];
}

/**
 * Watchlist with server-computed progress.
 *
 * The Watchlist screen previously issued two requests per TV show (watched
 * status + media details) on every load, and re-ran the whole batch whenever
 * the list identity changed -- which happens twice on a cold start.
 */
export const fetchWatchlistWithProgress = async (options?: {
  filterWatched?: boolean;
}): Promise<WatchlistEntry[]> => {
  const params = new URLSearchParams({ include: "progress" });
  if (options?.filterWatched) {
    params.set("filter_watched", "true");
  }
  const key = `watchlist_progress_${options?.filterWatched ? "filtered" : "all"}`;
  const { data } = await requestJsonCached<WatchlistProgressResponse>(
    `/api/watchlist?${params.toString()}`,
    { cacheKey: key, ttl: WATCHLIST_TTL_MS },
  );
  return data.items ?? [];
};

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

// ------------------------------------------------------------------ delta sync

export interface SyncCollectionState {
  version: number;
  count: number;
}

export interface SyncStateResponse {
  version: number;
  collections: Record<string, SyncCollectionState>;
}

export interface SyncOp {
  id: number;
  user_id: number;
  version: number;
  collection: string;
  op_type: "upsert" | "delete";
  entity_key: string;
  payload?: string;
  created_at: string;
}

export interface SyncChangeResponse {
  version: number;
  changes: SyncOp[];
  /**
   * Set when the client's cursor has fallen outside the server's change-log
   * retention window, so `changes` is incomplete and the client must rebuild
   * from a full fetch rather than trusting a partial delta.
   */
  resync_required: boolean;
}

/** Cheap "has anything changed for me?" probe. */
export const fetchSyncState = () => apiFetch<SyncStateResponse>("/api/sync/state");

/** Every change after the client's cursor. */
export const fetchSyncChanges = (since: number) =>
  apiFetch<SyncChangeResponse>(`/api/sync/changes?since=${since}`);

// -------------------------------------------------------------- mutations
//
// Every mutation goes through `mutateWithOutboxFallback`: attempted against the
// server, and queued for replay only when the request could not be delivered.
// Callers receive `undefined` in the queued case and treat it as success,
// because the screens update their own state optimistically.

export const addToWatchlist = (item: TMDBMedia) =>
  mutateWithOutboxFallback<TMDBMedia>(
    "POST",
    "/api/watchlist",
    JSON.stringify(item),
  );

export const removeFromWatchlist = (id: number) =>
  mutateWithOutboxFallback<void>("DELETE", `/api/watchlist/${id}`);

export const fetchFavorites = () => apiFetch<TMDBMedia[]>("/api/favorites");

export const addToFavorites = (item: TMDBMedia) =>
  mutateWithOutboxFallback<TMDBMedia>(
    "POST",
    "/api/favorites",
    JSON.stringify(item),
  );

export const removeFromFavorites = (id: number) =>
  mutateWithOutboxFallback<void>("DELETE", `/api/favorites/${id}`);

export const fetchFavoriteStatus = (mediaId: string | number) =>
  apiFetch<FavoriteStatusResponse>(`/api/favorites/status?media_id=${mediaId}`);

/**
 * Full media details for the detail screen.
 *
 * Cached locally with a long TTL: a title's cast, runtime and artwork do not
 * change, and this endpoint was previously re-fetched on every open — including
 * navigating back into a title already viewed. The server also sends an ETag,
 * so a revalidation after the TTL is a header comparison rather than a rebuild.
 *
 * Watched and favourite *status* are deliberately not part of this: they are
 * per-user and change constantly, and the detail screen fetches them
 * separately.
 *
 * The `_v3` key is deliberate, as `_v2` was before it: a fresh entry is reused
 * without revalidating, so a payload cached by an older build would keep hiding
 * whatever the backend has since started returning. v3 added `certification`,
 * `collection` and `recommendations`; without the bump, a title opened before
 * this shipped would render without any of them for a further 12 hours. The
 * version bump costs one refetch per title opened and lets the old keys age out
 * on their own.
 */
export const fetchMediaDetails = async (
  type: string,
  id: string | number,
): Promise<MediaDetails> => {
  const { data } = await requestJsonCached<MediaDetails>(
    `/api/media/${type}/${id}`,
    {
      cacheKey: `media_details_v3_${type}_${id}`,
      ttl: MEDIA_DETAILS_TTL_MS,
    },
  );
  return data;
};

/**
 * A film franchise and its films, for the detail screen's collection row.
 *
 * Requested only when a movie's details report a `collection`, which is why it
 * is a separate call rather than part of the details payload: the server has to
 * make a second TMDB request to build it, and the row sits below the fold.
 *
 * Cached like the details themselves — a franchise's membership changes on the
 * scale of years — and revalidated by ETag afterwards.
 */
export const fetchCollection = async (
  collectionId: number,
): Promise<CollectionDetails> => {
  const { data } = await requestJsonCached<CollectionDetails>(
    `/api/media/collection/${collectionId}`,
    {
      cacheKey: `collection_v1_${collectionId}`,
      ttl: MEDIA_DETAILS_TTL_MS,
    },
  );
  return data;
};

/**
 * Watched state for one title.
 *
 * `includeTvProgress` asks the server for the extra `tv_progress` payload the
 * media-detail hero draws (whole-show progress plus the next unwatched
 * episode). It is opt-in because it is the only part of the response that costs
 * a TMDB lookup; every other caller wants just the watched rows.
 */
export const fetchWatchedStatus = (
  mediaId: string | number,
  mediaType: string,
  options?: { includeTvProgress?: boolean },
) =>
  apiFetch<WatchedStatusResponse>(
    `/api/watched/status?media_id=${mediaId}&type=${mediaType}${
      options?.includeTvProgress ? "&include=tv_progress" : ""
    }`,
  );

export const fetchWatchedHistory = () =>
  apiFetch<WatchedItem[]>("/api/watched");

export const markWatched = (payload: Omit<WatchedItem, "watched_at">) =>
  mutateWithOutboxFallback<WatchedItem>(
    "POST",
    "/api/watched",
    JSON.stringify(payload),
  );

export const markWatchedBulk = (items: Omit<WatchedItem, "watched_at">[]) =>
  mutateWithOutboxFallback<{ added: number }>(
    "POST",
    "/api/watched/bulk",
    JSON.stringify({ items }),
  );

/**
 * Removes many watched episodes in one request.
 *
 * Replaces the old per-episode DELETEs: clearing a ten-season show used to mean
 * ~200 sequential requests. Omitting `episodes` clears every watched row for the
 * title.
 */
export const unmarkWatchedBulk = (
  payload: Pick<WatchedItem, "media_id" | "media_type"> & {
    episodes?: { season: number; episode: number }[];
  },
) =>
  mutateWithOutboxFallback<{ deleted: number }>(
    "POST",
    "/api/watched/bulk-delete",
    JSON.stringify(payload),
  );

export const unmarkWatched = (payload: Omit<WatchedItem, "watched_at">) =>
  mutateWithOutboxFallback<void>(
    "DELETE",
    "/api/watched",
    JSON.stringify(payload),
  );

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
  mutateWithOutboxFallback<{ message: string }>(
    "POST",
    "/api/profile/clear-history",
  );

export const deleteUserAccount = () =>
  apiFetch<{ message: string }>("/api/profile/account", {
    method: "DELETE",
  });
