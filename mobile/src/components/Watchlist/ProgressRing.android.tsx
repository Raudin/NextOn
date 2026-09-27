import { CircularProgressIndicator, Host } from "@expo/ui/jetpack-compose";
import { size as sizeModifier } from "@expo/ui/jetpack-compose/modifiers";

import { useProgressTheme } from "./useProgressTheme";
import type { ProgressRingProps } from "./progress-props";

/**
 * The progress ring for Android, drawn with the Material 3
 * `CircularProgressIndicator` from `@expo/ui`.
 *
 * The arc starts at the top and sweeps clockwise, matching the rotated SVG ring
 * the other platforms draw. `gapSize` is zeroed for the same reason as the
 * linear bar: the badge should read as one ring on its track, not as a Material
 * indicator floating inside another.
 */
export default function ProgressRing({
  progress,
  size,
  strokeWidth,
}: ProgressRingProps) {
  const { percentage, accent, trackColor } = useProgressTheme(progress);

  return (
    <Host style={{ width: size, height: size }}>
      <CircularProgressIndicator
        progress={percentage / 100}
        color={accent}
        trackColor={trackColor}
        strokeWidth={strokeWidth}
        gapSize={0}
        strokeCap="round"
        modifiers={[sizeModifier(size, size)]}
      />
    </Host>
  );
}
