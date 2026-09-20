import Constants from "expo-constants";
import { Platform } from "react-native";

import { cache, DEFAULT_TTL_MS, type CacheEntry } from "@/lib/cache";
import { recordRequest } from "@/lib/telemetry";

/**
 * Transport layer: base-URL resolution, auth, timeouts, retries, a global
 * concurrency ceiling, request coalescing and conditional (ETag) GETs.
 *
 * Kept separate from `media-api.ts` so the endpoint catalogue stays a readable
 * list of URLs and types, and so this file has no dependency on it (the token
 * and 401 handler are injected via `configureHttp`).
 */

// ---------------------------------------------------------------- configuration

export interface HttpConfig {
  getToken: () => string | null;
  /** Invoked on a 401 so the app can clear the session and redirect. */
  onUnauthorized: () => void;
}

let httpConfig: HttpConfig = {
  getToken: () => null,
  onUnauthorized: () => {},
};

export const configureHttp = (next: HttpConfig) => {
  httpConfig = next;
};

// ------------------------------------------------------------------- constants

const DEFAULT_TIMEOUT_MS = 20000;

/** One retry. More than that mostly multiplies load on an unhappy backend. */
const MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 300;

/**
 * Maximum simultaneous in-flight requests.
 *
 * This is the client-side half of the fan-out fix. Screens used to run
 * `Promise.allSettled(watchlist.map(...))` with no bound, so a 60-title
 * watchlist opened 120+ sockets at once and the backend had to answer them all
 * in parallel. A ceiling here bounds the burst regardless of what any screen
 * does, which is more robust than fixing each call site.
 *
 * Six is chosen to keep the connection pool busy without starving the UI of the
 * bandwidth it needs for whatever the user is actually looking at.
 */
const MAX_CONCURRENT_REQUESTS = 6;

// ------------------------------------------------------------------- semaphore

/**
 * A counting semaphore, used to cap concurrent requests.
 *
 * `acquire` resolves with a release function. Callers must call it in a
 * `finally`, or the ceiling permanently ratchets down.
 */
class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return this.release;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active += 1;
    return this.release;
  }

  private release = () => {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  };
}

const requestSemaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);

// ------------------------------------------------------------- base URL lookup

const getBackendBaseUrls = (): string[] => {
  const customUrl = process.env.EXPO_PUBLIC_API_URL;
  const urls: string[] = [];

  if (customUrl) {
    const normalizedUrl = /^https?:\/\//i.test(customUrl)
      ? customUrl
      : `https://${customUrl}`;

    // A configured API URL is authoritative. Falling back to local HTTP
    // endpoints in a production build causes Android to reject the request
    // as cleartext traffic (for example, http://10.0.2.2:8080).
    return [normalizedUrl.replace(/\/$/, "")];
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

// --------------------------------------------------------------------- helpers

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isAbortError = (error: unknown, callerAborted: boolean): boolean => {
  if (callerAborted) {
    return true;
  }
  const name = (error as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "CanceledError" || name === "TimeoutError") {
    return true;
  }
  const message = (error as { message?: string } | null)?.message?.toLowerCase() ?? "";
  return message.includes("aborted") || message.includes("cancel");
};

const abortError = (message: string): Error => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

/**
 * A response the server actually answered with an error.
 *
 * Distinguished from a transport failure so the retry logic does not treat an
 * intended 401/404 as a flaky connection — retrying a 401 would, among other
 * things, fire the session-expiry handler twice.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Reports whether a failure was a transport problem rather than a server
 * response.
 *
 * This is the signal the offline outbox keys off: if the server answered, the
 * request was delivered and must not be queued for replay (a queued 400 would
 * just fail again forever). If nothing answered, the mutation is genuinely
 * pending and is worth retrying on reconnect.
 */
export const isOfflineError = (error: unknown): boolean => {
  if (error instanceof HttpError) {
    return false;
  }
  return !isAbortError(error, false);
};

// -------------------------------------------------------------------- requests

export interface RequestOptions {
  method?: string;
  body?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /**
   * Treat a 304 as a success rather than an error. Only used by
   * `apiFetchWithCache`, which sends `If-None-Match`.
   */
  allowNotModified?: boolean;
}

/**
 * Performs one logical API request, including base-URL fallback, bounded
 * concurrency, one retry on transient failure, and a timeout that is combined
 * with (rather than replaced by) the caller's abort signal.
 */
export async function httpRequest(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  const urls = getBackendBaseUrls();
  const release = await requestSemaphore.acquire();

  try {
    let lastError = "";

    for (const baseUrl of urls) {
      const url = `${baseUrl}${path}`;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (options.signal?.aborted) {
          throw abortError("The operation was aborted.");
        }

        // Each base URL / attempt is a real network call, so it is recorded
        // individually — a misconfigured primary URL shows up as extra
        // requests rather than hiding behind one logical call.
        const attemptStartedAt = Date.now();
        let attemptRecorded = false;

        // Timeout and caller cancellation are combined manually: `AbortSignal.any`
        // is not available on all Hermes versions, and distinguishing the two is
        // needed to decide whether a retry is appropriate.
        const controller = new AbortController();
        let callerAborted = false;
        const onCallerAbort = () => {
          callerAborted = true;
          controller.abort();
        };
        options.signal?.addEventListener("abort", onCallerAbort);
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...(options.headers ?? {}),
          };
          const token = httpConfig.getToken();
          if (token) {
            headers["Authorization"] = `Bearer ${token}`;
          }

          const response = await fetch(url, {
            method,
            body: options.body,
            headers,
            signal: controller.signal,
          });

          recordRequest({
            path,
            durationMs: Date.now() - attemptStartedAt,
            ok: response.ok || (response.status === 304 && !!options.allowNotModified),
            fromCache: response.status === 304,
            status: response.status,
          });
          attemptRecorded = true;

          if (response.status === 304 && options.allowNotModified) {
            return response;
          }

          if (!response.ok) {
            let errorMsg = `HTTP ${response.status} from ${url}`;
            try {
              const errData = await response.json();
              if (errData && errData.error) {
                errorMsg = errData.error;
              }
            } catch {
              // Non-JSON error body; keep the generic message.
            }

            if (
              response.status === 401 &&
              httpConfig.getToken() &&
              !path.includes("/api/auth/login") &&
              !path.includes("/api/auth/signup")
            ) {
              httpConfig.onUnauthorized();
            }

            throw new HttpError(errorMsg, response.status);
          }

          return response;
        } catch (error: unknown) {
          if (isAbortError(error, callerAborted)) {
            // A caller-initiated abort must propagate untouched. A timeout is
            // different: it may just have been a slow request, so it is
            // retryable.
            if (callerAborted) {
              throw abortError(
                (error as { message?: string } | null)?.message ??
                  "The operation was aborted.",
              );
            }

            lastError = "Request timed out";
            if (attempt < MAX_ATTEMPTS && method === "GET") {
              await sleep(RETRY_BASE_DELAY_MS * attempt + Math.random() * 150);
              continue;
            }
            // Fall through to the next candidate base URL (dev setups often
            // have a first URL that is unreachable from the device).
            break;
          }

          // The server answered. Only a 5xx on an idempotent request is worth
          // retrying, and the message is already user-facing.
          if (error instanceof HttpError) {
            if (error.status >= 500 && attempt < MAX_ATTEMPTS && method === "GET") {
              lastError = error.message;
              await sleep(RETRY_BASE_DELAY_MS * attempt + Math.random() * 150);
              continue;
            }
            throw error;
          }

          if (!attemptRecorded) {
            recordRequest({
              path,
              durationMs: Date.now() - attemptStartedAt,
              ok: false,
              fromCache: false,
            });
          }

          lastError = (error as { message?: string } | null)?.message ?? String(error);

          // Transport failure: retry once, then give up on this base URL and
          // try the next one.
          if (attempt < MAX_ATTEMPTS && method === "GET") {
            await sleep(RETRY_BASE_DELAY_MS * attempt + Math.random() * 150);
            continue;
          }

          if (__DEV__) {
            console.warn(`[API] Failed (${url}): ${lastError}`);
          }

          // Transport failure: move on to the next candidate base URL. A
          // server that *answered* with an error never reaches here (that is an
          // HttpError, rethrown above) because the base URL was clearly right.
          break;
        } finally {
          clearTimeout(timeoutId);
          options.signal?.removeEventListener("abort", onCallerAbort);
        }
      }
    }

    throw new Error(
      lastError || `Could not reach the backend. Tried: ${urls.join(", ")}`,
    );
  } finally {
    release();
  }
}

// ------------------------------------------------------------------- coalescing

/**
 * In-flight request coalescing.
 *
 * Home, Watchlist, Discover and the media-detail screen all independently call
 * `fetchWatchlist()`, and navigating from Home into a title fires it again
 * alongside three other requests. Without this, identical GETs issued in the
 * same tick each open their own connection.
 *
 * Only applies to signal-free GETs: sharing a request that a caller can abort
 * would let one screen's cancellation break another's.
 */
const inFlightRequests = new Map<string, Promise<unknown>>();

function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = run().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, promise);
  return promise;
}

// ------------------------------------------------------------------ public API

/** Plain JSON request, with coalescing for cacheable GETs. */
export async function requestJson<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const canCoalesce =
    method === "GET" && !options.signal && !options.body && !options.allowNotModified;

  const run = async (): Promise<T> => {
    const response = await httpRequest(path, options);
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  };

  return canCoalesce ? coalesce(path, run) : run();
}

export interface CachedRequestResult<T> {
  data: T;
  /** True when the value came from storage without a network transfer. */
  fromCache: boolean;
}

export interface CachedRequestOptions {
  /** Logical cache key. Shared by every caller that wants the same payload. */
  cacheKey: string;
  /** Freshness window. Defaults to the cache module's default TTL. */
  ttl?: number;
  signal?: AbortSignal;
}

const isEntryFresh = (entry: CacheEntry<unknown>, ttl: number): boolean =>
  Date.now() - entry.timestamp <= ttl;

/**
 * Conditional GET with local caching.
 *
 * Behaviour, in order:
 *   1. A fresh cached entry is returned with no network call at all.
 *   2. Otherwise the request is sent with `If-None-Match` from the stored ETag.
 *   3. A `304` keeps the cached body and refreshes its freshness — this is the
 *      whole point, since React Native's `fetch` has no HTTP cache and would
 *      otherwise re-download the payload every time.
 *   4. A `200` replaces the entry and stores the new validator.
 *   5. Any failure falls back to the stale entry rather than erroring, so a
 *      flaky connection cannot blank a screen that already has data.
 */
export async function requestJsonCached<T>(
  path: string,
  options: CachedRequestOptions,
): Promise<CachedRequestResult<T>> {
  const ttl = options.ttl ?? DEFAULT_TTL_MS;
  const entry = await cache.getEntry<T>(options.cacheKey);

  if (entry && isEntryFresh(entry, ttl)) {
    // Report the hit so the diagnostics panel can show how much the ETag work
    // is actually saving.
    recordRequest({ path, durationMs: 0, ok: true, fromCache: true });
    return { data: entry.data, fromCache: true };
  }

  const etag = entry?.etag;

  try {
    const response = await httpRequest(path, {
      signal: options.signal,
      allowNotModified: true,
      headers: etag ? { "If-None-Match": etag } : undefined,
    });

    if (response.status === 304 && entry) {
      // Same body, still current: refresh the age without touching the data.
      await cache.setEntry(options.cacheKey, entry);
      return { data: entry.data, fromCache: true };
    }

    const data = (await response.json()) as T;
    await cache.setEntry(options.cacheKey, {
      data,
      timestamp: Date.now(),
      ttl,
      etag: response.headers.get("ETag") ?? undefined,
    });
    return { data, fromCache: false };
  } catch (error) {
    if (entry) {
      if (__DEV__) {
        console.warn(
          `[API] Revalidation failed for ${path}; serving cached data:`,
          error,
        );
      }
      return { data: entry.data, fromCache: true };
    }
    throw error;
  }
}
