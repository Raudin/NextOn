import React from "react";
import type { GestureResponderEvent } from "react-native";
import { Pressable } from "react-native";

import MediaToggleBadge from "../MediaToggleBadge";

interface WatchlistButtonProps {
  added: boolean;
  onPress: () => void;
}

/**
 * Circular add/remove affordance overlaid on Discover artwork. Uses the same
 * MediaToggleBadge as the episode "seen" toggles so every mark action in the
 * app looks identical.
 */
export default function WatchlistButton({
  added,
  onPress,
}: WatchlistButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={added ? "Remove from watchlist" : "Add to watchlist"}
      hitSlop={8}
      onPress={(event: GestureResponderEvent) => {
        event?.stopPropagation?.();
        onPress();
      }}
      style={({ pressed }) => [
        { position: "absolute", right: 8, bottom: 8 },
        pressed && { opacity: 0.7, transform: [{ scale: 0.92 }] },
      ]}
    >
      <MediaToggleBadge state={added ? "active" : "idle"} onArtwork />
    </Pressable>
  );
}
