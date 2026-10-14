import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Spinner, Text, XStack, YStack } from "tamagui";

import EpisodePoster from "./EpisodePoster";
import { useIsMarking } from "./marking-store";

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
 *
 * ## Why the sections are flattened
 *
 * Each section used to be one FlashList item wrapping a `.map()` over its rows,
 * so a section with 60 shows meant 60 rows — and up to 180 `Image` views —
 * mounted inside a single cell, and all of them re-rendered whenever the
 * marking state changed. A section now contributes one header item and one item
 * per row, so FlashList recycles rows individually and mounts only what is near
 * the viewport.
 *
 * The sections were short enough that section-level virtualization was not the
 * problem; per-row state was. A section is still one contiguous run of the
 * list, so a far-off month group is still not mounted.
 *
 * ## How one card is drawn by several items
 *
 * A section is still visually one card, which is what makes the flattening
 * awkward: its surface and its internal spacing now have to be drawn by items
 * that know nothing about each other.
 *
 * Only the *edge* items paint (`CardShell`'s `edge`): the heading carries the
 * card's rounded top and the card's 14pt of top padding; the section's last row
 * carries the rounded bottom and the same 14pt of bottom padding; and every
 * segment in between contributes only surface. Items inside a section are
 * separated by 0pt, so the segments tile exactly the area the single card used
 * to fill.
 *
 * ## Why a section has no outline
 *
 * A section is several list items now, so there is no longer one box around
 * which an outline could be drawn. Painting one from the segments would mean a
 * stroke that stops and restarts at every join — and, because the outline of a
 * card whose sides are made of separate items can only be the top edge of the
 * first and the bottom edge of the last, a full-width line above and below each
 * section that encloses nothing. So a card is surface only, and the outline
 * that remains is the one each *row* draws around itself: `ScheduleRow` is
 * still a bordered, rounded card. A section reads as a group from its surface,
 * its heading and the 20pt of space around it.
 *
 * The 12pt between rows is a `pb` on the segment above it (`CardShell`'s
 * `padding="gap"`), which is the one place the spacing can live without
 * changing the card's height: as its own segment it would enlarge the segment
 * that owns it and double-count against its neighbour's; as a margin on the
 * cell it would fall outside the box FlashList measures; as its own spacer item
 * it would measure correctly but add a contentless cell per row per section.
 *
 * ## Why every segment is pinned to the list's width
 *
 * A card is only inside the screen if the box it is drawn around is: each
 * segment is `w="100%"` of the cell FlashList hands it, and every row inside a
 * segment is pinned the same way. Left to its content a row takes the width of
 * its longest line, and the segment — and with it the card's surface — grows to
 * match and runs off the right edge. The text columns carry `minWidth={0}` so a
 * long title ellipsises rather than pushing the row wider, and `overflow` on
 * both the card and the row is the backstop: whatever a badge or a label does,
 * it is clipped to the card instead of drawn beside it.
 *
 * The card's inset from the screen edge comes from the screen, not from here:
 * `(tabs)/index.tsx` pads its list by 18pt on each side, which is what `px="$4"`
 * resolves to on the space scale this app loads.
 *
 * One consequence of dropping the outline: a segment no longer spends 1pt of
 * border on its top and bottom, so each segment is 2pt shorter than the bordered
 * version was and a card's total height drops by 2pt per item in it. Nothing
 * else about the heights moved — the card's padding and the 12pt between rows
 * are the same numbers they were.
 *
 * ## Marking state
 *
 * Rows do not receive `markingId`. They subscribe to `marking-store`
 * individually, so a tap re-renders the two rows whose spinner state actually
 * changed instead of every row in the list. See `marking-store.ts` for why
 * that could not be left to React Compiler.
 */

/** Poster size of a schedule row. */
const POSTER_WIDTH = 60;
const POSTER_HEIGHT = 90;

/** The space a card keeps between two of its rows, in px. */
const ROW_GAP = 12;

/**
 * The card's outer padding, in px. Rows keep to it horizontally, and it is what
 * the card spends above its heading and below its last row.
 *
 * A plain number rather than a token because the flattened card divides its
 * padding between segments — the one that rounds the top, every one that spaces
 * the rows, the one that rounds the bottom — and each of them takes the
 * resolved value. (`px="$3.5"`, which the old whole-card container used, is 16
 * on the space scale this app loads.)
 */
const CARD_PAD = 14;

/**
 * The card's corner radius, in px.
 *
 * `borderRadius="$4"` on the old whole-card containers, which resolves to 9 in
 * the token set this app loads. It is a number rather than the token because a
 * card is now drawn by several items and each has to round only *its* corners:
 * `borderRadius` would round all four, and the corner-specific props take a
 * plain value.
 */
const CARD_RADIUS = 9;

/**
 * Which part of its card an item is, for surface and rounding purposes.
 *
 * `top` rounds the card's top corners and carries the card's 14pt of top
 * padding, `bottom` rounds the bottom corners and spends the same 14pt as
 * bottom padding, and `middle` only contributes surface.
 */
type CardEdge = "top" | "middle" | "bottom";

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
  /**
   * Whether this row's mark-watched control is spinning.
   *
   * Read from the store by the caller rather than passed down from the screen,
   * so the subscription — and therefore the re-render — belongs to the row.
   */
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
      // The same guarantee one level in: the row is as wide as the card's
      // content box, never as wide as its longest line.
      w="100%"
      overflow="hidden"
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
      {/* `minWidth={0}` on both columns is what actually lets the title
          truncate: a flex item's automatic minimum size is its content, so
          without it a long title keeps its full width and the row grows to fit
          it instead of ellipsising. */}
      <XStack gap="$3" f={1} minWidth={0} ai="center">
        <EpisodePoster
          posterPath={posterPath}
          episodesRemaining={episodesRemaining}
          width={POSTER_WIDTH}
          height={POSTER_HEIGHT}
          wellBackground={posterWellBackground}
          badgeRingColor={background}
        />

        <YStack f={1} minWidth={0} gap="$1" py="$1">
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
 * One segment of a section's card.
 *
 * `edge` decides which of the card's outer corners this segment rounds, and
 * every segment contributes its slice of the card's surface — the heading the
 * card's top two corners, the last row the bottom two, the ones between only
 * surface. A section has no outline: see the note at the top of this file.
 */
function CardShell({
  edge,
  children,
  padding = "gap",
}: {
  edge: CardEdge;
  children: React.ReactNode;
  /**
   * `top` is a section's heading: it carries the card's 14pt of top padding and
   * the 12pt gap down to its first row. `gap` is every segment with a row below
   * it, reserving the same 12pt. `last` is the final row, which spends the
   * card's 14pt of bottom padding instead.
   */
  padding?: "top" | "gap" | "last";
}) {
  const bottomPadding = padding === "last" ? CARD_PAD : ROW_GAP;

  return (
    <YStack
      // The segment is exactly as wide as the cell FlashList hands it, and
      // nothing inside it may paint beyond that box. Both halves matter: a row
      // whose text will not shrink would otherwise stretch the segment — and
      // with it the card's surface — out past the right edge of the screen, and
      // `overflow` is the backstop that keeps a wide badge or label clipped to
      // the card rather than drawn over the background beside it.
      w="100%"
      overflow="hidden"
      px={CARD_PAD}
      pt={padding === "top" ? CARD_PAD : 0}
      pb={bottomPadding}
      bg="$backgroundElement"
      // Rounded only at the card's true corners, so the segments meet in a
      // straight line where they abut. `overflow` clips nothing that is meant to
      // be seen: the poster well is `borderRadius` 5 and inset by the horizontal
      // padding, so it never reaches a card corner.
      borderTopLeftRadius={edge === "top" ? CARD_RADIUS : 0}
      borderTopRightRadius={edge === "top" ? CARD_RADIUS : 0}
      borderBottomLeftRadius={edge === "bottom" ? CARD_RADIUS : 0}
      borderBottomRightRadius={edge === "bottom" ? CARD_RADIUS : 0}
      borderCurve={edge === "top" || edge === "bottom" ? "continuous" : undefined}
    >
      {children}
    </YStack>
  );
}

/**
 * One row of the New Season Premieres card.
 *
 * Subscribes to the marking store so only this row re-renders when its own
 * spinner appears or clears.
 */
export function NewSeasonRow({
  item,
  edge,
  onOpen,
  onMarkWatched,
}: {
  item: ResolvedShowItem;
  edge: CardEdge;
  onOpen: (item: ResolvedScheduleItem) => void;
  onMarkWatched: (item: ResolvedScheduleItem) => void;
}) {
  const marking = useIsMarking(item.id);

  return (
    <CardShell edge={edge} padding={edge === "bottom" ? "last" : "gap"}>
      <ScheduleRow
        posterPath={item.show.poster_path}
        title={titleOf(item)}
        badgeText="NEW SEASON"
        badgeColor="$orange10"
        detailsText={runtimeLabel(item)}
        subtitleText={item.episode.name}
        onPress={() => onOpen(item)}
        episodesRemaining={item.episodesRemaining}
        marking={marking}
        markDisabled={marking}
        onMarkWatched={() => onMarkWatched(item)}
      />
    </CardShell>
  );
}

/** Heading of the New Season Premieres card: the orange NEW SEASON pill. */
export function NewSeasonHeader() {
  return (
    <CardShell edge="top" padding="top">
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
    </CardShell>
  );
}

/** Ready to Watch: the shows and movies with something available now. */
export function ReadyRow({
  item,
  edge,
  onOpen,
  onMarkWatched,
}: {
  item: ResolvedScheduleItem;
  edge: CardEdge;
  onOpen: (item: ResolvedScheduleItem) => void;
  onMarkWatched: (item: ResolvedScheduleItem) => void;
}) {
  const marking = useIsMarking(item.id);

  return (
    <CardShell edge={edge} padding={edge === "bottom" ? "last" : "gap"}>
      <ScheduleRow
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
        marking={marking}
        markDisabled={marking}
        onMarkWatched={() => onMarkWatched(item)}
      />
    </CardShell>
  );
}

/** Heading of the Ready to Watch card. */
export function ReadyHeader() {
  return (
    <CardShell edge="top" padding="top">
      <Text fow="900" fos="$5" color="$color">
        Ready to Watch
      </Text>
    </CardShell>
  );
}

/**
 * One row of a month/day group of the upcoming schedule.
 *
 * The group heading is split into its first word and the remainder so the two
 * can be weighted differently ("Today" bold, "Sep 24" muted).
 */
export function UpcomingHeader({ header }: { header: string }) {
  const [leading, ...rest] = header.split(" ");
  const trailing = rest.join(" ");

  return (
    <CardShell edge="top" padding="top">
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
    </CardShell>
  );
}

export function UpcomingRow({
  item,
  edge,
  onOpen,
}: {
  item: ResolvedScheduleItem;
  edge: CardEdge;
  onOpen: (item: ResolvedScheduleItem) => void;
}) {
  let badgeText = "UPCOMING";
  if (item.isTv) {
    if (item.isNewSeason) {
      badgeText = "NEW SEASON";
    } else if (item.isSeasonFinale) {
      badgeText = "SEASON FINALE";
    }
  }

  return (
    <CardShell edge={edge} padding={edge === "bottom" ? "last" : "gap"}>
      <ScheduleRow
        posterPath={posterPathOf(item)}
        title={titleOf(item)}
        badgeText={badgeText}
        badgeColor="$green10"
        detailsText={
          item.isTv ? `Episode ${item.episode.episode_number}` : runtimeLabel(item)
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
    </CardShell>
  );
}

/**
 * One row of the Home schedule list.
 *
 * Each section contributes a heading item followed by one item per row, so a
 * section is a contiguous run of items. `getItemType` maps the `type` tag,
 * which keeps one recycle pool per item shape rather than one per section
 * instance.
 *
 * `sectionKey` is what identifies the card an item belongs to. It is not
 * `type`: every row of a section shares a `type`, but so does every row of
 * *every* section of that kind, so `type` cannot tell "the last Ready row" from
 * "a Ready row with an Upcoming group after it" — and that distinction is
 * exactly what decides where one card ends.
 *
 * Keys are prefixed with the section they belong to: the same title can appear
 * in two sections at once (a show can be both ready and premiering a new
 * season), and FlashList requires keys to be unique across the whole list.
 */
export type ScheduleListItem =
  | { type: "newSeasonHeader"; key: string; sectionKey: string }
  | {
      type: "newSeasonRow";
      key: string;
      sectionKey: string;
      item: ResolvedShowItem;
      edge: CardEdge;
    }
  | { type: "readyHeader"; key: string; sectionKey: string }
  | {
      type: "readyRow";
      key: string;
      sectionKey: string;
      item: ResolvedScheduleItem;
      edge: CardEdge;
    }
  | { type: "upcomingHeader"; key: string; sectionKey: string; header: string }
  | {
      type: "upcomingRow";
      key: string;
      sectionKey: string;
      item: ResolvedScheduleItem;
      edge: CardEdge;
    };

/** `bottom` on the final row so it can close the card; `middle` otherwise. */
const edgeAt = (index: number, length: number): CardEdge =>
  index === length - 1 ? "bottom" : "middle";

/**
 * Flattens the three section shapes into the list FlashList is handed.
 *
 * This is structural rather than presentational: it exists so the list can
 * recycle rows, and it is kept out of the screen so the shape of the data and
 * the components that render it stay in one file.
 *
 * There are no spacer items. The 12pt between rows is a `pb` on the segment
 * above (`CardShell`'s `padding="gap"`), which is the one place it can live
 * without changing the card's height: it is inside that segment's measured box,
 * and the gap therefore replaces nothing — the old card's surface ran
 * continuously from one row to the next, and this padding is that surface.
 */
export function buildScheduleList(sections: {
  newSeason: ResolvedShowItem[];
  ready: ResolvedScheduleItem[];
  upcoming: { header: string; items: ResolvedScheduleItem[] }[];
}): ScheduleListItem[] {
  const out: ScheduleListItem[] = [];
  const NEW_SEASON = "new-season";
  const READY = "ready";

  const pushSection = <T,>(
    sectionKey: string,
    items: T[],
    build: (item: T, edge: CardEdge) => ScheduleListItem,
  ) => {
    items.forEach((item, index) => {
      out.push(build(item, edgeAt(index, items.length)));
    });
  };

  if (sections.newSeason.length > 0) {
    out.push({
      type: "newSeasonHeader",
      key: `${NEW_SEASON}-header`,
      sectionKey: NEW_SEASON,
    });
    pushSection(NEW_SEASON, sections.newSeason, (item, edge) => ({
      type: "newSeasonRow",
      key: `${NEW_SEASON}-${item.id}`,
      sectionKey: NEW_SEASON,
      item,
      edge,
    }));
  }

  if (sections.ready.length > 0) {
    out.push({ type: "readyHeader", key: `${READY}-header`, sectionKey: READY });
    pushSection(READY, sections.ready, (item, edge) => ({
      type: "readyRow",
      key: `${READY}-${item.id}`,
      sectionKey: READY,
      item,
      edge,
    }));
  }

  for (const group of sections.upcoming) {
    const sectionKey = `upcoming-${group.header}`;
    out.push({
      type: "upcomingHeader",
      key: `${sectionKey}-header`,
      sectionKey,
      header: group.header,
    });
    pushSection(sectionKey, group.items, (item, edge) => ({
      type: "upcomingRow",
      key: `${sectionKey}-${item.id}`,
      sectionKey,
      item,
      edge,
    }));
  }

  return out;
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
