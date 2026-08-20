import React from "react";
import { Image } from "expo-image";
import { Text, YStack } from "tamagui";

import RatingBadge from "./RatingBadge";
import WatchlistButton from "./WatchlistButton";

import {
  imageUrl,
  mediaTitle,
  releaseYear,
  type TMDBMedia,
} from "@/lib/media-api";

interface MediaCardProps {
  item: TMDBMedia;
  wide?: boolean;
  added: boolean;
  onPress: () => void;
  onToggle: () => void;
}

export default function MediaCard({
  item,
  wide,
  added,
  onPress,
  onToggle,
}: MediaCardProps) {
  const width = wide ? 260 : 130;
  const height = wide ? 146 : 195;
  const artPath = wide ? item.backdrop_path || item.poster_path : item.poster_path;

  return (
    <YStack w={width} gap="$2" pressStyle={{ opacity: 0.85, scale: 0.98 }} onPress={onPress}>
      <YStack
        w={width}
        h={height}
        borderRadius="$4"
        overflow="hidden"
        bg="$backgroundElement"
        borderWidth={1}
        borderColor="$borderColor"
      >
        {artPath ? (
          <Image
            source={{ uri: imageUrl(artPath) }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={250}
          />
        ) : (
          <YStack f={1} ai="center" jc="center">
            <Text fos="$7">Film</Text>
          </YStack>
        )}

        <RatingBadge rating={item.vote_average} />
        <WatchlistButton added={added} onPress={onToggle} />
      </YStack>

      <Text fontFamily="$body" fos="$2" fow="700" color="$color" numberOfLines={1}>
        {mediaTitle(item)}
      </Text>
      {releaseYear(item) !== "" && (
        <Text color="$color" opacity={0.5} fos="$1" mt={-6}>
          {releaseYear(item)}
        </Text>
      )}
    </YStack>
  );
}
