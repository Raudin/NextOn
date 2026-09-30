import { Text, YStack } from "tamagui";

interface EpisodeCountBadgeProps {
  /** Episodes already aired and still unwatched. */
  count: number;
  /**
   * Colour of the hairline ring. It should match the surface the badge sits on
   * so the badge reads as punched out of the artwork rather than stuck on it.
   * Defaults to the app background, which is what the schedule rows use.
   */
  ringColor?: string;
  /** Diameter in px. */
  size?: number;
}

/**
 * The count badge on the top-right of a Home poster: how many episodes have
 * aired since the viewer last watched.
 *
 * Only ever rendered for a backlog (see `hasEpisodeBacklog`), so `count` is at
 * least 2. Kept deliberately plain — a filled circle and a number — because it
 * sits on top of artwork and has to stay readable at 20pt.
 */
export default function EpisodeCountBadge({
  count,
  ringColor = "$background",
  size = 22,
}: EpisodeCountBadgeProps) {
  return (
    <YStack
      w={size}
      h={size}
      borderRadius={size / 2}
      bg="$red9"
      borderWidth={2}
      borderColor={ringColor}
      ai="center"
      jc="center"
      // CSS box-shadow syntax replacing the legacy shadow* props plus Android
      // `elevation`, which had to be kept in step with them by hand.
      style={{ boxShadow: "0 2px 5px rgba(0, 0, 0, 0.35)" }}
      // The number alone is not a label: without this a screen reader announces
      // a bare digit next to the show's name.
      accessibilityLabel={`${count} episodes remaining`}
    >
      <Text
        color="white"
        fow="800"
        fos={size <= 20 ? 9 : 11}
        lineHeight={size - 4}
        numberOfLines={1}
      >
        {count}
      </Text>
    </YStack>
  );
}
