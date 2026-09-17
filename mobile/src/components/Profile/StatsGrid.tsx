import React from "react";
import { StyleSheet } from "react-native";
import { Clock, Flame, Film, Star, Tv, type LucideIcon } from "lucide-react-native";
import { Text, XStack, YStack } from "tamagui";
import { type ProfileStats } from "@/lib/media-api";
import {
  Group,
  IconTile,
  LIST_ROW_GAP,
  LIST_ROW_PADDING,
  SectionHeader,
  Separator,
} from "@/components/Profile/grouped-list";

interface StatsGridProps {
  stats: ProfileStats;
}

const XP_PER_LEVEL = 1000;

function formatWatchTime(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes || 0));
  if (minutes < 60) return `${minutes}m`;

  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

interface StatRow {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tint: string;
}

function StatRowView({ row }: { row: StatRow }) {
  return (
    <XStack ai="center" gap={LIST_ROW_GAP} px={LIST_ROW_PADDING} minHeight={52}>
      <IconTile icon={row.icon} tint={row.tint} />
      <Text f={1} color="$color" fos="$3" numberOfLines={1}>
        {row.label}
      </Text>
      <Text
        color="$color"
        opacity={0.6}
        fow="700"
        fos="$3"
        numberOfLines={1}
        style={styles.value}
      >
        {row.value}
      </Text>
    </XStack>
  );
}

export default function StatsGrid({ stats }: StatsGridProps) {
  const xpInLevel = Math.max(0, (stats.current_xp || 0) % XP_PER_LEVEL);
  const levelProgress = Math.min(1, Math.max(0, xpInLevel / XP_PER_LEVEL));

  const rows: StatRow[] = [
    {
      label: "Movies watched",
      value: stats.total_movies_watched,
      icon: Film,
      tint: "#AF52DE",
    },
    {
      label: "Episodes watched",
      value: stats.total_episodes_watched,
      icon: Tv,
      tint: "#007AFF",
    },
    {
      label: "Watch time",
      value: formatWatchTime(stats.total_watch_time_minutes),
      icon: Clock,
      tint: "#34C759",
    },
    {
      label: "Current streak",
      value: `${stats.streak_days} ${stats.streak_days === 1 ? "day" : "days"}`,
      icon: Flame,
      tint: "#FF9500",
    },
  ];

  return (
    <YStack gap={10} w="100%">
      <SectionHeader>Your activity</SectionHeader>

      <Group>
        {rows.map((row, index) => (
          <React.Fragment key={row.label}>
            {index > 0 ? <Separator /> : null}
            <StatRowView row={row} />
          </React.Fragment>
        ))}
      </Group>

      <Group>
        <XStack
          ai="center"
          gap={LIST_ROW_GAP}
          px={LIST_ROW_PADDING}
          pt={LIST_ROW_PADDING}
          pb={10}
        >
          <IconTile icon={Star} tint="#AF52DE" />
          <Text f={1} color="$color" fos="$3" numberOfLines={1}>
            Level {stats.current_level}
          </Text>
          <Text
            color="$color"
            opacity={0.6}
            fow="700"
            fos="$3"
            numberOfLines={1}
            style={styles.value}
          >
            {xpInLevel}/{XP_PER_LEVEL} XP
          </Text>
        </XStack>

        <YStack px={LIST_ROW_PADDING} pb={LIST_ROW_PADDING}>
          <YStack h={4} br={2} bg="$background" overflow="hidden" w="100%">
            <YStack
              h="100%"
              w={`${Math.max(2, levelProgress * 100)}%`}
              bg="$purple9"
              br={2}
            />
          </YStack>
        </YStack>
      </Group>
    </YStack>
  );
}

const styles = StyleSheet.create({
  value: { fontVariant: ["tabular-nums"] },
});
