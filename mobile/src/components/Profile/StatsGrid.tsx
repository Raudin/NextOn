import React from "react";
import { StyleSheet } from "react-native";
import { ScrollView, Text, XStack, YStack } from "tamagui";
import { type ProfileStats } from "@/lib/media-api";

interface StatsGridProps {
  stats: ProfileStats;
}

function formatWatchTime(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  return `${days}d ${hours}h`;
}

export default function StatsGrid({ stats }: StatsGridProps) {
  const xpInLevel = (stats.current_xp || 0) % 1000;
  const levelProgress = Math.min(1, Math.max(0, xpInLevel / 1000));

  return (
    <YStack gap="$2" w="100%">
      <XStack jc="space-between" ai="center" px="$1">
        <Text fow="800" fos="$2" color="$color" opacity={0.6} letterSpacing={1}>
          STATISTICS
        </Text>
        <Text fos="$1" color="$purple10" fow="600">
          Scroll for details →
        </Text>
      </XStack>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContainer}
        decelerationRate="fast"
      >
        {/* Card 1: Movies Watched */}
        <YStack
          w={135}
          bg="$backgroundElement"
          p="$3"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$borderColor"
          ai="flex-start"
          jc="space-between"
          gap="$2"
          style={styles.cardShadow}
        >
          <XStack w="100%" jc="space-between" ai="center">
            <Text fos="$6">🎬</Text>
            <XStack bg="$purple3" px="$2" py="$0.5" borderRadius="$3">
              <Text fos="$1" color="$purple10" fow="bold">Films</Text>
            </XStack>
          </XStack>
          <YStack gap="$0.5">
            <Text fow="900" fos="$6" color="$color">
              {stats.total_movies_watched}
            </Text>
            <Text fos="$1" color="$color" opacity={0.5} fow="600">
              Movies Watched
            </Text>
          </YStack>
        </YStack>

        {/* Card 2: Episodes Watched */}
        <YStack
          w={135}
          bg="$backgroundElement"
          p="$3"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$borderColor"
          ai="flex-start"
          jc="space-between"
          gap="$2"
          style={styles.cardShadow}
        >
          <XStack w="100%" jc="space-between" ai="center">
            <Text fos="$6">📺</Text>
            <XStack bg="$blue3" px="$2" py="$0.5" borderRadius="$3">
              <Text fos="$1" color="$blue10" fow="bold">Shows</Text>
            </XStack>
          </XStack>
          <YStack gap="$0.5">
            <Text fow="900" fos="$6" color="$color">
              {stats.total_episodes_watched}
            </Text>
            <Text fos="$1" color="$color" opacity={0.5} fow="600">
              Episodes Watched
            </Text>
          </YStack>
        </YStack>

        {/* Card 3: Watch Time */}
        <YStack
          w={135}
          bg="$backgroundElement"
          p="$3"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$borderColor"
          ai="flex-start"
          jc="space-between"
          gap="$2"
          style={styles.cardShadow}
        >
          <XStack w="100%" jc="space-between" ai="center">
            <Text fos="$6">⏱️</Text>
            <XStack bg="$green3" px="$2" py="$0.5" borderRadius="$3">
              <Text fos="$1" color="$green10" fow="bold">Time</Text>
            </XStack>
          </XStack>
          <YStack gap="$0.5">
            <Text fow="900" fos="$5" color="$color">
              {formatWatchTime(stats.total_watch_time_minutes)}
            </Text>
            <Text fos="$1" color="$color" opacity={0.5} fow="600">
              Total Time Spent
            </Text>
          </YStack>
        </YStack>

        {/* Card 4: Streak */}
        <YStack
          w={135}
          bg="$backgroundElement"
          p="$3"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$borderColor"
          ai="flex-start"
          jc="space-between"
          gap="$2"
          style={styles.cardShadow}
        >
          <XStack w="100%" jc="space-between" ai="center">
            <Text fos="$6">🔥</Text>
            <XStack bg="$orange3" px="$2" py="$0.5" borderRadius="$3">
              <Text fos="$1" color="$orange10" fow="bold">Active</Text>
            </XStack>
          </XStack>
          <YStack gap="$0.5">
            <Text fow="900" fos="$6" color="$color">
              {stats.streak_days} <Text fos="$2" color="$color" opacity={0.7}>Days</Text>
            </Text>
            <Text fos="$1" color="$color" opacity={0.5} fow="600">
              Current Streak
            </Text>
          </YStack>
        </YStack>

        {/* Card 5: Level & XP Progress */}
        <YStack
          w={155}
          bg="$backgroundElement"
          p="$3"
          borderRadius="$4"
          borderWidth={1}
          borderColor="$borderColor"
          ai="flex-start"
          jc="space-between"
          gap="$2"
          style={styles.cardShadow}
        >
          <XStack w="100%" jc="space-between" ai="center">
            <Text fos="$6">⭐</Text>
            <XStack bg="$purple10" px="$2" py="$0.5" borderRadius="$3">
              <Text fos="$1" color="white" fow="bold">Lv. {stats.current_level}</Text>
            </XStack>
          </XStack>
          <YStack gap="$1" w="100%">
            <XStack jc="space-between" ai="center">
              <Text fos="$1" color="$color" opacity={0.5} fow="600">
                XP Progress
              </Text>
              <Text fos="$1" color="$purple10" fow="bold">
                {xpInLevel}/1000
              </Text>
            </XStack>
            <YStack h={5} bg="$background" borderRadius="$2" overflow="hidden" w="100%">
              <YStack
                h="100%"
                w={`${Math.max(5, levelProgress * 100)}%`}
                bg="$purple10"
                borderRadius="$2"
              />
            </YStack>
          </YStack>
        </YStack>
      </ScrollView>
    </YStack>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    gap: 12,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
});
