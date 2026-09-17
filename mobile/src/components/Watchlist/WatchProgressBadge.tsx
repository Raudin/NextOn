import Svg, { Circle } from "react-native-svg";
import { YStack } from "tamagui";

import { useProgressTheme } from "./useProgressTheme";

interface WatchProgressBadgeProps {
  progress: number;
}

export default function WatchProgressBadge({
  progress,
}: WatchProgressBadgeProps) {
  const { percentage, accent, surface, borderTone, trackColor } =
    useProgressTheme(progress);

  const size = 20;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <YStack
      w={size}
      h={size}
      borderRadius={999}
      ai="center"
      jc="center"
      bg={surface}
      borderWidth={1}
      borderColor={borderTone}
      shadowColor="#000"
      shadowOpacity={0.3}
      shadowRadius={8}
      shadowOffset={{ width: 0, height: 4 }}
    >
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
    </YStack>
  );
}
