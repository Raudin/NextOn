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

// ------------------------------------------------------------------- session

let unauthorizedHandled = false;

/**
 * Identifies the current credential session.
 *
 * Bumped by `beginNewSession` on every credential change, which lets a request
 * that was already in flight when the session ended notice that it is no longer
 * authoritative and refuse to publish its result.
 *
 * This is a plain module-level variable rather than an atomic or a ref because
 * the React Native JS thread is single-threaded: no two calls can observe a
 * torn increment. If this module ever runs in a worker or SSR context where
 * that guarantee does not hold, this must be replaced with a thread-safe
 * counter.
 */
let sessionId = 0;

/**
 * Marks the start of a new credential session: a login, a logout, or the
 * restore of a stored token at boot.
 *
 * Credentials are the thing the 401 latch and the session guard are both
 * relative to, so resetting them together is what keeps the two from
 * disagreeing — a fresh session must be able to observe its own 401, and a
 * request from the previous session must not be able to write to the new one's
 * cache.
 */
export const beginNewSession = (): void => {
  sessionId += 1;
  unauthorizedHandled = false;
};

/** The session a request belongs to. Captured before the request is sent. */
export const currentSessionId = (): number => sessionId;

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
              !path.includes("/api/auth/signup") &&
              !unauthorizedHandled
            ) {
              // Latch before invoking, not after: the handler is async and
              // logging out does not synchronously change the token this check
              // reads, so without the latch every concurrent 401 — a screen
              // firing six requests, all answered 401 — would run its own
              // logout, clear the cache and navigate again.
              unauthorizedHandled = true;
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
  // Coalesce on the cache key, so two screens asking for the same payload in
  // the same tick share one conditional request.
  //
  // This is deliberately unlike `requestJson`'s rule, which refuses to coalesce
  // when a caller passes a signal. Here the shared work is a cache
  // revalidation, and the result is published under a key both callers wanted;
  // a caller that aborts simply stops waiting for it, while the fetch continues
  // on behalf of whoever remains and populates the cache either way. Two
  // simultaneous first-opens of the same title therefore cost one request
  // instead of two.
  return raceWithAbort(
    coalesce(cacheCoalesceKey(options.cacheKey, path), () =>
      runCachedRequest<T>(path, options),
    ),
    options.signal,
  );
}

/**
 * Rejects for a caller that aborted, without disturbing the shared request.
 *
 * Coalescing deliberately shares one fetch between callers, but a signal is
 * per-caller: if a screen unmounts and aborts, the shared fetch must continue
 * for whoever else is waiting — and it can, because the work is already in
 * flight and the result is still worth caching. Only the aborted caller stops
 * waiting.
 */
function raceWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortError("The operation was aborted."));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError("The operation was aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Cache coalescing key. Distinct paths must not share a promise even if their
 * cache keys were misconfigured to collide. */
function cacheCoalesceKey(cacheKey: string, path: string): string {
  return `cached:${cacheKey}:${path}`;
}

async function runCachedRequest<T>(
  path: string,
  options: CachedRequestOptions,
): Promise<CachedRequestResult<T>> {
  // Capture the session this request belongs to, before the first await.
  //
  // This has to be the first thing the function does. Reading it later — after
  // the cache lookup below yields — would capture whichever session happens to
  // be current when that promise resolves, which is not necessarily the one
  // that made the request, and the guard at the end would then compare a value
  // against itself and always pass.
  const session = sessionId;

  const ttl = options.ttl ?? DEFAULT_TTL_MS;
  const entry = await cache.getEntry<T>(options.cacheKey);

  if (entry && isEntryFresh(entry, ttl)) {
    // Report the hit so the diagnostics panel can show how much the ETag work
    // is actually saving.
    recordRequest({ path, durationMs: 0, ok: true, fromCache: true });
    // `entry.data` is the SAME object every time this key hits, so callers can
    // skip a state update with a reference check instead of deep-comparing a
    // freshly parsed copy.
    return { data: entry.data, fromCache: true };
  }

  const etag = entry?.etag;

  try {
    const response = await httpRequest(path, {
      signal: options.signal,
      allowNotModified: true,
      headers: etag ? { "If-None-Match": etag } : undefined,
    });

    // Decide once, the instant the response is in hand.
    //
    // Reading the body before this check would give the session a chance to end
    // in between, which is exactly the window a logout opens: `response.json()`
    // yields, the token is cleared, and the guard then reads the *new* session
    // and wrongly concludes the response is still current. Reading
    // `sessionId` here instead closes that window.
    const sessionIsCurrent = sessionId === session;

    if (response.status === 304 && entry) {
      // Same body, still current. Only the freshness needs refreshing — the
      // data object is untouched and returned by reference, so a screen that
      // already holds it can render without re-parsing or re-rendering.
      if (sessionIsCurrent) {
        await cache.setEntry(options.cacheKey, entry);
      }
      return { data: entry.data, fromCache: true };
    }

    const data = (await response.json()) as T;

    // Publish only if the session was still current when the response landed.
    //
    // Logging out clears the cache, but a request issued moments earlier can
    // still be in flight and land afterwards. Without this guard it would write
    // the previous account's payload back into storage, and the next account to
    // sign in on this device would then read it straight out of the cache — the
    // cross-user leak that clearing on logout alone cannot close.
    if (sessionIsCurrent) {
      await cache.setEntry(options.cacheKey, {
        data,
        timestamp: Date.now(),
        ttl,
        etag: response.headers.get("ETag") ?? undefined,
      });
    }

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
