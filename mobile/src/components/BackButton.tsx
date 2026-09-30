import { ChevronLeft } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";

interface BackButtonProps {
  onPress: () => void;
  /** Icon size in dp. */
  size?: number;
}

/**
 * Circular, translucent back affordance that sits on top of hero imagery.
 * Matches the visual language of the hero action buttons (translucent surface,
 * hairline light border, drop shadow) so it stays legible on any backdrop.
 */
export default function BackButton({ onPress, size = 20 }: BackButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <ChevronLeft size={size} color="#FFFFFF" strokeWidth={2.8} />
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
