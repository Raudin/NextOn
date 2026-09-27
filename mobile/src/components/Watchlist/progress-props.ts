/**
 * Shared contract for the watch-progress indicators.
 *
 * `WatchProgressBar` and `WatchProgressBadge` own the layout, the percentage
 * label and the colour tiers; only the indicator itself is platform-specific.
 * iOS and web keep the drawing the app has always used, Android draws the same
 * value with Jetpack Compose (`*.android.tsx`). Both variants are typed against
 * this file so the two cannot drift.
 */

/**
 * Smallest fraction of the linear bar that is ever drawn.
 *
 * The hand-rolled bar clamped its width to 2%, so a show with one episode of
 * forty watched still showed a sliver rather than an empty track. Compose draws
 * nothing at `progress: 0`, so the clamp moves onto the value itself.
 */
export const MIN_VISIBLE_BAR_PROGRESS = 0.02;

/** Props of the horizontal fill used by the list rows and the detail hero. */
export interface ProgressBarFillProps {
  /** Whole-show progress as a fraction between 0 and 1. */
  progress: number;
  /**
   * Colour of the filled portion. Defaults to the tier colour (green / orange /
   * red) that the watchlist and its ring share. Pass an explicit colour when
   * the bar is drawn over artwork and should read as a plain light line rather
   * than as a progress rating.
   */
  barColor?: string;
  /**
   * Colour of the unfilled track. Defaults to the page background, which is
   * what reads correctly inside a `$backgroundElement` card. Pass an explicit
   * colour when the bar sits on artwork, where the page background would be
   * invisible.
   */
  trackColor?: string;
  /** Thickness of the bar in points. */
  height?: number;
}

/** Props of the ring drawn over a poster card. */
export interface ProgressRingProps {
  /** Whole-show progress as a fraction between 0 and 1. */
  progress: number;
  /** Diameter of the ring in points. */
  size: number;
  /** Thickness of the ring stroke in points. */
  strokeWidth: number;
}
