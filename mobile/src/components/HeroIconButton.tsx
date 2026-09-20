import type { ReactNode } from "react";
import { StyleSheet, TouchableOpacity } from "react-native";

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
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.button}
    >
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20,20,24,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 6,
  },
});
