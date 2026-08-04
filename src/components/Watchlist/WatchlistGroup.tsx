import React from "react";
import { Text, XStack, YStack } from "tamagui";

import EmptyState from "../EmptyState";
import WatchlistRow from "./WatchlistRow";

import { type TMDBMedia } from "@/lib/media-api";

interface WatchlistGroupProps {
  title: string;
  items: TMDBMedia[];
  onOpen: (item: TMDBMedia) => void;
  onRemove: (id: number) => void;
}

export default function WatchlistGroup({
  title,
  items,
  onOpen,
  onRemove,
}: WatchlistGroupProps) {
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
            <WatchlistRow
              key={`${item.media_type}-${item.id}`}
              item={item}
              onOpen={() => onOpen(item)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </YStack>
      )}
    </YStack>
  );
}
