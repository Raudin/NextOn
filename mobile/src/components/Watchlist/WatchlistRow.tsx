import { Image } from "expo-image";
import { Text, XStack, YStack } from "tamagui";

import WatchProgressBar from "./WatchProgressBar";

import { imageCachePolicy, imageTransitionMs, imageUrl } from "@/lib/images";
import {
  mediaTitle,
  releaseYear,
  type TMDBMedia,
} from "@/lib/media-api";

interface WatchlistRowProps {
  item: TMDBMedia;
  subtitle?: string;
  progress?: number;
  selected?: boolean;
  selectionMode?: boolean;
  onOpen: () => void;
}

export default function WatchlistRow({
  item,
  subtitle,
  progress,
  selected,
  selectionMode,
  onOpen,
}: WatchlistRowProps) {
  return (
    <XStack
      gap="$3"
      p="$2.5"
      borderRadius="$5"
      bg="$backgroundElement"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.06)"
      pressStyle={{ opacity: 0.88 }}
      onPress={onOpen}
      ai="center"
    >
      <YStack
        w={78}
        h={116}
        borderRadius={16}
        overflow="hidden"
        bg="$background"
      >
        {item.poster_path ? (
          <Image
            // 78x116pt: the small role keeps this thumbnail at a fraction of
            // the bytes the old w500 request pulled down.
            source={{ uri: imageUrl(item.poster_path, "posterCell") }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            cachePolicy={imageCachePolicy("posterCell")}
            transition={imageTransitionMs("posterCell")}
            recyclingKey={item.poster_path}
          />
        ) : (
          <YStack f={1} ai="center" jc="center">
            <Text color="$color" opacity={0.45}>
              No art
            </Text>
          </YStack>
        )}
      </YStack>

      <YStack f={1} jc="space-between" py="$1">
        <YStack gap="$1">
          <Text color="$color" fow="800" fos="$4" numberOfLines={2}>
            {mediaTitle(item)}
          </Text>
          <Text color="$color" opacity={0.5} fos="$2">
            {subtitle || releaseYear(item) || "Saved to watchlist"}
          </Text>
        </YStack>

        <YStack gap="$2" mt="$2">
          {typeof progress === "number" ? (
            <WatchProgressBar progress={progress} />
          ) : null}

          <XStack ai="center" jc="space-between">
            <Text color="$color" opacity={0.42} fos="$2">
              {(item.media_type || "movie").toUpperCase()}
            </Text>
            <XStack ai="center" gap="$2">
              {selectionMode ? (
                <YStack
                  w={28}
                  h={28}
                  borderRadius={999}
                  ai="center"
                  jc="center"
                  bg={selected ? "$red9" : "transparent"}
                  borderWidth={1}
                  borderColor={selected ? "$red9" : "$borderColor"}
                >
                  <Text color="$color" fos="$2">
                    {selected ? "✓" : ""}
                  </Text>
                </YStack>
              ) : typeof progress !== "number" ? (
                <Text color="$color" opacity={0.65} fos="$2">
                  {item.imdb_rating != null ? `IMDb ${item.imdb_rating.toFixed(1)}` : ""}
                </Text>
              ) : null}
            </XStack>
          </XStack>
        </YStack>
      </YStack>
    </XStack>
  );
}
