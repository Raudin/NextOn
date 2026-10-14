import React from "react";
import { StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Award from "lucide-react-native/icons/award";
import { Text, XStack, YStack } from "tamagui";
import { type ProfileStats } from "@/lib/media-api";

const XP_PER_LEVEL = 1000;

export function getLevelTitle(level: number): string {
  if (level < 3) return "Novice";
  if (level < 6) return "Screen Cadet";
  if (level < 10) return "Episode Enthusiast";
  if (level < 15) return "Serial Streamer";
  if (level < 21) return "Binge Commander";
  if (level < 31) return "Showmaster";
  return "Couch Emperor";
}

interface LevelCardProps {
  stats: ProfileStats;
  onLearnMore?: () => void;
  onShare?: () => void;
}

export default function LevelCard({ stats, onLearnMore, onShare }: LevelCardProps) {
  const xpInLevel = Math.max(0, (stats.current_xp || 0) % XP_PER_LEVEL);
  const progress = Math.min(1, Math.max(0.04, xpInLevel / XP_PER_LEVEL));
  const levelTitle = getLevelTitle(stats.current_level);

  // SVG Circular Ring parameters
  const size = 46;
  const strokeWidth = 4.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <XStack
      w="100%"
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$4"
      borderCurve="continuous"
      p="$3.5"
      ai="center"
      jc="space-between"
      gap="$3"
    >
      {/* Left: Level Icon in subtle rounded container */}
      <XStack ai="center" gap="$3" f={1}>
        <YStack
          w={44}
          h={44}
          br={22}
          bg="$background"
          borderWidth={1}
          borderColor="$borderColor"
          ai="center"
          jc="center"
        >
          <Award size={24} color="#FFFFFF" strokeWidth={2.2} />
        </YStack>

        {/* Center: Title and XP */}
        <YStack f={1} gap={2}>
          <Text color="$color" fow="800" fos="$4" numberOfLines={1}>
            Level {stats.current_level}: {levelTitle}
          </Text>
          <XStack ai="center" gap="$2.5">
            <Text color="$color" opacity={0.55} fos="$1" fow="600">
              {xpInLevel} / {XP_PER_LEVEL} XP
            </Text>
            {onLearnMore ? (
              <Text
                color="$color"
                opacity={0.8}
                fos="$1"
                fow="700"
                pressStyle={{ opacity: 0.5 }}
                onPress={onLearnMore}
              >
                Details
              </Text>
            ) : null}
            {onShare ? (
              <Text
                color="$color"
                opacity={0.8}
                fos="$1"
                fow="700"
                pressStyle={{ opacity: 0.5 }}
                onPress={onShare}
              >
                Share
              </Text>
            ) : null}
          </XStack>
        </YStack>
      </XStack>

      {/* Right: Circular Progress Ring */}
      <YStack w={size} h={size} ai="center" jc="center" pos="relative">
        <Svg width={size} height={size} style={styles.svgRing}>
          {/* Background track circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#2B2D31"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Foreground progress arc */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#FFFFFF"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <Text color="$color" opacity={0.7} fos={10} fow="800" pos="absolute">
          {Math.round(progress * 100)}%
        </Text>
      </YStack>
    </XStack>
  );
}

const styles = StyleSheet.create({
  svgRing: {
    transform: [{ rotate: "0deg" }],
  },
});
