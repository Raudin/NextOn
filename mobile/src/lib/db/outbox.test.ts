/**
 * Offline queue semantics.
 *
 * The outbox is the only thing standing between a mutation made offline and
 * that mutation being lost, so its two decisions are worth pinning down:
 * which entries supersede which, and which failures are worth retrying.
 *
 * `enqueueMutation` itself needs a real database (see jest.config.js), so the
 * rule it applies is factored into `shouldEnqueue` and tested directly, and the
 * drain is tested against a fake database at the module seam.
 */

import {
  resourceKeyFor,
  shouldEnqueue,
} from "@/lib/db/outbox";

type Pending = {
  id: number;
  method: string;
  path: string;
  body: string | null;
  createdAt: number;
};

/** A pending queue in insertion order, with ids and timestamps assigned. */
const queueOf = (
  entries: { method: string; path: string; body?: string | null }[],
): Pending[] =>
  entries.map((entry, index) => ({
    id: index + 1,
    method: entry.method,
    path: entry.path,
    body: entry.body ?? null,
    createdAt: 1000 + index,
  }));

describe("resourceKeyFor", () => {
  it("identifies a delete by its path id", () => {
    expect(resourceKeyFor("DELETE", "/api/watchlist/603")).toBe(
      "/api/watchlist:603",
    );
  });

  it("identifies a create by the id in its body", () => {
    expect(resourceKeyFor("POST", "/api/watchlist", '{"id":603}')).toBe(
      "/api/watchlist:603",
    );
  });

  it("gives an add and its matching remove the same resource key", () => {
    expect(resourceKeyFor("POST", "/api/watchlist", '{"id":603}')).toBe(
      resourceKeyFor("DELETE", "/api/watchlist/603"),
    );
  });

  it("ignores a query string", () => {
    expect(resourceKeyFor("POST", "/api/watched?x=1", '{"id":9}')).toBe(
      resourceKeyFor("POST", "/api/watched", '{"id":9}'),
    );
  });

  it("does not treat an episode body as a path-style resource id", () => {
    // /api/watched carries an episode, not the resource identity, so it must
    // not collide with /api/watched/5.
    expect(resourceKeyFor("POST", "/api/watched", '{"media_id":135397}')).toBe(
      "/api/watched",
    );
    expect(resourceKeyFor("DELETE", "/api/watched/5")).toBe("/api/watched:5");
  });

  it("falls back to the path when a body cannot be parsed", () => {
    expect(resourceKeyFor("POST", "/api/watchlist", "not json")).toBe(
      "/api/watchlist",
    );
  });
});

describe("shouldEnqueue", () => {
  it("queues the first mutation for a resource", () => {
    expect(shouldEnqueue("POST", "/api/watchlist", '{"id":1}', [])).toBe(true);
  });

  it("collapses an identical repeat of the newest entry", () => {
    const pending = queueOf([{ method: "POST", path: "/api/watchlist", body: '{"id":1}' }]);
    expect(shouldEnqueue("POST", "/api/watchlist", '{"id":1}', pending)).toBe(false);
  });

  it("keeps add then remove — the remove is not a duplicate of the add", () => {
    // This is the bug: the whole-queue comparison used to see the pending POST
    // as a match for the DELETE and drop it, leaving the title in the
    // watchlist after the user removed it.
    const pending = queueOf([
      { method: "POST", path: "/api/watchlist", body: '{"id":1}' },
    ]);
    expect(shouldEnqueue("DELETE", "/api/watchlist/1", null, pending)).toBe(true);
  });

  it("keeps add then remove then add", () => {
    // The full sequence from the audit: after the remove is queued, re-adding
    // must queue again rather than being suppressed by the original POST.
    const afterAdd = queueOf([
      { method: "POST", path: "/api/watchlist", body: '{"id":1}' },
    ]);
    expect(shouldEnqueue("DELETE", "/api/watchlist/1", null, afterAdd)).toBe(true);

    const afterRemove = queueOf([
      { method: "POST", path: "/api/watchlist", body: '{"id":1}' },
      { method: "DELETE", path: "/api/watchlist/1", body: null },
    ]);
    expect(
      shouldEnqueue("POST", "/api/watchlist", '{"id":1}', afterRemove),
    ).toBe(true);
  });

  it("collapses a duplicate only against the newest entry, not an older one", () => {
    // The same POST appears twice with a DELETE in between: the newest entry is
    // the DELETE, so this POST is not a duplicate of the older POST.
    const pending = queueOf([
      { method: "POST", path: "/api/watchlist", body: '{"id":1}' },
      { method: "DELETE", path: "/api/watchlist/1", body: null },
    ]);
    expect(shouldEnqueue("POST", "/api/watchlist", '{"id":1}', pending)).toBe(true);
  });

  it("collapses a duplicate that is the newest entry even when older ones differ", () => {
    const pending = queueOf([
      { method: "DELETE", path: "/api/watchlist/1", body: null },
      { method: "POST", path: "/api/watchlist", body: '{"id":1}' },
    ]);
    expect(shouldEnqueue("POST", "/api/watchlist", '{"id":1}', pending)).toBe(false);
  });

  it("does not treat different resources as duplicates", () => {
    const pending = queueOf([
      { method: "POST", path: "/api/watchlist", body: '{"id":1}' },
    ]);
    expect(shouldEnqueue("POST", "/api/watchlist", '{"id":2}', pending)).toBe(true);
  });

  it("does not collapse a re-mark of a different episode", () => {
    const pending = queueOf([
      { method: "POST", path: "/api/watched", body: '{"media_id":1,"episode_number":1}' },
    ]);
    expect(
      shouldEnqueue("POST", "/api/watched", '{"media_id":1,"episode_number":2}', pending),
    ).toBe(true);
  });

  it("orders by id when two entries share a timestamp", () => {
    const pending: Pending[] = [
      { id: 1, method: "POST", path: "/api/watchlist", body: '{"id":1}', createdAt: 5 },
      { id: 2, method: "DELETE", path: "/api/watchlist/1", body: null, createdAt: 5 },
    ];
    // Id 2 is newest, so its DELETE is what this POST is compared against.
    expect(shouldEnqueue("POST", "/api/watchlist", '{"id":1}', pending)).toBe(true);
  });
});
