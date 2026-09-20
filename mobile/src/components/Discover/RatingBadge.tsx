import React from "react";
import { Text, XStack } from "tamagui";
import type { TMDBMedia } from "@/lib/media-api";
import RatingLogo from "./RatingLogo";

interface RatingBadgeProps {
  item: TMDBMedia;
}

export default function RatingBadge({ item }: RatingBadgeProps) {
  if (
    item.imdb_rating == null &&
    item.metascore == null &&
    item.rotten_tomatoes == null
  ) {
    return null;
  }

  return (
    <XStack
      pos="absolute"
      top={6}
      right={1}
      bg="rgba(0,0,0,0.72)"
      px={2}
      py={2}
      borderRadius="$2"
      ai="center"
      gap="$1"
    >
      {item.imdb_rating != null && (
        <XStack ai="center" gap="$1">
          <RatingLogo type="imdb" size={15} />
          <Text color="white" fos="$1" fow="bold">
            {item.imdb_rating.toFixed(1)}
          </Text>
        </XStack>
      )}
      {item.metascore != null && (
        <XStack ai="center" gap="$1">
          <RatingLogo type="metascore" size={15} />
          <Text color="white" fos="$1" fow="bold">
            {item.metascore}
          </Text>
        </XStack>
      )}
      {item.rotten_tomatoes != null && (
        <XStack ai="center" gap="$1">
          <RatingLogo type="rotten-tomatoes" size={15} />
          <Text color="white" fos="$1" fow="bold">
            {item.rotten_tomatoes}%
          </Text>
        </XStack>
      )}
    </XStack>
  );
}
