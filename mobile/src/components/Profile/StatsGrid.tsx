import React from "react";
import { StyleSheet } from "react-native";
import { SymbolView } from "expo-symbols";
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

type StatCardProps = {
  label: string;
  value: string | number;
  symbol: string;
  tint: string;
};

function StatCard({ label, value, symbol, tint }: StatCardProps) {
  return (
    <YStack
      flex={1}
      minWidth={145}
      gap="$2"
      bg="$backgroundElement"
      p="$4"
      borderRadius="$4"
      borderCurve="continuous"
      borderWidth={1}
      borderColor="$borderColor"
    >
      <SymbolView
        name={{ ios: symbol as never, android: "star", web: "star" }}
        size={20}
        tintColor={tint}
      />
      <YStack gap="$0.5">
        <Text fow="800" fos="$7" color="$color" style={styles.value} selectable>
          {value}
        </Text>
        <Text fos="$2" color="$color" opacity={0.55}>
          {label}
        </Text>
      </YStack>
    </YStack>
  );
}

export default function StatsGrid({ stats }: StatsGridProps) {
  const xpInLevel = (stats.current_xp || 0) % 1000;
  const levelProgress = Math.min(1, Math.max(0, xpInLevel / 1000));

  return (
    <YStack gap="$3" w="100%">
      <YStack gap="$1">
        <Text fow="800" fos="$5" color="$color">Your activity</Text>
        <Text fos="$2" color="$color" opacity={0.55}>A quick look at your progress</Text>
      </YStack>

      <XStack flexWrap="wrap" gap="$3">
        <StatCard label="Movies watched" value={stats.total_movies_watched} symbol="film.fill" tint="#AF52DE" />
        <StatCard label="Episodes watched" value={stats.total_episodes_watched} symbol="play.tv.fill" tint="#007AFF" />
        <StatCard label="Watch time" value={formatWatchTime(stats.total_watch_time_minutes)} symbol="clock.fill" tint="#34C759" />
        <StatCard label="Current streak" value={`${stats.streak_days} days`} symbol="flame.fill" tint="#FF9500" />
      </XStack>

      <YStack gap="$2" bg="$backgroundElement" p="$4" borderRadius="$4" borderCurve="continuous" borderWidth={1} borderColor="$borderColor">
        <XStack jc="space-between" ai="center">
          <XStack ai="center" gap="$2">
            <SymbolView name={{ ios: "star.fill", android: "star", web: "star" }} size={20} tintColor="#AF52DE" />
            <Text fow="700" fos="$3" color="$color">Level {stats.current_level}</Text>
          </XStack>
          <Text fos="$2" color="$purple10" fow="700" style={styles.value}>{xpInLevel}/1000 XP</Text>
        </XStack>
        <YStack h={6} bg="$background" borderRadius="$3" overflow="hidden" w="100%">
          <YStack h="100%" w={`${Math.max(2, levelProgress * 100)}%`} bg="$purple10" borderRadius="$3" />
        </YStack>
      </YStack>
    </YStack>
  );
}

const styles = StyleSheet.create({
  value: { fontVariant: ["tabular-nums"] },
});
