import React from "react";
import { Image } from "expo-image";
import { Text, YStack } from "tamagui";

import WatchProgressBadge from "./WatchProgressBadge";

import { imageCachePolicy, imageTransitionMs, imageUrl } from "@/lib/images";
import { type TMDBMedia } from "@/lib/media-api";

interface WatchlistPosterCardProps {
  item: TMDBMedia;
  width: number;
  subtitle?: string;
  progress?: number;
  selected?: boolean;
  selectionMode?: boolean;
  onPress: () => void;
}

export default function WatchlistPosterCard({
  item,
  width,
  subtitle,
  progress,
  selected,
  selectionMode,
  onPress,
}: WatchlistPosterCardProps) {
  const title = item.title || item.name || "Untitled";

  return (
    <YStack
      w={width}
      gap="$2"
      pressStyle={{ opacity: 0.88 }}
      onPress={onPress}
    >
      <YStack
        h={width * 1.48}
        borderRadius={18}
        overflow="hidden"
        bg="$backgroundElement"
        position="relative"
      >
        {item.poster_path ? (
          <Image
            source={{ uri: imageUrl(item.poster_path, "posterCard") }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            cachePolicy={imageCachePolicy("posterCard")}
            transition={imageTransitionMs("posterCard")}
            recyclingKey={item.poster_path}
          />
        ) : (
          <YStack f={1} ai="center" jc="center" px="$3">
            <Text color="$color" opacity={0.5} ta="center">
              No poster
            </Text>
          </YStack>
        )}

        {typeof progress === "number" ? (
          <YStack position="absolute" right={8} bottom={8}>
            <WatchProgressBadge progress={progress} />
          </YStack>
        ) : null}

        {selectionMode ? (
          <YStack
            position="absolute"
            top={8}
            right={8}
            w={26}
            h={26}
            borderRadius={999}
            ai="center"
            jc="center"
            bg={selected ? "$red9" : "rgba(0,0,0,0.72)"}
            borderWidth={1}
            borderColor={selected ? "$red9" : "$borderColor"}
          >
            <Text color="$color" fos="$2" opacity={selected ? 1 : 0.75}>
              {selected ? "✓" : ""}
            </Text>
          </YStack>
        ) : null}
      </YStack>

      <YStack px="$1" gap={2}>
        <Text color="$color" fow="800" fos="$4" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text color="$color" opacity={0.55} fos="$2" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </YStack>
    </YStack>
  );
}
