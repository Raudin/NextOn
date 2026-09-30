import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Spinner, Text, XStack, YStack } from "tamagui";

import EpisodePoster from "./EpisodePoster";

import {
  getCountdownString,
  posterPathOf,
  runtimeLabel,
  titleOf,
  type ResolvedScheduleItem,
  type ResolvedShowItem,
} from "@/lib/schedule";

/**
 * The three Home schedule sections.
 *
 * They share one row component because the row markup was triplicated across
 * them: the only real differences are the badge text and colour, the row
 * surface, and what sits on the right (a mark-watched ring, or a countdown).
 * Extracting it removed ~200 lines of near-identical JSX, and means an image or
 * layout fix only has to be made once.
 */

/** Poster size of a schedule row. */
const POSTER_WIDTH = 60;
const POSTER_HEIGHT = 90;

interface ScheduleRowProps {
  posterPath?: string | null;
  title: string;
  badgeText: string;
  badgeColor: string;
  detailsText: string;
  subtitleText: string;
  onPress: () => void;
  /** Row surface. Upcoming rows sit on the element colour, ready rows do not. */
  background?: string;
  /** Poster well colour, which contrasts against the row surface. */
  posterWellBackground?: string;
  /**
   * Aired-but-unwatched episodes, for the poster's count badge and stack.
   * Only TV rows have one; movies and upcoming rows leave it undefined.
   */
  episodesRemaining?: number;
  /** Replaces the mark-watched ring on the right. */
  trailing?: React.ReactNode;
  marking?: boolean;
  onMarkWatched?: () => void;
  markDisabled?: boolean;
}

function ScheduleRow({
  posterPath,
  title,
  badgeText,
  badgeColor,
  detailsText,
  subtitleText,
  onPress,
  background = "$background",
  posterWellBackground = "$backgroundElement",
  episodesRemaining,
  trailing,
  marking = false,
  onMarkWatched,
  markDisabled = false,
}: ScheduleRowProps) {
  return (
    <XStack
      gap="$3"
      p="$3"
      borderRadius="$4"
      borderCurve="continuous"
      bg={background}
      borderWidth={1}
      borderColor="$borderColor"
      pressStyle={{ opacity: 0.88 }}
      onPress={onPress}
      ai="center"
      jc="space-between"
    >
      <XStack gap="$3" f={1} ai="center">
        <EpisodePoster
          posterPath={posterPath}
          episodesRemaining={episodesRemaining}
          width={POSTER_WIDTH}
          height={POSTER_HEIGHT}
          wellBackground={posterWellBackground}
          badgeRingColor={background}
        />

        <YStack f={1} gap="$1" py="$1">
          <Text color={badgeColor} fow="bold" fos="$1" letterSpacing={0.5}>
            {badgeText}
          </Text>
          <Text color="$color" fow="900" fos="$4" numberOfLines={1}>
            {title}
          </Text>
          <Text color="$color" opacity={0.8} fow="600" fos="$3">
            {detailsText}
          </Text>
          <Text color="$color" opacity={0.5} fow="500" fos="$2" numberOfLines={1}>
            {subtitleText}
          </Text>
        </YStack>
      </XStack>

      {trailing ??
        (onMarkWatched ? (
          /* Hollow ring "mark watched" control */
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onMarkWatched();
            }}
            disabled={markDisabled}
            style={({ pressed }) => [
              styles.checkmarkTouch,
              pressed && styles.pressed,
            ]}
          >
            <YStack
              w={36}
              h={36}
              borderRadius={18}
              borderCurve="continuous"
              borderWidth={2.5}
              borderColor="$borderColor"
              bg="transparent"
              ai="center"
              jc="center"
            >
              {marking ? <Spinner size="small" color="$color" /> : null}
            </YStack>
          </Pressable>
        ) : null)}
    </XStack>
  );
}

/**
 * New Season Premieres.
 *
 * A distinct surrounding card because it is a call-out: an orange border and a
 * pill heading, drawing attention to a show returning for a new season.
 */
export function NewSeasonCard({
  items,
  markingId,
  onOpen,
  onMarkWatched,
}: {
  items: ResolvedShowItem[];
  markingId: number | null;
  onOpen: (item: ResolvedScheduleItem) => void;
  onMarkWatched: (item: ResolvedScheduleItem) => void;
}) {
  return (
    <YStack
      gap="$3"
      p="$3.5"
      borderRadius="$4"
      borderCurve="continuous"
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="$orange8"
    >
      <XStack ai="center" gap="$2">
        <YStack px="$2" py="$0.5" bg="$orange10" borderRadius="$2">
          <Text color="white" fow="900" fos="$1" letterSpacing={0.5}>
            NEW SEASON
          </Text>
        </YStack>
        <Text fow="900" fos="$5" color="$color">
          New Season Premieres
        </Text>
      </XStack>

      <YStack gap="$3">
        {items.map((item) => (
          <ScheduleRow
            key={`new-season-${item.id}`}
            posterPath={item.show.poster_path}
            title={titleOf(item)}
            badgeText="NEW SEASON"
            badgeColor="$orange10"
            detailsText={runtimeLabel(item)}
            subtitleText={item.episode.name}
            onPress={() => onOpen(item)}
            episodesRemaining={item.episodesRemaining}
            marking={markingId === item.id}
            markDisabled={markingId !== null}
            onMarkWatched={() => onMarkWatched(item)}
          />
        ))}
      </YStack>
    </YStack>
  );
}

/** Ready to Watch: the shows and movies with something available now. */
export function ReadyCard({
  items,
  markingId,
  onOpen,
  onMarkWatched,
}: {
  items: ResolvedScheduleItem[];
  markingId: number | null;
  onOpen: (item: ResolvedScheduleItem) => void;
  onMarkWatched: (item: ResolvedScheduleItem) => void;
}) {
  return (
    <YStack
      gap="$3"
      p="$3.5"
      borderRadius="$4"
      borderCurve="continuous"
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
    >
      <Text fow="900" fos="$5" color="$color">
        Ready to Watch
      </Text>

      <YStack gap="$3">
        {items.map((item) => (
          <ScheduleRow
            key={`ready-${item.id}`}
            posterPath={posterPathOf(item)}
            title={titleOf(item)}
            badgeText={
              item.isTv && item.isSeasonFinale ? "SEASON FINALE" : "READY TO WATCH"
            }
            badgeColor="$orange10"
            detailsText={runtimeLabel(item)}
            subtitleText={
              item.isTv ? item.episode.name : item.details?.tagline || "Released"
            }
            onPress={() => onOpen(item)}
            // Movies have no backlog, so only TV rows carry a count.
            episodesRemaining={item.isTv ? item.episodesRemaining : undefined}
            marking={markingId === item.id}
            markDisabled={markingId !== null}
            onMarkWatched={() => onMarkWatched(item)}
          />
        ))}
      </YStack>
    </YStack>
  );
}

/**
 * One month/day group of the upcoming schedule.
 *
 * The heading is split into its first word and the remainder so the two can be
 * weighted differently ("Today" bold, "Sep 24" muted).
 */
export function UpcomingGroup({
  header,
  items,
  onOpen,
}: {
  header: string;
  items: ResolvedScheduleItem[];
  onOpen: (item: ResolvedScheduleItem) => void;
}) {
  const [leading, ...rest] = header.split(" ");
  const trailing = rest.join(" ");

  return (
    <YStack gap="$3">
      <XStack ai="center" gap="$2">
        <Text fow="900" fos="$5" color="$color">
          {leading}
        </Text>
        {trailing ? (
          <Text fos="$3" color="$color" opacity={0.4} fow="600">
            {trailing}
          </Text>
        ) : null}
      </XStack>

      <YStack gap="$3">
        {items.map((item) => {
          let badgeText = "UPCOMING";
          if (item.isTv) {
            if (item.isNewSeason) {
              badgeText = "NEW SEASON";
            } else if (item.isSeasonFinale) {
              badgeText = "SEASON FINALE";
            }
          }

          return (
            <ScheduleRow
              key={`upcoming-${item.id}`}
              posterPath={posterPathOf(item)}
              title={titleOf(item)}
              badgeText={badgeText}
              badgeColor="$green10"
              detailsText={
                item.isTv
                  ? `Episode ${item.episode.episode_number}`
                  : runtimeLabel(item)
              }
              subtitleText={
                item.isTv
                  ? item.episode.name
                  : item.details?.tagline || "Upcoming Release"
              }
              onPress={() => onOpen(item)}
              background="$backgroundElement"
              posterWellBackground="$background"
              trailing={
                <YStack ai="flex-end" gap="$1" pr="$2">
                  <XStack ai="center" gap="$1">
                    <Text color="$color" fow="bold" fos="$3">
                      {item.targetDate ? getCountdownString(item.targetDate) : "Upcoming"}
                    </Text>
                  </XStack>
                  <Text color="$color" opacity={0.4} fos="$1">
                    12:00 AM
                  </Text>
                </YStack>
              }
            />
          );
        })}
      </YStack>
    </YStack>
  );
}

const styles = StyleSheet.create({
  checkmarkTouch: {
    padding: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  /**
   * Press feedback replacing TouchableOpacity's `activeOpacity`. A gentler fade
   * than the legacy default of 0.2, which nearly erased the hollow ring.
   * `disabled` suppresses this automatically, since a disabled Pressable never
   * reports `pressed`.
   */
  pressed: {
    opacity: 0.6,
  },
});
