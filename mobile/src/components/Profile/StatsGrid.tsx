import React from "react";
import { StyleSheet } from "react-native";
import { Text, XStack, YStack } from "tamagui";
import { type ProfileStats } from "@/lib/media-api";

interface StatsGridProps {
  stats: ProfileStats;
}

export function formatWatchTime(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes || 0));
  if (minutes < 60) return `${minutes}m`;

  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

interface StatCardData {
  id: string;
  value: string | number;
  label: string;
}

export default function StatsGrid({ stats }: StatsGridProps) {
  const cards: StatCardData[] = [
    {
      id: "episodes",
      value: stats.total_episodes_watched,
      label: "Watched episodes",
    },
    {
      id: "movies",
      value: stats.total_movies_watched,
      label: "Watched movies",
    },
    {
      id: "watch_time",
      value: formatWatchTime(stats.total_watch_time_minutes),
      label: "Total time",
    },
    {
      id: "streak",
      value: `${stats.streak_days} ${stats.streak_days === 1 ? "day" : "days"}`,
      label: "Current streak",
    },
  ];

  return (
    <YStack gap="$3" w="100%">
      {/* Header: Clean title, deliberately NO 'View all' */}
      <XStack ai="center" jc="space-between">
        <Text color="$color" fow="900" fos="$6">
          Stats
        </Text>
      </XStack>

      {/* 2x2 Grid of Cards */}
      <YStack gap="$2.5" w="100%">
        <XStack gap="$2.5" w="100%">
          <StatCardItem card={cards[0]} />
          <StatCardItem card={cards[1]} />
        </XStack>
        <XStack gap="$2.5" w="100%">
          <StatCardItem card={cards[2]} />
          <StatCardItem card={cards[3]} />
        </XStack>
      </YStack>
    </YStack>
  );
}

function StatCardItem({ card }: { card: StatCardData }) {
  return (
    <YStack
      f={1}
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$4"
      borderCurve="continuous"
      p="$3.5"
      jc="center"
      minHeight={90}
      gap="$1"
    >
      <Text
        color="$color"
        fow="900"
        fos="$7"
        numberOfLines={1}
        style={styles.numericValue}
      >
        {card.value}
      </Text>
      <Text
        color="$color"
        opacity={0.55}
        fow="600"
        fos="$2"
        numberOfLines={1}
      >
        {card.label}
      </Text>
    </YStack>
  );
}

const styles = StyleSheet.create({
  numericValue: {
    fontVariant: ["tabular-nums"],
  },
});
