/**
 * Session policy in the transport layer.
 *
 * Two failures this pins down, both of which only appear with concurrency or
 * timing, which is why they went unnoticed:
 *
 *  - Several requests answered 401 in the same instant each ran their own
 *    logout, clearing the cache and navigating more than once.
 *  - A request already in flight when the user signed out could land
 *    afterwards and republish the previous account's payload into the cache,
 *    where the next account on the device would read it.
 *
 * The cache-write guard is asserted through observable behaviour — what ends up
 * stored — rather than by reaching into module state.
 */

import { cache } from "@/lib/cache";
import {
  beginNewSession,
  configureHttp,
  currentSessionId,
  HttpError,
  isOfflineError,
  requestJson,
  requestJsonCached,
} from "@/lib/http";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

const respondWith = (status: number, body: unknown = {}) =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  })) as unknown as typeof fetch;

describe("session identity", () => {
  it("changes when a new session begins", () => {
    // A fresh module state may already have been advanced by another test, so
    // this asserts a delta rather than an absolute value.
    const before = currentSessionId();
    beginNewSession();
    expect(currentSessionId()).toBe(before + 1);
  });

  it("advances on every call, so consecutive sessions never alias", () => {
    const first = (beginNewSession(), currentSessionId());
    const second = (beginNewSession(), currentSessionId());
    const third = (beginNewSession(), currentSessionId());
    expect(new Set([first, second, third]).size).toBe(3);
  });
});

describe("401 handling", () => {
  it("invokes onUnauthorized once for concurrent 401s", async () => {
    const onUnauthorized = jest.fn();
    beginNewSession();
    configureHttp({ getToken: () => "a-token", onUnauthorized });
    global.fetch = respondWith(401, { error: "Invalid or expired token" });

    // Every one of these is answered 401 in the same tick.
    const results = await Promise.allSettled([
      requestJson("/api/watchlist"),
      requestJson("/api/home/schedule"),
      requestJson("/api/sync/state"),
      requestJson("/api/profile"),
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    // The regression: this used to be 4, running logout and navigation four
    // times over.
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onUnauthorized for a 401 without a token", async () => {
    const onUnauthorized = jest.fn();
    beginNewSession();
    configureHttp({ getToken: () => null, onUnauthorized });
    global.fetch = respondWith(401);

    await expect(requestJson("/api/watchlist")).rejects.toBeInstanceOf(HttpError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("can report a 401 again after a new session begins", async () => {
    const onUnauthorized = jest.fn();
    beginNewSession();
    configureHttp({ getToken: () => "a-token", onUnauthorized });
    global.fetch = respondWith(401);

    await expect(requestJson("/api/watchlist")).rejects.toBeInstanceOf(HttpError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    // The user signs in again; a 401 on the new session must still be surfaced.
    beginNewSession();
    await expect(requestJson("/api/watchlist")).rejects.toBeInstanceOf(HttpError);
    expect(onUnauthorized).toHaveBeenCalledTimes(2);
  });
});

describe("isOfflineError", () => {
  it("treats a server response as online, whatever the status", () => {
    expect(isOfflineError(new HttpError("Bad request", 400))).toBe(false);
    expect(isOfflineError(new HttpError("Unauthorized", 401))).toBe(false);
    expect(isOfflineError(new HttpError("Server error", 500))).toBe(false);
  });

  it("treats a transport failure as offline", () => {
    expect(isOfflineError(new Error("Network request failed"))).toBe(true);
  });

  it("treats an abort as neither, so it is not queued for replay", () => {
    const abort = new Error("The operation was aborted.");
    abort.name = "AbortError";
    expect(isOfflineError(abort)).toBe(false);
  });
});

/**
 * A fetch whose response is held until the test releases it, so a session can
 * be ended while the request is genuinely in flight.
 */
const gatedFetch = (body: unknown): { fetch: typeof fetch; release: () => void } => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const impl = jest.fn(async () => {
    await gate;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      headers: { get: () => null },
    };
  }) as unknown as typeof fetch;

  return { fetch: impl, release };
};

describe("cross-session cache writes", () => {
  it("publishes a payload when the session is unchanged", async () => {
    beginNewSession();
    const cacheKey = `session-test-unchanged-${Date.now()}`;
    global.fetch = respondWith(200, { value: "current-user" });

    const result = await requestJsonCached<{ value: string }>("/api/watchlist", {
      cacheKey,
    });

    expect(result.fromCache).toBe(false);
    // The guard must not disable caching for the ordinary case.
    const stored = await cache.getEntry<{ value: string }>(cacheKey);
    expect(stored?.data).toEqual({ value: "current-user" });
  });

  it("does not publish a response that lands after the session ended", async () => {
    beginNewSession();
    const cacheKey = `session-test-leak-${Date.now()}`;
    const gated = gatedFetch({ value: "previous-user-watchlist" });
    global.fetch = gated.fetch;

    const pending = requestJsonCached<{ value: string }>("/api/watchlist", {
      cacheKey,
    });

    // The user signs out while the request is in flight.
    beginNewSession();
    gated.release();

    const result = await pending;

    // The caller still gets its own data...
    expect(result.data).toEqual({ value: "previous-user-watchlist" });

    // ...but it must not have been written where the next account will look.
    const stored = await cache.getEntry(cacheKey);
    expect(stored).toBeNull();
  });
});
