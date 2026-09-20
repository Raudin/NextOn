import {
  type Episode,
  type HomeMovieItem,
  type HomeShowItem,
  type MediaDetailsLite,
  type TMDBMedia,
} from "@/lib/media-api";

/**
 * Pure schedule helpers and the screen's resolved item shapes.
 *
 * Extracted from the Home screen so the date/grouping rules can be unit tested
 * without rendering anything, and so the section components can share the types
 * without a circular import back into the route.
 */

/**
 * A schedule entry as the screen uses it: the server's item plus a parsed
 * `Date` for grouping and countdowns.
 *
 * `details` is the *trimmed* shape the schedule endpoint sends (runtime,
 * tagline, per-season episode counts) rather than full TMDB details. Keeping it
 * trimmed is what makes the schedule cheap enough to cache; the media-detail
 * screen fetches the full record when the user opens a title.
 */
export interface ResolvedShowItem {
  isTv: true;
  id: number;
  show: TMDBMedia;
  details: MediaDetailsLite;
  episode: Episode;
  formattedDate: string;
  targetDate: Date | null;
  /** Badge state, computed server-side so render does not re-derive it. */
  isNewSeason: boolean;
  isSeasonFinale: boolean;
}

export interface ResolvedMovieItem {
  isTv: false;
  id: number;
  movie: TMDBMedia;
  details: MediaDetailsLite;
  formattedDate: string;
  targetDate: Date | null;
}

export type ResolvedScheduleItem = ResolvedShowItem | ResolvedMovieItem;

/** Coerces anything date-like into a valid Date, or null. */
export const ensureDate = (val: unknown): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const parsed = new Date(val as string);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Parses a TMDB "YYYY-MM-DD" into a local-midnight Date.
 *
 * Built from parts rather than `new Date(str)`: a bare date string is parsed as
 * UTC, which lands on the previous day for anyone west of Greenwich and would
 * group an episode under the wrong heading.
 */
export const parseAirDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const toResolvedShow = (item: HomeShowItem): ResolvedShowItem => ({
  isTv: true,
  id: item.show.id,
  show: item.show,
  details: item.details,
  episode: item.episode,
  formattedDate: item.formatted_date,
  targetDate: parseAirDate(item.formatted_date),
  isNewSeason: item.is_new_season,
  isSeasonFinale: item.is_season_finale,
});

export const toResolvedMovie = (item: HomeMovieItem): ResolvedMovieItem => ({
  isTv: false,
  id: item.movie.id,
  movie: item.movie,
  details: item.details,
  formattedDate: item.formatted_date,
  targetDate: parseAirDate(item.formatted_date),
});

/** Relative countdown label for an upcoming release, e.g. "In 2 weeks". */
export const getCountdownString = (inputDate: Date | string | null | undefined) => {
  const targetDate = ensureDate(inputDate);
  if (!targetDate) return "Upcoming";

  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 0) return "Released";

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays >= 7) {
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks >= 4) {
      const diffMonths = Math.floor(diffDays / 30);
      return `In ${diffMonths} ${diffMonths === 1 ? "month" : "months"}`;
    }
    return `In ${diffWeeks} ${diffWeeks === 1 ? "week" : "weeks"}`;
  }

  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (diffDays > 0) {
    return `${diffDays}d ${diffHours}h`;
  }
  return `${diffHours}h`;
};

/**
 * Relative day-granularity phrase for the next episode's air date, e.g.
 * "3 days" for the detail screen's "Next: 3 days" pill.
 *
 * Deliberately separate from `getCountdownString`: that one is tuned for
 * far-off premieres and spends its precision on hours ("3d 5h"), while this pill
 * reads as a day count and only needs day granularity.
 *
 * Returns null when the date is missing or unparseable, so the caller can hide
 * the pill rather than render a broken label.
 */
export const getNextAirLabel = (
  inputDate?: string | null,
): string | null => {
  const target = parseAirDate(inputDate);
  if (!target) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Airs today (or a stale date the server has not caught up with): "today" is
  // the honest label, and matches how `isAfterToday` treats today as available.
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day";
  if (diffDays < 14) return `${diffDays} days`;

  if (diffDays < 60) {
    const weeks = Math.round(diffDays / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }

  const months = Math.round(diffDays / 30);
  return `${months} ${months === 1 ? "month" : "months"}`;
};

/** Heading used to group the upcoming schedule. */
export const getGroupHeader = (inputDate: Date | string | null | undefined) => {
  const targetDate = ensureDate(inputDate);
  if (!targetDate) return "Upcoming";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const formatMonthDay = (d: Date) => `${months[d.getMonth()]} ${d.getDate()}`;

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  if (isSameDay(targetDate, today)) {
    return `Today ${formatMonthDay(targetDate)}`;
  }
  if (isSameDay(targetDate, tomorrow)) {
    return `Tomorrow ${formatMonthDay(targetDate)}`;
  }

  if (targetDate > today && targetDate < nextWeek) {
    return `${days[targetDate.getDay()]} ${formatMonthDay(targetDate)}`;
  }

  if (targetDate.getFullYear() !== today.getFullYear()) {
    return `${months[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  }
  return months[targetDate.getMonth()];
};

/**
 * Groups upcoming items by their heading, preserving first-seen order within
 * each group.
 */
export const groupUpcoming = <T extends ResolvedScheduleItem>(
  items: T[],
): Record<string, T[]> => {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    if (!item.targetDate) {
      continue;
    }
    const header = getGroupHeader(item.targetDate);
    if (!groups[header]) {
      groups[header] = [];
    }
    groups[header].push(item);
  }
  return groups;
};

/** Poster path for either item shape. */
export const posterPathOf = (item: ResolvedScheduleItem): string =>
  item.isTv ? item.show.poster_path : item.movie.poster_path;

/** Display title for either item shape. */
export const titleOf = (item: ResolvedScheduleItem): string =>
  item.isTv ? item.show.title || item.show.name || "Untitled" : item.movie.title || item.movie.name || "Untitled";

/** "{hours}h {minutes}m" runtime label, or "Movie" when unknown. */
export const runtimeLabel = (item: ResolvedScheduleItem): string => {
  if (item.isTv) {
    return `S${item.episode.season_number}, E${item.episode.episode_number}`;
  }
  const runtime = item.details?.runtime;
  return runtime ? `${Math.floor(runtime / 60)}h ${runtime % 60}m` : "Movie";
};
