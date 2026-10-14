/**
 * Outbox drain policy.
 *
 * The drain decides which queued mutations are still worth retrying. Getting it
 * wrong is expensive in a way that is hard to notice: a mutation the server has
 * permanently rejected used to stop the whole queue, so every *later* mutation
 * — including ones that would have succeeded — sat unplayed behind it until the
 * bad entry exhausted its attempts.
 *
 * Tested against fakes at the module seam rather than a real database, because
 * `expo-sqlite` has no JS implementation under Node (see jest.config.js).
 */

import { drainOutbox } from "@/lib/sync";
import { HttpError, requestJson } from "@/lib/http";
import { getLocalDatabase } from "@/lib/db/client";
import { MAX_OUTBOX_ATTEMPTS } from "@/lib/db/outbox";

jest.mock("@/lib/db/client", () => ({
  getLocalDatabase: jest.fn(),
  clearLocalUserData: jest.fn(),
}));

jest.mock("@/lib/media-api", () => ({
  fetchSyncChanges: jest.fn(),
}));

jest.mock("@/lib/http", () => {
  const actual = jest.requireActual("@/lib/http");
  return {
    ...actual,
    requestJson: jest.fn(),
  };
});

const mockedGetLocalDatabase = getLocalDatabase as jest.MockedFunction<
  typeof getLocalDatabase
>;
const mockedRequestJson = requestJson as jest.MockedFunction<typeof requestJson>;

interface FakeRow {
  id: number;
  method: string;
  path: string;
  body: string | null;
  created_at: number;
  attempts: number;
}

/**
 * A fake outbox good enough for the drain: it serves the pending list and
 * records deletions and attempt bumps.
 */
const makeFakeDb = (rows: FakeRow[]) => {
  const deleted: number[] = [];
  const bumped: number[] = [];
  const current = new Map(rows.map((row) => [row.id, { ...row }]));

  const db = {
    getAllAsync: jest.fn(async () =>
      Array.from(current.values()).sort(
        (a, b) => a.created_at - b.created_at || a.id - b.id,
      ),
    ),
    getFirstAsync: jest.fn(async (_sql: string, ...params: unknown[]) => {
      const id = params[0] as number;
      return current.get(id) ?? null;
    }),
    runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("DELETE FROM outbox")) {
        const id = params[0] as number;
        deleted.push(id);
        current.delete(id);
      } else if (sql.includes("attempts = attempts + 1")) {
        const id = params[0] as number;
        bumped.push(id);
        const row = current.get(id);
        if (row) {
          row.attempts += 1;
        }
      }
      return { changes: 1, lastInsertRowId: 0 };
    }),
  };

  mockedGetLocalDatabase.mockResolvedValue(db as never);
  return { db, deleted, bumped, current };
};

const row = (
  id: number,
  method: string,
  path: string,
  body: string | null = null,
): FakeRow => ({ id, method, path, body, created_at: 1000 + id, attempts: 0 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("drainOutbox", () => {
  it("replays every entry in order when all succeed", async () => {
    const { deleted } = makeFakeDb([
      row(1, "POST", "/api/watchlist", '{"id":1}'),
      row(2, "DELETE", "/api/watchlist/2"),
    ]);
    mockedRequestJson.mockResolvedValue({} as never);

    const pushed = await drainOutbox();

    expect(pushed).toBe(2);
    expect(deleted).toEqual([1, 2]);
    expect(mockedRequestJson).toHaveBeenCalledTimes(2);
  });

  it("discards a rejected mutation and keeps draining the rest", async () => {
    // The regression: a 400 on the first entry used to stop the loop, so the
    // second entry was never attempted.
    const { deleted, bumped } = makeFakeDb([
      row(1, "POST", "/api/watchlist", '{"id":1}'),
      row(2, "POST", "/api/watchlist", '{"id":2}'),
      row(3, "POST", "/api/watchlist", '{"id":3}'),
    ]);

    mockedRequestJson.mockImplementation(async (path: string) => {
      if (path === "/api/watchlist") {
        // Distinguish by call order: only the first request is rejected.
        if (mockedRequestJson.mock.calls.length === 1) {
          throw new HttpError("Bad request", 400);
        }
      }
      return {} as never;
    });

    const pushed = await drainOutbox();

    // Entry 1 is gone (rejected, not retried); 2 and 3 both went through.
    expect(deleted).toEqual([1, 2, 3]);
    expect(pushed).toBe(2);
    expect(mockedRequestJson).toHaveBeenCalledTimes(3);
    // A server-rejected entry is not charged an attempt — it is not retried.
    expect(bumped).toEqual([]);
  });

  it("stops at a transport failure so order is preserved", async () => {
    const { deleted, bumped } = makeFakeDb([
      row(1, "POST", "/api/watchlist", '{"id":1}'),
      row(2, "POST", "/api/watchlist", '{"id":2}'),
    ]);

    mockedRequestJson.mockRejectedValue(new Error("Network request failed"));

    const pushed = await drainOutbox();

    expect(pushed).toBe(0);
    // Nothing deleted, the first entry was charged an attempt, and the second
    // was never attempted — replaying it now could reorder the queue.
    expect(deleted).toEqual([]);
    expect(bumped).toEqual([1]);
    expect(mockedRequestJson).toHaveBeenCalledTimes(1);
  });

  it("drops a transport-failing entry once it exhausts its attempts", async () => {
    // Entry 1 starts one below the cap, so this attempt discards it.
    const fake = makeFakeDb([
      {
        ...row(1, "POST", "/api/watchlist", '{"id":1}'),
        attempts: MAX_OUTBOX_ATTEMPTS - 1,
      },
      row(2, "POST", "/api/watchlist", '{"id":2}'),
    ]);

    mockedRequestJson
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValue({} as never);

    const pushed = await drainOutbox();

    // Entry 1 is discarded at the cap, so entry 2 is reached and succeeds.
    expect(fake.deleted).toEqual([1, 2]);
    expect(pushed).toBe(1);
  });

  it("does nothing when the queue is empty", async () => {
    makeFakeDb([]);
    const pushed = await drainOutbox();
    expect(pushed).toBe(0);
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });
});
