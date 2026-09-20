import { parseEntityKey } from "@/lib/sync";

/**
 * Change-log key parsing.
 *
 * The entity key is produced by the server and is the authoritative identity for
 * a change. Parsing it — rather than reading the payload — matters because a
 * delete op has no payload at all, and a movie's watched row has no season or
 * episode to read. Getting this wrong silently applies a change to the wrong
 * row.
 */

describe("parseEntityKey", () => {
  it("parses a watchlist or favourite key", () => {
    expect(parseEntityKey("tv:1396")).toEqual({
      mediaType: "tv",
      mediaId: 1396,
      season: -1,
      episode: -1,
    });
    expect(parseEntityKey("movie:603")).toEqual({
      mediaType: "movie",
      mediaId: 603,
      season: -1,
      episode: -1,
    });
  });

  it("parses a watched episode key", () => {
    expect(parseEntityKey("tv:1396:2:7")).toEqual({
      mediaType: "tv",
      mediaId: 1396,
      season: 2,
      episode: 7,
    });
  });

  it("uses -1 rather than null for a movie's absent season/episode", () => {
    // The watched table keys on (media_type, media_id, season, episode) and
    // SQLite treats NULLs as distinct in a primary key, so -1 keeps a movie row
    // from being inserted repeatedly.
    const parsed = parseEntityKey("movie:603");
    expect(parsed.season).toBe(-1);
    expect(parsed.episode).toBe(-1);
  });

  it("defaults an unrecognised media type to movie", () => {
    // The server normalises unset types to "movie" when it writes the key, so
    // anything that is not "tv" must be treated the same way here or a delete
    // would not match the stored row.
    expect(parseEntityKey("unknown:5").mediaType).toBe("movie");
  });

  it("reports a malformed id as 0 instead of NaN", () => {
    // NaN would produce a query that silently matches nothing.
    const parsed = parseEntityKey("tv:not-a-number");
    expect(parsed.mediaId).toBe(0);
  });

  it("treats a three-part key as having no episode", () => {
    const parsed = parseEntityKey("tv:5:2");
    expect(parsed.season).toBe(-1);
    expect(parsed.episode).toBe(-1);
  });

  it("keeps season and episode distinct", () => {
    const a = parseEntityKey("tv:1:23:4");
    const b = parseEntityKey("tv:12:3:4");
    expect(a.mediaId).not.toBe(b.mediaId);
  });
});
