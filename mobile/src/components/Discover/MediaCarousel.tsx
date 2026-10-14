import { FlashList } from "@shopify/flash-list";
import React from "react";
import { StyleSheet } from "react-native";
import { Text, XStack, YStack } from "tamagui";

import EmptyState from "../EmptyState";
import MediaCard from "./MediaCard";

import { type TMDBMedia } from "@/lib/media-api";

interface MediaCarouselProps {
  title: string;
  items: TMDBMedia[];
  wide?: boolean;
  watchlistIds: Set<number>;
  onOpen: (item: TMDBMedia) => void;
  onToggle: (item: TMDBMedia) => void;
}

/**
 * A horizontally scrolling row of media cards.
 *
 * Uses FlashList rather than a horizontal `ScrollView`. The Discover browse
 * screen stacks three of these, and a plain `ScrollView` mounts and starts
 * downloading every card immediately: ~60 posters before the user has scrolled
 * anything. Recycling makes that proportional to what is actually on screen.
 *
 * Horizontal-inside-vertical is the supported nesting direction, so this sits
 * inside the screen's vertical scroll container without the same-orientation
 * caveat that applies to a vertical list nested in a vertical list.
 */
export default function MediaCarousel({
  title,
  items,
  wide,
  watchlistIds,
  onOpen,
  onToggle,
}: MediaCarouselProps) {
  return (
    <YStack gap="$3">
      <XStack ai="center" jc="space-between">
        <Text color="$color" fow="700" fos="$6">
          {title}
        </Text>
        <Text color="$color" opacity={0.4} fos="$1">
          {items.length} items
        </Text>
      </XStack>

      {items.length === 0 ? (
        <EmptyState text="Nothing to show yet" />
      ) : (
        <FlashList
          data={items}
          horizontal
          renderItem={({ item }) => (
            <MediaCard
              item={item}
              wide={wide}
              added={watchlistIds.has(item.id)}
              onPress={() => onOpen(item)}
              onToggle={() => onToggle(item)}
            />
          )}
          keyExtractor={(item) => `${title}-${item.id}`}
          /*
           * The watchlist ids are read by `renderItem` but are neither `data`
           * nor anything else FlashList can see, so they are declared here.
           *
           * They do currently reach the badges, by a route that is easy to
           * miss: `renderItem` is an inline arrow over `watchlistIds`, and the
           * two callbacks it closes over (`onOpen`, `onToggle` in
           * `app/(tabs)/discover.tsx`) are rebuilt on every render — so the
           * closure is fresh each time and cannot be stale. Declaring the set
           * makes the dependency explicit rather than an accident of two other
           * functions' identities. If either callback is ever memoised,
           * `renderItem` becomes stable, the stale closure becomes real, and
           * this prop is what already covers it.
           *
           * Note that this does *not* reduce re-renders: declaring the ids is
           * exactly what tells FlashList the cells have to be redrawn when they
           * change. It is a correctness guard, not a performance one.
           *
           * `MediaCard` itself is left unwrapped. React Compiler already
           * memoises its JSX against its props, so `React.memo` would add a
           * comparison on top of a comparison without changing what renders.
           */
          extraData={watchlistIds}
          ItemSeparatorComponent={CardGap}
          showsHorizontalScrollIndicator={false}
          // Cards have fixed widths (130 or 260), so a modest look-ahead is
          // enough to keep scrolling smooth without mounting the whole row.
          drawDistance={400}
          contentContainerStyle={styles.content}
        />
      )}
    </YStack>
  );
}

/** Horizontal gap between cards, replacing the old container `gap`. */
function CardGap() {
  return <XStack w={12} />;
}

const styles = StyleSheet.create({
  content: {
    // A little trailing space matches the visual rhythm of the last card
    // against the screen edge.
    paddingRight: 4,
  },
});
