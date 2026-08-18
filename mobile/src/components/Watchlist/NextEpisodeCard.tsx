import React, { useCallback, useState, useEffect } from "react";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { Animated } from "react-native";
import { Button, Spinner, Text, XStack, YStack } from "tamagui";

import {
  BACKDROP_IMAGE_BASE_URL,
  fetchMediaDetails,
  fetchSeasonEpisodes,
  fetchWatchedStatus,
  imageUrl,
  markWatched,
  mediaTitle,
  type Episode,
  type MediaDetails,
  type TMDBMedia,
} from "@/lib/media-api";

interface NextEpisodeCardProps {
  show: TMDBMedia;
  onFullyWatched: (id: number) => void;
}

export default function NextEpisodeCard({
  show,
  onFullyWatched,
}: NextEpisodeCardProps) {
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

    // Fade out / scale down slightly before the transition
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
        const specialSeasons = (activeDetails.seasons || [])
          .filter((s) => s.season_number === 0);

        const allSeasons = [...regularSeasons, ...specialSeasons];

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
          // Fade back in with the new episode details
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
        // Reset animation on error
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
        h={136}
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
        h={136}
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

  const handleShowPress = (event: any) => {
    event.stopPropagation();
    router.push({
      pathname: "/media/[type]/[id]",
      params: { type: "tv", id: String(show.id) },
    } as any);
  };

  const seasonStr = String(episode.season_number).padStart(2, "0");
  const episodeStr = String(episode.episode_number).padStart(2, "0");

  const imageSource = episode.still_path
    ? imageUrl(episode.still_path)
    : showDetails?.backdrop_path
      ? imageUrl(showDetails.backdrop_path, BACKDROP_IMAGE_BASE_URL)
      : show.poster_path
        ? imageUrl(show.poster_path)
        : null;

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
      <XStack
        gap="$3"
        p="$2"
        borderRadius="$4"
        bg="$backgroundElement"
        borderWidth={1}
        borderColor="$borderColor"
        pressStyle={{ opacity: 0.88 }}
        onPress={handleCardPress}
        ai="center"
      >
        <YStack
          w={96}
          h={64}
          borderRadius="$3"
          overflow="hidden"
          bg="$background"
        >
          {imageSource ? (
            <Image
              source={{ uri: imageSource }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : (
            <YStack f={1} ai="center" jc="center">
              <Text color="$color" opacity={0.45} fos="$1">
                No art
              </Text>
            </YStack>
          )}
        </YStack>

        <YStack f={1} jc="center" gap="$1" py="$1">
          <Text
            color="$color"
            fow="900"
            fos="$3"
            pressStyle={{ opacity: 0.7 }}
            onPress={handleShowPress}
            numberOfLines={1}
          >
            {mediaTitle(show)}
          </Text>
          <Text color="$color" opacity={0.8} fow="700" fos="$2" numberOfLines={1}>
            S{seasonStr} E{episodeStr} • {episode.name}
          </Text>
          <XStack mt="$1" ai="center" jc="space-between" flexWrap="wrap" gap="$2">
            {episode.air_date ? (
              <Text color="$color" opacity={0.45} fos="$1" numberOfLines={1}>
                {episode.air_date}
              </Text>
            ) : (
              <YStack />
            )}
            <Button
              size="$2"
              theme="purple"
              borderRadius="$3"
              disabled={marking}
              onPress={(event: any) => {
                event.stopPropagation();
                animateAndMarkWatched();
              }}
            >
              {marking ? <Spinner size="small" /> : "✓ Mark Watched"}
            </Button>
          </XStack>
        </YStack>
      </XStack>
    </Animated.View>
  );
}
