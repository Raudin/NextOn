import { Text, XStack, YStack } from "tamagui";

import { useProgressTheme } from "./useProgressTheme";

interface WatchProgressBarProps {
  progress: number;
  /** Show the trailing percentage label. */
  showLabel?: boolean;
}

/**
 * Continuous horizontal progress line used in the watchlist list layout,
 * where the circular ring from the poster layout reads poorly.
 */
export default function WatchProgressBar({
  progress,
  showLabel = true,
}: WatchProgressBarProps) {
  const { percentage, accent } = useProgressTheme(progress);

  return (
    <XStack ai="center" gap="$2">
      <YStack f={1} h={5} borderRadius={999} bg="$background" overflow="hidden">
        <YStack
          h="100%"
          w={`${Math.max(2, percentage)}%`}
          bg={accent}
          borderRadius={999}
        />
      </YStack>
      {showLabel ? (
        <Text color={accent} fos="$2" fow="800" miw={34} ta="right">
          {percentage}%
        </Text>
      ) : null}
    </XStack>
  );
}
