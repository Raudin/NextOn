import {
  ensureDate,
  episodeStackDepth,
  getCountdownString,
  getGroupHeader,
  getNextAirLabel,
  groupUpcoming,
  hasEpisodeBacklog,
  parseAirDate,
  runtimeLabel,
  toResolvedMovie,
  toResolvedShow,
} from "@/lib/schedule";
import type { Episode, HomeMovieItem, HomeShowItem } from "@/lib/media-api";

/**
 * The schedule date rules.
 *
 * These are worth testing because they are the same class of logic that already
 * produced a real bug on the server: `time.Parse` returns UTC, so an episode
 * airing *today* compared against local midnight looked like the future and was
 * hidden from "Ready to Watch". The client has the mirror-image trap in
 * `new Date("YYYY-MM-DD")`, which parses a bare date as UTC.
 */

const formatLocal = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

describe("parseAirDate", () => {
  it("parses a bare date as LOCAL midnight, not UTC", () => {
    const parsed = parseAirDate("2026-03-15");
    expect(parsed).not.toBeNull();
    // The trap: `new Date("2026-03-15")` is UTC midnight, which is the 14th for
    // anyone west of Greenwich.
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(2);
    expect(parsed!.getDate()).toBe(15);
    expect(parsed!.getHours()).toBe(0);
  });

  it("returns null for missing or malformed values", () => {
    expect(parseAirDate(null)).toBeNull();
    expect(parseAirDate(undefined)).toBeNull();
    expect(parseAirDate("")).toBeNull();
    expect(parseAirDate("2026-03")).toBeNull();
    expect(parseAirDate("not-a-date")).toBeNull();
  });
});

describe("ensureDate", () => {
  it("passes through valid Dates and rejects invalid ones", () => {
    const valid = new Date(2026, 0, 1);
    expect(ensureDate(valid)).toBe(valid);
    expect(ensureDate(new Date("nonsense"))).toBeNull();
    expect(ensureDate(null)).toBeNull();
  });
});

describe("getGroupHeader", () => {
  it("labels today and tomorrow specially", () => {
    expect(getGroupHeader(daysFromToday(0))).toMatch(/^Today /);
    expect(getGroupHeader(daysFromToday(1))).toMatch(/^Tomorrow /);
  });

  it("uses the weekday within the next week", () => {
    const inThreeDays = daysFromToday(3);
    const header = getGroupHeader(inThreeDays);
    const weekday = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][inThreeDays.getDay()];
    expect(header.startsWith(weekday)).toBe(true);
  });

  it("falls back to the month beyond a week", () => {
    const inThreeWeeks = daysFromToday(21);
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    expect(getGroupHeader(inThreeWeeks)).toBe(months[inThreeWeeks.getMonth()]);
  });

  it("includes the year for a different year", () => {
    const nextYear = new Date(new Date().getFullYear() + 1, 5, 15);
    expect(getGroupHeader(nextYear)).toContain(String(nextYear.getFullYear()));
  });

  it("groups an unknown date under Upcoming", () => {
    expect(getGroupHeader(null)).toBe("Upcoming");
    expect(getGroupHeader(undefined)).toBe("Upcoming");
  });
});

describe("getCountdownString", () => {
  it("reports Released for a past date", () => {
    expect(getCountdownString(daysFromToday(-1))).toBe("Released");
  });

  it("counts weeks between one and four weeks out", () => {
    expect(getCountdownString(daysFromToday(10))).toBe("In 1 week");
    expect(getCountdownString(daysFromToday(20))).toBe("In 2 weeks");
  });

  it("counts months beyond four weeks", () => {
    expect(getCountdownString(daysFromToday(70))).toBe("In 2 months");
  });

  it("falls back to Upcoming for an unusable value", () => {
    expect(getCountdownString(null)).toBe("Upcoming");
  });
});

describe("getNextAirLabel", () => {
  it("labels today and tomorrow", () => {
    expect(getNextAirLabel(formatLocal(daysFromToday(0)))).toBe("today");
    expect(getNextAirLabel(formatLocal(daysFromToday(1)))).toBe("1 day");
  });

  it("counts days up to two weeks", () => {
    expect(getNextAirLabel(formatLocal(daysFromToday(3)))).toBe("3 days");
    expect(getNextAirLabel(formatLocal(daysFromToday(10)))).toBe("10 days");
  });

  it("coarsens to weeks and then months", () => {
    expect(getNextAirLabel(formatLocal(daysFromToday(21)))).toBe("3 weeks");
    expect(getNextAirLabel(formatLocal(daysFromToday(70)))).toBe("2 months");
  });

  it("treats a past date as today rather than a negative count", () => {
    expect(getNextAirLabel(formatLocal(daysFromToday(-1)))).toBe("today");
  });

  it("returns null for an unusable value so the pill can be hidden", () => {
    expect(getNextAirLabel(null)).toBeNull();
    expect(getNextAirLabel(undefined)).toBeNull();
    expect(getNextAirLabel("")).toBeNull();
    expect(getNextAirLabel("not-a-date")).toBeNull();
    expect(getNextAirLabel("2026-13")).toBeNull();
  });
});

describe("groupUpcoming", () => {
  const show = (id: number, airDate: string): HomeShowItem => ({
    show: { id, name: `Show ${id}`, poster_path: "/p.jpg" } as any,
    details: { id },
    episode: {
      id,
      name: "Ep",
      season_number: 1,
      episode_number: 1,
      air_date: airDate,
    } as Episode,
    formatted_date: airDate,
    is_new_season: true,
    is_season_finale: false,
  });

  it("groups by header and skips entries with no date", () => {
    const items = [
      toResolvedShow(show(1, formatLocal(daysFromToday(0)))),
      toResolvedShow(show(2, formatLocal(daysFromToday(0)))),
      toResolvedShow(show(3, formatLocal(daysFromToday(30)))),
    ];

    const grouped = groupUpcoming(items);
    const keys = Object.keys(grouped);

    expect(keys).toHaveLength(2);
    // Today's group holds both same-day entries, in insertion order.
    expect(grouped[keys[0]].map((entry) => entry.id)).toEqual([1, 2]);
    expect(grouped[keys[1]].map((entry) => entry.id)).toEqual([3]);
  });

  it("drops entries whose date could not be parsed", () => {
    const grouped = groupUpcoming([toResolvedShow(show(1, "bogus"))]);
    expect(Object.keys(grouped)).toHaveLength(0);
  });
});

describe("resolved item helpers", () => {
  const showItem: HomeShowItem = {
    show: { id: 7, name: "A Show", poster_path: "/show.jpg" } as any,
    details: { id: 7, runtime: 50 },
    episode: {
      id: 1,
      name: "Pilot",
      season_number: 2,
      episode_number: 3,
      air_date: "2026-01-01",
    } as Episode,
    formatted_date: "2026-01-01",
    is_new_season: false,
    is_season_finale: true,
  };

  const movieItem: HomeMovieItem = {
    movie: { id: 9, title: "A Movie", poster_path: "/movie.jpg" } as any,
    details: { id: 9, runtime: 135, tagline: "Tag" },
    formatted_date: "2026-02-01",
  };

  it("maps server flags onto the resolved show", () => {
    const resolved = toResolvedShow(showItem);
    expect(resolved.id).toBe(7);
    expect(resolved.isTv).toBe(true);
    expect(resolved.isNewSeason).toBe(false);
    expect(resolved.isSeasonFinale).toBe(true);
    expect(resolved.targetDate?.getDate()).toBe(1);
  });

  it("defaults the episode backlog to zero when the payload has no count", () => {
    // A schedule cached by a build that predates `episodes_remaining`.
    expect(toResolvedShow(showItem).episodesRemaining).toBe(0);
    expect(toResolvedShow({ ...showItem, episodes_remaining: 3 }).episodesRemaining).toBe(3);
  });

  it("maps a movie without a season/episode", () => {
    const resolved = toResolvedMovie(movieItem);
    expect(resolved.id).toBe(9);
    expect(resolved.isTv).toBe(false);
    expect(resolved.targetDate?.getMonth()).toBe(1);
  });

  it("labels TV rows with the episode and movies with a runtime", () => {
    expect(runtimeLabel(toResolvedShow(showItem))).toBe("S2, E3");
    expect(runtimeLabel(toResolvedMovie(movieItem))).toBe("2h 15m");
  });

  it("says Movie when the runtime is unknown", () => {
    const noRuntime = toResolvedMovie({ ...movieItem, details: { id: 9 } });
    expect(runtimeLabel(noRuntime)).toBe("Movie");
  });
});

/**
 * The poster badge/stack rules.
 *
 * A single waiting episode is the ordinary case and must stay unmarked, and a
 * long backlog must not grow an unbounded tower of layers, so both edges of the
 * rule are worth pinning down.
 */
describe("episode backlog markers", () => {
  it("leaves a caught-up or single-episode show unmarked", () => {
    expect(hasEpisodeBacklog(0)).toBe(false);
    expect(hasEpisodeBacklog(1)).toBe(false);
    expect(episodeStackDepth(0)).toBe(0);
    expect(episodeStackDepth(1)).toBe(0);
  });

  it("marks a backlog of more than one episode", () => {
    expect(hasEpisodeBacklog(2)).toBe(true);
    expect(hasEpisodeBacklog(9)).toBe(true);
  });

  it("caps the stack at two layers however long the backlog is", () => {
    expect(episodeStackDepth(2)).toBe(1);
    expect(episodeStackDepth(3)).toBe(2);
    expect(episodeStackDepth(40)).toBe(2);
  });

  it("treats a missing or unusable count as no backlog", () => {
    expect(hasEpisodeBacklog(Number.NaN)).toBe(false);
    expect(episodeStackDepth(Number.NaN)).toBe(0);
    expect(episodeStackDepth(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
