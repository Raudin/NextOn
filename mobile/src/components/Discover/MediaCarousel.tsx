import React from "react";
import { ScrollView, Text, XStack, YStack } from "tamagui";

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
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <XStack gap="$3">
            {items.map((item) => (
              <MediaCard
                key={`${title}-${item.id}`}
                item={item}
                wide={wide}
                added={watchlistIds.has(item.id)}
                onPress={() => onOpen(item)}
                onToggle={() => onToggle(item)}
              />
            ))}
          </XStack>
        </ScrollView>
      )}
    </YStack>
  );
}
