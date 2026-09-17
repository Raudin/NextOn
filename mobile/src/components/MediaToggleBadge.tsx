import { Check, Lock, Plus } from "lucide-react-native";
import React from "react";
import { StyleSheet, View } from "react-native";

/**
 * Shared circular state toggle used everywhere a piece of media can be marked
 * (episode "seen" rows, Discover carousels, search results).
 *
 * Keeping it in one place means the affordance always matches: a soft
 * translucent circle with a white icon, flipping to solid green with a check
 * once the item is marked.
 */
export type MediaToggleState = "idle" | "active" | "locked";

interface MediaToggleBadgeProps {
  state: MediaToggleState;
  /** Diameter in px. Icons scale with it. */
  size?: number;
  /**
   * Use the darker surface variant for badges sitting on top of artwork
   * (posters/backdrops), where a translucent *white* surface disappears.
   */
  onArtwork?: boolean;
}

const BASE_SIZE = 26;

export default function MediaToggleBadge({
  state,
  size = BASE_SIZE,
  onArtwork = false,
}: MediaToggleBadgeProps) {
  const scale = size / BASE_SIZE;

  const surface =
    state === "active"
      ? styles.active
      : onArtwork || state === "locked"
        ? styles.darkSurface
        : styles.idle;

  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2 },
        surface,
        onArtwork && styles.artworkShadow,
      ]}
    >
      {state === "active" ? (
        <Check
          size={Math.round(16 * scale)}
          color="#FFFFFF"
          strokeWidth={3.4}
        />
      ) : state === "locked" ? (
        <Lock
          size={Math.round(13 * scale)}
          color="rgba(255,255,255,0.7)"
          strokeWidth={2.6}
        />
      ) : (
        <Plus
          size={Math.round(15 * scale)}
          color="#FFFFFF"
          strokeWidth={2.8}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
  },
  idle: {
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  darkSurface: {
    backgroundColor: "rgba(15,16,20,0.62)",
  },
  active: {
    backgroundColor: "#22A559",
  },
  artworkShadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
});
