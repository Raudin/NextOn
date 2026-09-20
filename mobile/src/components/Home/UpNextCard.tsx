import React, { useCallback, useState, useEffect } from "react";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { Animated, StyleSheet } from "react-native";
import { Button, Spinner, Text, XStack, YStack } from "tamagui";

import { imageCachePolicy, imageTransitionMs, imageUrl } from "@/lib/images";
import {
  fetchMediaDetails,
  fetchSeasonEpisodes,
  fetchWatchedStatus,
  markWatched,
  mediaTitle,
  type Episode,
  type MediaDetails,
  type TMDBMedia,
} from "@/lib/media-api";

interface UpNextCardProps {
  show: TMDBMedia;
  onFullyWatched: (id: number) => void;
  onWatchedMarked: () => void;
}

export default function UpNextCard({
  show,
  onFullyWatched,
  onWatchedMarked,
}: UpNextCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [showDetails, setShowDetails] = useState<MediaDetails | null>(null);
  const [marking, setMarking] = useState(false);

  const [fadeAnim] = useState(() => new Animated.Value(1));
  const [scaleAnim] = useState(() => new Animated.Value(1));

  const loadNextEpisode = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [watchedStatus, detailsData] = await Promise.all([
        fetchWatchedStatus(show.id, "tv"),
        fetchMediaDetails("tv", show.id),
      ]);

      setShowDetails(detailsData);

      const watchedEpisodes = watchedStatus.episodes || [];
      const watchedCountBySeason: Record<number, number> = {};
      for (const ep of watchedEpisodes) {
        watchedCountBySeason[ep.season] = (watchedCountBySeason[ep.season] || 0) + 1;
      }

      const regularSeasons = (detailsData.seasons || [])
        .filter((s) => s.season_number >= 1)
        .sort((a, b) => a.season_number - b.season_number);

      const allSeasons = regularSeasons;

      let foundNext = false;
      for (const s of allSeasons) {
        const total = s.episode_count;
        const watchedCount = watchedCountBySeason[s.season_number] || 0;
        if (watchedCount < total) {
          const seasonData = await fetchSeasonEpisodes(show.id, s.season_number);
          const nextEp = seasonData.episodes.find(
            (ep) =>
              !watchedEpisodes.some(
                (we) => we.season === ep.season_number && we.episode === ep.episode_number
              )
          );
          if (nextEp) {
            setEpisode(nextEp);
            foundNext = true;
            break;
          }
        }
      }

      if (!foundNext) {
        onFullyWatched(show.id);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [show.id, onFullyWatched]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNextEpisode();
  }, [loadNextEpisode]);

  const animateAndMarkWatched = async () => {
    if (!episode || marking) return;
    setMarking(true);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(async () => {
      try {
        await markWatched({
          media_id: show.id,
          media_type: "tv",
          season_number: episode.season_number,
          episode_number: episode.episode_number,
        });

        // Notify parent immediately so XP/streak count refreshes
        onWatchedMarked();

        const watchedStatus = await fetchWatchedStatus(show.id, "tv");
        const activeDetails = showDetails || (await fetchMediaDetails("tv", show.id));

        const watchedEpisodes = watchedStatus.episodes || [];
        const watchedCountBySeason: Record<number, number> = {};
        for (const ep of watchedEpisodes) {
          watchedCountBySeason[ep.season] = (watchedCountBySeason[ep.season] || 0) + 1;
        }

        const regularSeasons = (activeDetails.seasons || [])
          .filter((s) => s.season_number >= 1)
          .sort((a, b) => a.season_number - b.season_number);

        const allSeasons = regularSeasons;

        let foundNext = false;
        for (const s of allSeasons) {
          const total = s.episode_count;
          const watchedCount = watchedCountBySeason[s.season_number] || 0;
          if (watchedCount < total) {
            const seasonData = await fetchSeasonEpisodes(show.id, s.season_number);
            const nextEp = seasonData.episodes.find(
              (ep) =>
                !watchedEpisodes.some(
                  (we) => we.season === ep.season_number && we.episode === ep.episode_number
                )
            );
            if (nextEp) {
              setEpisode(nextEp);
              foundNext = true;
              break;
            }
          }
        }

        if (!foundNext) {
          onFullyWatched(show.id);
        } else {
          Animated.parallel([
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
              toValue: 1,
              duration: 250,
              useNativeDriver: true,
            }),
          ]).start(() => {
            setMarking(false);
          });
        }
      } catch (err: any) {
        setError(err.message || String(err));
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setMarking(false);
        });
      }
    });
  };

  if (loading) {
    return (
      <YStack
        h={100}
        ai="center"
        jc="center"
        bg="$backgroundElement"
        borderRadius="$4"
        borderWidth={1}
        borderColor="$borderColor"
      >
        <Spinner size="small" color="$color" />
      </YStack>
    );
  }

  if (error) {
    return (
      <YStack
        h={100}
        p="$3"
        ai="center"
        jc="center"
        bg="$backgroundElement"
        borderRadius="$4"
        borderWidth={1}
        borderColor="$borderColor"
        gap="$2"
      >
        <Text color="$red10" fos="$2" ta="center" numberOfLines={2}>
          {error}
        </Text>
        <Button size="$2" onPress={loadNextEpisode}>
          Retry
        </Button>
      </YStack>
    );
  }

  if (!episode) return null;

  const handleCardPress = () => {
    router.push({
      pathname: "/media/[type]/[id]/episode/[season]/[episode]",
      params: {
        type: "tv",
        id: String(show.id),
        season: String(episode.season_number),
        episode: String(episode.episode_number),
      },
    } as any);
  };

  const seasonStr = String(episode.season_number).padStart(2, "0");
  const episodeStr = String(episode.episode_number).padStart(2, "0");

  const showPoster = show.poster_path ? imageUrl(show.poster_path, "posterCell") : null;

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
      <XStack
        gap="$3"
        p="$3"
        borderRadius="$4"
        bg="$backgroundElement"
        borderWidth={1}
        borderColor="$borderColor"
        pressStyle={{ opacity: 0.88 }}
        onPress={handleCardPress}
        ai="center"
        jc="space-between"
      >
        <XStack gap="$3" f={1} ai="center">
          <YStack
            w={48}
            h={72}
            borderRadius="$2"
            overflow="hidden"
            bg="$background"
          >
            {showPoster ? (
              <Image
                source={{ uri: showPoster }}
                style={styles.posterImage}
                contentFit="cover"
                cachePolicy={imageCachePolicy("posterCell")}
                transition={imageTransitionMs("posterCell")}
                recyclingKey={show.poster_path}
              />
            ) : (
              <YStack f={1} ai="center" jc="center">
                <Text color="$color" opacity={0.45} fos="$1" ta="center">
                  No art
                </Text>
              </YStack>
            )}
          </YStack>

          <YStack f={1} gap="$1" py="$1">
            <Text
              color="$color"
              fow="900"
              fos="$3"
              numberOfLines={1}
            >
              {mediaTitle(show)}
            </Text>
            <Text color="$color" opacity={0.6} fow="500" fos="$2" numberOfLines={2}>
              S{seasonStr}E{episodeStr} - {episode.name}
            </Text>
          </YStack>
        </XStack>

        <Button
          size="$4"
          bg="$green10"
          hoverStyle={{ bg: "$green11" }}
          pressStyle={{ bg: "$green9" }}
          circular
          disabled={marking}
          onPress={(event: any) => {
            event.stopPropagation();
            animateAndMarkWatched();
          }}
          style={styles.checkmarkButton}
        >
          {marking ? (
            <Spinner size="small" color="white" />
          ) : (
            <Text color="white" fow="bold" fos="$5">✓</Text>
          )}
        </Button>
      </XStack>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  posterImage: {
    width: "100%",
    height: "100%",
  },
  checkmarkButton: {
    width: 44,
    height: 44,
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
