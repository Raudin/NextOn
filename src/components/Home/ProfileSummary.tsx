import React from "react";
import { Text, XStack, YStack } from "tamagui";

interface ProfileSummaryProps {
  level: number;
  title: string;
  xpInLevel: number;
  streak: number;
  percentage: number;
}

export default function ProfileSummary({
  level,
  title,
  xpInLevel,
  streak,
  percentage,
}: ProfileSummaryProps) {
  return (
    <YStack
      bg="$backgroundElement"
      p="$4"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$borderColor"
      gap="$3"
    >
      <XStack jc="space-between" ai="center">
        <YStack gap="$1">
          <Text color="$color" fow="900" fos="$5">
            Lv. {level} {title}
          </Text>
          <Text color="$color" opacity={0.6} fos="$2">
            {xpInLevel} / 1000 XP
          </Text>
        </YStack>
        <XStack ai="center" gap="$1" bg="$background" px="$3" py="$1.5" borderRadius="$4">
          <Text fos="$4">🔥</Text>
          <Text fow="800" fos="$3" color="$color">
            {streak}-Day Streak
          </Text>
        </XStack>
      </XStack>

      {/* Horizontal progress bar */}
      <YStack h={8} bg="$background" borderRadius="$2" overflow="hidden">
        <YStack
          h="100%"
          w={`${Math.max(2, percentage * 100)}%`}
          bg="$green10"
          borderRadius="$2"
        />
      </YStack>
    </YStack>
  );
}
