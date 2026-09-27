import Svg, { Circle } from "react-native-svg";

import { useProgressTheme } from "./useProgressTheme";
import type { ProgressRingProps } from "./progress-props";

/**
 * The progress ring for iOS and web: the `react-native-svg` pair of circles the
 * poster badge has always drawn, moved here so `WatchProgressBadge` can stay
 * platform-agnostic. Android draws the same value with Jetpack Compose — see
 * `ProgressRing.android.tsx`.
 *
 * A progress of zero draws nothing, which is what the badge did before: unlike
 * the linear bar, the ring was never given a minimum arc.
 */
export default function ProgressRing({
  progress,
  size,
  strokeWidth,
}: ProgressRingProps) {
  const { percentage, accent, trackColor } = useProgressTheme(progress);

  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={trackColor}
        strokeWidth={strokeWidth}
        fill="transparent"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={accent}
        strokeWidth={strokeWidth}
        fill="transparent"
        strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}
