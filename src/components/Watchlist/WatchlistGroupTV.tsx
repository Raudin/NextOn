import React from "react";
import { Text, XStack, YStack } from "tamagui";

import EmptyState from "../EmptyState";
import NextEpisodeCard from "./NextEpisodeCard";

import { type TMDBMedia } from "@/lib/media-api";

interface WatchlistGroupTVProps {
  title: string;
  items: TMDBMedia[];
  onFullyWatched: (id: number) => void;
}

export default function WatchlistGroupTV({
  title,
  items,
  onFullyWatched,
}: WatchlistGroupTVProps) {
  return (
    <YStack gap="$3">
      <XStack ai="center" jc="space-between">
        <Text color="$color" fow="800" fos="$6">
          {title}
        </Text>
        <Text color="$color" opacity={0.45} fos="$1">
          {items.length} items
        </Text>
      </XStack>

      {items.length === 0 ? (
        <EmptyState text={`No ${title.toLowerCase()} saved yet`} />
      ) : (
        <YStack gap="$3">
          {items.map((item) => (
            <NextEpisodeCard
              key={`${item.media_type || "tv"}-${item.id}`}
              show={item}
              onFullyWatched={onFullyWatched}
            />
          ))}
        </YStack>
      )}
    </YStack>
  );
}
