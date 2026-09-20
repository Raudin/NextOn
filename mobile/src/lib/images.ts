import type { ImageProps } from "expo-image";

/**
 * TMDB image sizing and caching, by role.
 *
 * Every poster in this app used to request `w500` and every backdrop/still
 * `w780`, regardless of how large the image was actually drawn. That is the
 * single biggest contributor to the on-device image cache: the Home schedule
 * renders 60x90pt cells from ~120KB w500 files, so roughly seven times the
 * necessary bytes were downloaded and stored for every row.
 *
 * Roles are per *rendered size*, not per data type, because that is what
 * determines the bytes needed. Sizes below assume a 3x display and pick the
 * smallest TMDB bucket that still covers it.
 */
export type ImageRole =
  /** Small list cells: Home schedule posters (60x90pt), watchlist row thumbs (78x116pt). */
  | "posterCell"
  /** Grid/card posters: watchlist grid (96-180pt), Discover cards (130-180pt). */
  | "posterCard"
  /** Episode stills used as small thumbnails (96x64pt). */
  | "still"
  /** Full-bleed hero backdrops and the wide carousel cards (260x146pt). */
  | "backdrop"
  /** Cast/crew avatars and profile images. */
  | "profile"
  /** Transparent title logos, drawn over a backdrop. */
  | "logo";

/**
 * TMDB bucket per role. `w185`/`w342`/`w780`/`w300` are the widths TMDB
 * actually serves; asking for anything else silently 404s.
 */
const ROLE_WIDTH: Record<ImageRole, string> = {
  posterCell: "w185",
  posterCard: "w342",
  still: "w300",
  backdrop: "w780",
  profile: "w185",
  logo: "w300",
};

const TMDB_IMAGE_ROOT = "https://image.tmdb.org/t/p";

/**
 * Builds a TMDB image URL for a role.
 *
 * Returns "" for a missing path so callers can keep their existing
 * `url ? <Image/> : <placeholder/>` checks without a type change.
 */
export const imageUrl = (
  path: string | null | undefined,
  role: ImageRole = "posterCard",
): string => (path ? `${TMDB_IMAGE_ROOT}/${ROLE_WIDTH[role]}${path}` : "");

/**
 * Cache policy per role.
 *
 * Large one-shot artwork is kept in memory only. A full-bleed backdrop is the
 * biggest single file this app downloads and is typically seen once per visit,
 * so writing it to disk buys little and is the main reason the disk cache grew
 * into the tens of megabytes. Small, frequently revisited thumbnails are the
 * opposite case and are worth persisting.
 */
export const imageCachePolicy = (
  role: ImageRole,
): NonNullable<ImageProps["cachePolicy"]> =>
  role === "backdrop" || role === "logo" ? "memory" : "memory-disk";

/**
 * Transition duration per role, in ms.
 *
 * List cells fade in quickly so scrolling does not look like an animation demo;
 * hero artwork can afford a slower reveal.
 */
export const imageTransitionMs = (role: ImageRole): number =>
  role === "backdrop" || role === "logo" ? 250 : 150;
