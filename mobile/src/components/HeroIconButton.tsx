import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";

interface HeroIconButtonProps {
  /** Announced to screen readers: an icon alone is not self-describing. */
  accessibilityLabel: string;
  onPress: () => void;
  /** The icon element, already sized and coloured by the caller. */
  children: ReactNode;
}

/**
 * Circular, translucent control that sits on top of hero imagery.
 *
 * It deliberately mirrors the surface `BackButton` draws (translucent fill,
 * hairline light border, drop shadow) so the media-detail hero's back and
 * trailer controls look identical without that component having to change —
 * `BackButton` is shared with the episode screen and is left alone.
 */
export default function HeroIconButton({
  accessibilityLabel,
  onPress,
  children,
}: HeroIconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    // iOS-only smoothing; ignored elsewhere. Replaces the plain circular arc.
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20,20,24,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    // CSS box-shadow syntax replacing the legacy shadow* props plus Android
    // `elevation`, which had to be kept in step with them by hand.
    boxShadow: "0 3px 8px rgba(0, 0, 0, 0.45)",
  },
  /** Press feedback that replaces TouchableOpacity's `activeOpacity`. */
  pressed: {
    opacity: 0.75,
  },
});
