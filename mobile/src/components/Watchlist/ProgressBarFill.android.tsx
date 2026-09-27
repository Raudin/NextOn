import { Host, LinearProgressIndicator } from "@expo/ui/jetpack-compose";
import {
  fillMaxWidth,
  height as heightModifier,
} from "@expo/ui/jetpack-compose/modifiers";
import { useTheme } from "tamagui";

import { useProgressTheme } from "./useProgressTheme";
import {
  MIN_VISIBLE_BAR_PROGRESS,
  type ProgressBarFillProps,
} from "./progress-props";

/**
 * The progress bar for Android, drawn with the Material 3
 * `LinearProgressIndicator` from `@expo/ui`.
 *
 * Compose owns the whole bar here, so the two things `WatchProgressBar` used to
 * do in Yoga move onto it: the width (via `fillMaxWidth`) and the thickness
 * (via `height`). The track colour falls back to the same page background the
 * Tamagui `$background` token resolves to, because Compose cannot read theme
 * tokens.
 */
export default function ProgressBarFill({
  progress,
  barColor,
  trackColor,
  height = 5,
}: ProgressBarFillProps) {
  const theme = useTheme();
  const { percentage, accent } = useProgressTheme(progress);

  return (
    <Host style={{ flex: 1, height }}>
      <LinearProgressIndicator
        progress={Math.max(MIN_VISIBLE_BAR_PROGRESS, percentage / 100)}
        color={barColor ?? accent}
        trackColor={trackColor ?? theme.background?.val ?? "#000000"}
        // No breathing room between the fill and its track: the other platforms
        // draw one continuous rounded bar, not a Material themed gap.
        gapSize={0}
        strokeCap="round"
        modifiers={[fillMaxWidth(), heightModifier(height)]}
      />
    </Host>
  );
}
