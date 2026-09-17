import { ChevronLeft } from "lucide-react-native";
import { StyleSheet, TouchableOpacity } from "react-native";

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
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      style={styles.button}
    >
      <ChevronLeft size={size} color="#FFFFFF" strokeWidth={2.8} />
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
