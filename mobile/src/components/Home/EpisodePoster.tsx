import React from "react";
import { Image } from "expo-image";
import { StyleSheet } from "react-native";
import { Text, YStack } from "tamagui";

import EpisodeCountBadge from "./EpisodeCountBadge";

import { imageCachePolicy, imageTransitionMs, imageUrl } from "@/lib/images";
import { episodeStackDepth, hasEpisodeBacklog } from "@/lib/schedule";

/**
 * Geometry of the poster stack.
 *
 * `SLIVER` is the visible height of each mirrored layer, `LAYER_STEP` the
 * vertical gap between them, `HORIZONTAL_STEP` how far each layer is inset from
 * the sides. `STACK_INSET` is the space they add up to, reserved above the
 * poster so every row keeps the same height whether or not it has a stack.
 */
const SLIVER = 5;
const LAYER_STEP = 5;
const STACK_INSET = 12;
const HORIZONTAL_STEP = 5;

/** Corner radius matching Tamagui's `$2`, which the old poster well used. */
const DEFAULT_RADIUS = 5;

/** Colour behind the mirrored layers, so a partly transparent reflection still
 * reads as a solid band rather than showing the row through it. */
const GHOST_BACKGROUND = "#0B0B0D";

interface EpisodePosterProps {
  posterPath?: string | null;
  /**
   * Aired-but-unwatched episodes. Above one it adds the count badge and the
   * stacked layers behind the poster; at one or zero the poster stands alone.
   */
  episodesRemaining?: number;
  width: number;
  height: number;
  radius?: number;
  /** Poster well colour, drawn behind the artwork and behind the placeholder. */
  wellBackground?: string;
  /** Ring colour of the count badge; should match the surface it sits on. */
  badgeRingColor?: string;
}

/**
 * A schedule row's poster, optionally with the backlog treatment.
 *
 * When more than one episode has aired since the viewer last watched, the
 * poster sits in front of two mirrored copies of its own top edge — a stack
 * that reads as "there is more behind this" — and carries a count badge.
 *
 * The layers reuse the poster's own `posterCell` URL, so expo-image serves them
 * from the entry the main poster just populated: the effect costs no extra
 * downloads, only extra draws of a 60x90pt cell.
 *
 * The wrapper reserves `STACK_INSET` above the poster on every row, stacked or
 * not, so rows stay a uniform height and the text column stays put as a backlog
 * appears and clears.
 */
export default function EpisodePoster({
  posterPath,
  episodesRemaining = 0,
  width,
  height,
  radius = DEFAULT_RADIUS,
  wellBackground = "$backgroundElement",
  badgeRingColor = "$background",
}: EpisodePosterProps) {
  const posterUrl = posterPath ? imageUrl(posterPath, "posterCell") : null;
  const stackDepth = episodeStackDepth(episodesRemaining);
  const showBadge = hasEpisodeBacklog(episodesRemaining);

  return (
    <YStack w={width} h={height + STACK_INSET} position="relative">
      {/* Farthest layer first, so each nearer one covers it by `LAYER_STEP`. */}
      {Array.from({ length: stackDepth }, (_, index) => index + 1).map((layer) => {
        const inset = HORIZONTAL_STEP * layer;

        return (
          <YStack
            key={`poster-layer-${layer}`}
            position="absolute"
            top={STACK_INSET - SLIVER - LAYER_STEP * (layer - 1)}
            left={inset}
            w={width - inset * 2}
            h={SLIVER}
            borderTopLeftRadius={radius}
            borderTopRightRadius={radius}
            overflow="hidden"
            bg={GHOST_BACKGROUND}
          >
            {posterUrl ? (
              <Image
                source={{ uri: posterUrl }}
                // Drawn at the poster's own size and shifted left by the inset,
                // so the strip is the poster's own artwork rather than a
                // re-cropped copy of it: `cover` would otherwise zoom the
                // narrower box and the reflection would not line up.
                // Pushed down by its own height so the band left inside the
                // sliver is the artwork's top edge, then flipped by the static
                // style: the visible strip is that edge mirrored.
                style={[
                  styles.ghostImage,
                  { width, height, left: -inset, top: SLIVER - height },
                ]}
                contentFit="cover"
                cachePolicy={imageCachePolicy("posterCell")}
                transition={0}
                recyclingKey={posterPath}
              />
            ) : null}
          </YStack>
        );
      })}

      <YStack
        position="absolute"
        top={STACK_INSET}
        left={0}
        w={width}
        h={height}
        borderRadius={radius}
        overflow="hidden"
        bg={wellBackground}
      >
        {posterUrl ? (
          <Image
            source={{ uri: posterUrl }}
            style={styles.posterImage}
            contentFit="cover"
            cachePolicy={imageCachePolicy("posterCell")}
            transition={imageTransitionMs("posterCell")}
            recyclingKey={posterPath}
          />
        ) : (
          <YStack f={1} ai="center" jc="center">
            <Text color="$color" opacity={0.45} fos="$1" ta="center">
              No art
            </Text>
          </YStack>
        )}
      </YStack>

      {showBadge ? (
        <YStack
          position="absolute"
          // Sits astride the poster's top-right corner: just above the artwork,
          // overhanging the right edge by a few points.
          top={STACK_INSET - 10}
          right={-6}
        >
          <EpisodeCountBadge
            count={episodesRemaining}
            ringColor={badgeRingColor}
          />
        </YStack>
      ) : null}
    </YStack>
  );
}

const styles = StyleSheet.create({
  posterImage: {
    width: "100%",
    height: "100%",
  },
  ghostImage: {
    position: "absolute",
    opacity: 0.55,
    transform: [{ scaleY: -1 }],
  },
});
