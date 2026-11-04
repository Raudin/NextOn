import React from "react";
import { StyleSheet, Dimensions } from "react-native";
import { YStack, XStack, Text } from "tamagui";
import { Image } from "expo-image";
import { imageUrl, imageCachePolicy } from "@/lib/images";
import { type ReplayHeroCard } from "@/lib/media-api";

interface ReplayCreditCardProps {
  card: ReplayHeroCard;
  holder: string;
  memberSince?: string;
}

const CARD_WIDTH = Math.min(300, Dimensions.get("window").width - 48);

export default function ReplayCreditCard({
  card,
  holder,
  memberSince = "2024",
}: ReplayCreditCardProps) {
  const artworkUri = card.artwork_url
    ? card.artwork_url.startsWith("http")
      ? card.artwork_url
      : imageUrl(card.artwork_url, "backdrop")
    : null;

  return (
    <YStack
      w={CARD_WIDTH}
      h={180}
      br="$4"
      overflow="hidden"
      borderWidth={1}
      borderColor="$borderColor"
      position="relative"
      bg="$backgroundElement"
      jc="space-between"
      p="$4"
      elevation={4}
      shadowColor="$shadowColor"
      shadowOffset={{ width: 0, height: 4 }}
      shadowOpacity={0.15}
      shadowRadius={8}
    >
      {artworkUri ? (
        <Image
          source={{ uri: artworkUri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          cachePolicy={imageCachePolicy("backdrop")}
        />
      ) : null}

      <YStack
        style={StyleSheet.absoluteFillObject}
        bg="rgba(18, 18, 24, 0.82)"
      />

      <XStack ai="center" jc="space-between">
        <Text color="rgba(255,255,255,0.7)" fos="$1" fow="800" letterSpacing={1.2}>
          {card.label}
        </Text>
        <Text color="rgba(255,255,255,0.4)" fos="$1" fow="700">
          NEXTON REPLAY
        </Text>
      </XStack>

      <YStack gap="$1">
        <Text
          color="#FFFFFF"
          fos="$7"
          fow="900"
          numberOfLines={1}
          style={styles.numericValue}
        >
          {card.value}
        </Text>
        <Text
          color="rgba(255,255,255,0.7)"
          fos="$2"
          fow="500"
          numberOfLines={1}
        >
          {card.detail}
        </Text>
      </YStack>

      <XStack ai="flex-end" jc="space-between">
        <YStack>
          <Text color="rgba(255,255,255,0.4)" fos="$1" fow="600" textTransform="uppercase">
            Cardholder
          </Text>
          <Text color="#FFFFFF" fos="$2" fow="700" textTransform="uppercase">
            {holder || "MEMBER"}
          </Text>
        </YStack>

        <YStack ai="flex-end">
          <Text color="rgba(255,255,255,0.4)" fos="$1" fow="600" textTransform="uppercase">
            Since
          </Text>
          <Text color="#FFFFFF" fos="$2" fow="700">
            {memberSince}
          </Text>
        </YStack>
      </XStack>
    </YStack>
  );
}

const styles = StyleSheet.create({
  numericValue: {
    fontVariant: ["tabular-nums"],
  },
});
