import React from "react";
import { StyleSheet } from "react-native";
import { Text, XStack, YStack } from "tamagui";
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
  return (
    <YStack gap="$3">
      <Text fow="800" fos="$4" color="$color" opacity={0.8} letterSpacing={0.5}>
        STATISTICS
      </Text>
      <YStack gap="$3">
        <XStack gap="$3">
          <YStack f={1} bg="$backgroundElement" p="$4" borderRadius="$4" borderWidth={1} borderColor="$borderColor" ai="center" jc="center" gap="$1" style={styles.cardShadow}>
            <Text fos="$8">🎬</Text>
            <Text fow="900" fos="$5" color="$color" mt="$1">
              {stats.total_movies_watched}
            </Text>
            <Text fos="$1" color="$color" opacity={0.5} fow="600" ta="center">
              Movies Watched
            </Text>
          </YStack>

          <YStack f={1} bg="$backgroundElement" p="$4" borderRadius="$4" borderWidth={1} borderColor="$borderColor" ai="center" jc="center" gap="$1" style={styles.cardShadow}>
            <Text fos="$8">📺</Text>
            <Text fow="900" fos="$5" color="$color" mt="$1">
              {stats.total_episodes_watched}
            </Text>
            <Text fos="$1" color="$color" opacity={0.5} fow="600" ta="center">
              Episodes Watched
            </Text>
          </YStack>
        </XStack>

        <XStack gap="$3">
          <YStack f={1} bg="$backgroundElement" p="$4" borderRadius="$4" borderWidth={1} borderColor="$borderColor" ai="center" jc="center" gap="$1" style={styles.cardShadow}>
            <Text fos="$8">⏱️</Text>
            <Text fow="900" fos="$5" color="$color" mt="$1">
              {formatWatchTime(stats.total_watch_time_minutes)}
            </Text>
            <Text fos="$1" color="$color" opacity={0.5} fow="600" ta="center">
              Total Time Spent
            </Text>
          </YStack>

          <YStack f={1} bg="$backgroundElement" p="$4" borderRadius="$4" borderWidth={1} borderColor="$borderColor" ai="center" jc="center" gap="$1" style={styles.cardShadow}>
            <Text fos="$8">🔥</Text>
            <Text fow="900" fos="$5" color="$color" mt="$1">
              {stats.streak_days} {stats.streak_days === 1 ? "Day" : "Days"}
            </Text>
            <Text fos="$1" color="$color" opacity={0.5} fow="600" ta="center">
              Current Streak
            </Text>
          </YStack>
        </XStack>
      </YStack>
    </YStack>
  );
}

const styles = StyleSheet.create({
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
});
