import React from "react";
import { Image } from "expo-image";
import { Text, YStack } from "tamagui";

import RatingBadge from "./RatingBadge";
import WatchlistButton from "./WatchlistButton";

import { imageCachePolicy, imageTransitionMs, imageUrl } from "@/lib/images";
import { mediaTitle, releaseYear, type TMDBMedia } from "@/lib/media-api";

/** Poster artwork ratio shared with the watchlist grid cards. */
const POSTER_RATIO = 1.48;

interface MediaCardProps {
  item: TMDBMedia;
  wide?: boolean;
  /**
   * Explicit width, in px. Passing it switches the card to the grid variant:
   * a poster card sized/shaped exactly like the watchlist cards, used by the
   * search results grid.
   */
  width?: number;
  /** Optional footer line; falls back to the release year. */
  subtitle?: string;
  added: boolean;
  onPress: () => void;
  onToggle: () => void;
}

export default function MediaCard({
  item,
  wide,
  width,
  subtitle,
  added,
  onPress,
  onToggle,
}: MediaCardProps) {
  const grid = width != null;
  const cardWidth = width ?? (wide ? 260 : 130);
  const cardHeight = grid
    ? Math.round(cardWidth * POSTER_RATIO)
    : wide
      ? 146
      : 195;
  // Carousel cards use the backdrop for the wide preset; grid cards are always
  // posters, matching the watchlist.
  const artPath =
    wide && !grid ? item.backdrop_path || item.poster_path : item.poster_path;
  const year = releaseYear(item);
  const meta = subtitle ?? year;
  // The wide carousel card draws a backdrop at 260x146pt; everything else is a
  // poster, and the grid/compact cards are small enough for the lower bucket.
  const imageRole = wide && !grid ? "backdrop" : "posterCard";

  return (
    <YStack
      w={cardWidth}
      gap="$2"
      pressStyle={{ opacity: 0.85, scale: 0.98 }}
      onPress={onPress}
    >
      <YStack
        w={cardWidth}
        h={cardHeight}
        borderRadius={grid ? 18 : "$4"}
        borderCurve="continuous"
        overflow="hidden"
        bg="$backgroundElement"
        borderWidth={1}
        borderColor="$borderColor"
      >
        {artPath ? (
          <Image
            source={{ uri: imageUrl(artPath, imageRole) }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            cachePolicy={imageCachePolicy(imageRole)}
            transition={imageTransitionMs(imageRole)}
            recyclingKey={artPath}
          />
        ) : (
          <YStack f={1} ai="center" jc="center">
            <Text fos="$7">Film</Text>
          </YStack>
        )}

      <RatingBadge item={item} />
        <WatchlistButton added={added} onPress={onToggle} />
      </YStack>

      {/*
        Footer spacing comes from `gap` alone — the meta line is never pulled up
        over the title with a negative margin. A compact card's `$2` title sits
        in a 21pt line box for a 12pt face, so only ~3.5pt of that box is
        leading below the descenders; the old `mt={-6}` spent that leading and
        then some, leaving the year's ascenders inside the title's ink. That
        read as a tight two-line footer on a device rendering the intended face
        and as a collision on any device whose font metrics or system font size
        differ — which is every device that falls back to the system font,
        since the body font is not bundled.
      */}
      <YStack px={grid ? "$1" : 0} gap={grid ? 2 : 0}>
        <Text
          fontFamily="$body"
          fos={grid ? "$4" : "$2"}
          fow={grid ? "800" : "700"}
          color="$color"
          numberOfLines={grid ? 2 : 1}
        >
          {mediaTitle(item)}
        </Text>
        {meta !== "" && (
          <Text
            color="$color"
            opacity={grid ? 0.55 : 0.5}
            fos={grid ? "$2" : "$1"}
            numberOfLines={1}
          >
            {meta}
          </Text>
        )}
      </YStack>
    </YStack>
  );
}
