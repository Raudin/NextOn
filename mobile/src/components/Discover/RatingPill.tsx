import React from "react";
import { Text, XStack } from "tamagui";
import type { TMDBMedia } from "@/lib/media-api";
import RatingLogo from "./RatingLogo";

interface RatingPillProps {
  item: TMDBMedia;
}

export default function RatingPill({ item }: RatingPillProps) {
  if (
    item.imdb_rating == null &&
    item.metascore == null &&
    item.rotten_tomatoes == null
  ) {
    return null;
  }

  return (
    <XStack
      bg="$background"
      px="$2"
      py="$1"
      borderRadius="$3"
      ai="center"
      gap="$2"
    >
      {item.imdb_rating != null && (
        <XStack ai="center" gap="$1">
          <RatingLogo type="imdb" size={15} />
          <Text color="$color" fos="$1" fow="800">
            {item.imdb_rating.toFixed(1)}
          </Text>
        </XStack>
      )}
      {item.metascore != null && (
        <XStack ai="center" gap="$1">
          <RatingLogo type="metascore" size={15} />
          <Text color="#4f9d45" fos="$1" fow="800">
            {item.metascore}
          </Text>
        </XStack>
      )}
      {item.rotten_tomatoes != null && (
        <XStack ai="center" gap="$1">
          <RatingLogo type="rotten-tomatoes" size={15} />
          <Text color="#d45b5b" fos="$1" fow="800">
            {item.rotten_tomatoes}%
          </Text>
        </XStack>
      )}
    </XStack>
  );
}
