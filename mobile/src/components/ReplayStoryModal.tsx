import React, { useState, useEffect } from "react";
import { Modal, Dimensions, TouchableOpacity, StyleSheet } from "react-native";
import { YStack, XStack, Text } from "tamagui";
import { Image } from "expo-image";
import X from "lucide-react-native/icons/x";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { imageUrl, imageCachePolicy } from "@/lib/images";
import { type ReplaySummary } from "@/lib/media-api";

interface ReplayStoryModalProps {
  visible: boolean;
  onClose: () => void;
  summary: ReplaySummary;
  userName: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function ReplayStoryModal({
  visible,
  onClose,
  summary,
  userName,
}: ReplayStoryModalProps) {
  const slides = [];

  const watchTimeCard = summary.cards.find((c) => c.id === "watch_time");
  slides.push({
    id: "intro",
    category: "YOUR REPLAY",
    title: "You spent",
    highlight: watchTimeCard?.value || "0h",
    subtitle: `watching movies and TV shows during ${summary.period_label}.`,
    artwork: watchTimeCard?.artwork_url,
  });

  if (summary.top_shows.length > 0) {
    const topShow = summary.top_shows[0];
    slides.push({
      id: "top_show",
      category: "TOP SERIES",
      title: "Your #1 Show was",
      highlight: topShow.title,
      subtitle: `${topShow.subtitle || `${topShow.count} episodes`} watched.`,
      artwork: topShow.artwork_url,
    });
  }

  if (summary.top_genres.length > 0) {
    const topGenre = summary.top_genres[0];
    slides.push({
      id: "top_genre",
      category: "FAVORITE GENRE",
      title: "You immersed in",
      highlight: topGenre.title,
      subtitle: `${topGenre.subtitle || `${topGenre.count} titles`} explored.`,
      artwork: summary.cards[0]?.artwork_url,
    });
  }

  if (summary.top_actors.length > 0) {
    const topActor = summary.top_actors[0];
    slides.push({
      id: "top_actor",
      category: "TOP ACTOR",
      title: "Starring on your screen",
      highlight: topActor.title,
      subtitle: `Appeared across ${topActor.count} titles you enjoyed.`,
      artwork: topActor.artwork_url,
    });
  }

  if (summary.top_networks.length > 0) {
    const topNetwork = summary.top_networks[0];
    slides.push({
      id: "top_network",
      category: "TOP NETWORK",
      title: "Streaming home",
      highlight: topNetwork.title,
      subtitle: `${topNetwork.subtitle || `${topNetwork.count} series`} watched.`,
      artwork: summary.cards[0]?.artwork_url,
    });
  }

  slides.push({
    id: "outro",
    category: `${userName.toUpperCase()}'S REPLAY`,
    title: "That's a wrap on",
    highlight: summary.period_label,
    subtitle: `Keep tracking and enjoying great cinema with Nexton.`,
    artwork: summary.cards[0]?.artwork_url,
  });

  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (visible) {
      setCurrentIndex(0);
    }
  }, [visible]);

  if (!visible) return null;

  const currentSlide = slides[currentIndex] || slides[0];

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <YStack f={1} bg="#0A0A0E">
        {currentSlide.artwork ? (
          <Image
            source={{
              uri: currentSlide.artwork.startsWith("http")
                ? currentSlide.artwork
                : imageUrl(currentSlide.artwork, "backdrop"),
            }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            cachePolicy={imageCachePolicy("backdrop")}
          />
        ) : null}

        <YStack
          style={StyleSheet.absoluteFillObject}
          bg="rgba(10, 10, 14, 0.85)"
        />

        <YStack pt="$6" px="$4" gap="$3">
          <XStack gap="$1" w="100%">
            {slides.map((_, i) => (
              <YStack
                key={i}
                f={1}
                h={3}
                br="$1"
                bg={i <= currentIndex ? "$white1" : "rgba(255, 255, 255, 0.25)"}
              />
            ))}
          </XStack>

          <XStack ai="center" jc="space-between">
            <Text color="$white1" opacity={0.7} fos="$2" fow="700" letterSpacing={1}>
              {currentSlide.category}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <YStack
                w={36}
                h={36}
                br="$10"
                bg="rgba(255, 255, 255, 0.15)"
                ai="center"
                jc="center"
              >
                <X color="#FFFFFF" size={18} />
              </YStack>
            </TouchableOpacity>
          </XStack>
        </YStack>

        <YStack f={1} jc="center" px="$6" gap="$4">
          <Text color="rgba(255,255,255,0.7)" fos="$5" fow="600">
            {currentSlide.title}
          </Text>

          <Text
            color="#FFFFFF"
            fos="$9"
            fow="900"
            lineHeight={44}
          >
            {currentSlide.highlight}
          </Text>

          <Text color="rgba(255,255,255,0.8)" fos="$4" fow="500">
            {currentSlide.subtitle}
          </Text>
        </YStack>

        <XStack position="absolute" top={100} bottom={100} left={0} right={0}>
          <TouchableOpacity
            style={{ width: SCREEN_WIDTH * 0.35, height: "100%" }}
            onPress={handlePrev}
            activeOpacity={1}
          />
          <TouchableOpacity
            style={{ width: SCREEN_WIDTH * 0.65, height: "100%" }}
            onPress={handleNext}
            activeOpacity={1}
          />
        </XStack>

        <XStack pb="$8" px="$6" ai="center" jc="space-between">
          <TouchableOpacity
            onPress={handlePrev}
            disabled={currentIndex === 0}
            style={{ opacity: currentIndex === 0 ? 0 : 0.8 }}
          >
            <XStack ai="center" gap="$1">
              <ChevronLeft color="#FFFFFF" size={20} />
              <Text color="#FFFFFF" fos="$3" fow="600">Back</Text>
            </XStack>
          </TouchableOpacity>

          <Text color="rgba(255, 255, 255, 0.5)" fos="$2" fow="600">
            {currentIndex + 1} of {slides.length}
          </Text>

          <TouchableOpacity onPress={handleNext}>
            <XStack ai="center" gap="$1">
              <Text color="#FFFFFF" fos="$3" fow="700">
                {currentIndex === slides.length - 1 ? "Done" : "Next"}
              </Text>
              <ChevronRight color="#FFFFFF" size={20} />
            </XStack>
          </TouchableOpacity>
        </XStack>
      </YStack>
    </Modal>
  );
}
