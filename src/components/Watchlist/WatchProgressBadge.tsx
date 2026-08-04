import Svg, { Circle } from "react-native-svg";
import { useTheme, YStack } from "tamagui";

interface WatchProgressBadgeProps {
  progress: number;
}

export default function WatchProgressBadge({
  progress,
}: WatchProgressBadgeProps) {
  const theme = useTheme();
  const percentage = Math.max(0, Math.min(100, Math.round(progress * 100)));
  const accent =
    percentage >= 80
      ? (theme.green9?.val ?? "#22C55E")
      : percentage >= 45
        ? (theme.orange9?.val ?? "#F97316")
        : (theme.red9?.val ?? "#EF4444");

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
      bg="rgba(0,0,0,0.82)"
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
          stroke="rgba(255,255,255,0.22)"
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
