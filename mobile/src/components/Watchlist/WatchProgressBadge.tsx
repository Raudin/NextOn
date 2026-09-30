import { YStack } from "tamagui";

import ProgressRing from "./ProgressRing";
import { useProgressTheme } from "./useProgressTheme";

interface WatchProgressBadgeProps {
  progress: number;
}

/** Diameter of the badge, which is also the diameter of the ring inside it. */
const SIZE = 20;
const STROKE_WIDTH = 3;

/**
 * The ring drawn over a poster card's corner.
 *
 * The chrome — translucent surface, hairline border, drop shadow — is what
 * keeps the ring legible on top of artwork and is the same everywhere. The ring
 * itself is platform-specific in `ProgressRing`, which Android draws with
 * Jetpack Compose.
 */
export default function WatchProgressBadge({
  progress,
}: WatchProgressBadgeProps) {
  const { surface, borderTone } = useProgressTheme(progress);

  return (
    <YStack
      w={SIZE}
      h={SIZE}
      borderRadius={999}
      ai="center"
      jc="center"
      bg={surface}
      borderWidth={1}
      borderColor={borderTone}
      // CSS box-shadow syntax replacing the legacy shadow* props plus Android
      // `elevation`, which had to be kept in step with them by hand.
      style={{ boxShadow: "0 4px 8px rgba(0, 0, 0, 0.3)" }}
    >
      <ProgressRing progress={progress} size={SIZE} strokeWidth={STROKE_WIDTH} />
    </YStack>
  );
}

