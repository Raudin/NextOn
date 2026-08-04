import React from "react";
import { Image } from "expo-image";
import { Text, XStack, YStack } from "tamagui";

import RatingPill from "./RatingPill";
import WatchlistButton from "./WatchlistButton";

import {
  imageUrl,
  mediaTitle,
  releaseYear,
  type TMDBMedia,
} from "@/lib/media-api";

interface SearchRowProps {
  item: TMDBMedia;
  added: boolean;
  onPress: () => void;
  onToggle: () => void;
}

export default function SearchRow({
  item,
  added,
  onPress,
  onToggle,
}: SearchRowProps) {
  return (
    <XStack
      gap="$3"
      p="$2"
      borderRadius="$4"
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
      pressStyle={{ opacity: 0.88 }}
      onPress={onPress}
    >
      <YStack w={76} h={112} borderRadius="$3" overflow="hidden" bg="$background">
        {item.poster_path ? (
          <Image
            source={{ uri: imageUrl(item.poster_path) }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        ) : (
          <YStack f={1} ai="center" jc="center">
            <Text fos="$2">No art</Text>
          </YStack>
        )}
      </YStack>
      <YStack f={1} jc="space-between" py="$1">
        <YStack gap="$1">
          <Text color="$color" fow="800" fos="$4" numberOfLines={2}>
            {mediaTitle(item)}
          </Text>
          <Text color="$color" opacity={0.5} fos="$2" tt="uppercase">
            {item.media_type || "media"} {releaseYear(item)}
          </Text>
        </YStack>
        <XStack ai="center" jc="space-between">
          <RatingPill rating={item.vote_average} />
          <WatchlistButton added={added} onPress={onToggle} />
        </XStack>
      </YStack>
    </XStack>
  );
}
