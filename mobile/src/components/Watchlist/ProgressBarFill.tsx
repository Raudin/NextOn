import { YStack } from "tamagui";

import { useProgressTheme } from "./useProgressTheme";
import {
  MIN_VISIBLE_BAR_PROGRESS,
  type ProgressBarFillProps,
} from "./progress-props";

/**
 * The progress bar for iOS and web: two nested views, the drawing the bar has
 * always used, moved here so `WatchProgressBar` can stay platform-agnostic.
 * Android draws the same value with Jetpack Compose — see
 * `ProgressBarFill.android.tsx`.
 */
export default function ProgressBarFill({
  progress,
  barColor,
  trackColor,
  height = 5,
}: ProgressBarFillProps) {
  const { percentage, accent } = useProgressTheme(progress);

  return (
    <YStack
      f={1}
      h={height}
      borderRadius={999}
      bg={trackColor ?? "$background"}
      overflow="hidden"
    >
      <YStack
        h="100%"
        w={`${Math.max(MIN_VISIBLE_BAR_PROGRESS * 100, percentage)}%`}
        bg={barColor ?? accent}
        borderRadius={999}
      />
    </YStack>
  );
}
