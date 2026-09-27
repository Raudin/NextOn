import { Text, XStack } from "tamagui";

import ProgressBarFill from "./ProgressBarFill";
import { useProgressTheme } from "./useProgressTheme";

interface WatchProgressBarProps {
  progress: number;
  /** Show the trailing percentage label. */
  showLabel?: boolean;
  /**
   * Colour of the unfilled track. Defaults to the page background, which is
   * what reads correctly inside a `$backgroundElement` card. Pass an explicit
   * colour when the bar sits on artwork, where the page background would be
   * invisible.
   */
  trackColor?: string;
  /**
   * Colour of the filled portion. Defaults to the tier colour (green / orange /
   * red) that the watchlist and its ring share. Pass an explicit colour when
   * the bar is drawn over artwork and should read as a plain light line rather
   * than as a progress rating.
   */
  barColor?: string;
}

/**
 * Continuous horizontal progress line used in the watchlist list layout,
 * where the circular ring from the poster layout reads poorly. Also drawn on
 * the media-detail hero, where the watchlist row's track colour would vanish
 * into the backdrop.
 *
 * The row and the label are identical on every platform, so they live here; the
 * bar itself is platform-specific in `ProgressBarFill`, which Android draws
 * with Jetpack Compose.
 */
export default function WatchProgressBar({
  progress,
  showLabel = true,
  trackColor,
  barColor,
}: WatchProgressBarProps) {
  const { percentage, accent } = useProgressTheme(progress);

  return (
    <XStack ai="center" gap="$2">
      <ProgressBarFill
        progress={progress}
        trackColor={trackColor}
        barColor={barColor}
      />
      {showLabel ? (
        <Text color={accent} fos="$2" fow="800" miw={34} ta="right">
          {percentage}%
        </Text>
      ) : null}
    </XStack>
  );
}

