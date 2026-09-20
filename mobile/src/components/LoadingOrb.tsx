import { Text, useThemeName, YStack } from "tamagui";
import { ThinkingOrb, type OrbSize, type OrbState } from "thinking-orbs-native";

interface LoadingOrbProps {
  /**
   * Caption under the orb. Omitted where the caller already renders its own
   * copy of the same words, so a screen never says it twice.
   */
  label?: string;
  /**
   * Which of the port's nine animations to show.
   *
   * `searching` is the default because it is what the media detail screen
   * ships; the orb is decorative here and the caption carries the meaning, so
   * picking a different state per screen would be noise rather than signal.
   *
   * @default "searching"
   */
  state?: OrbState;
  /** Tuned preset — 64 for a full screen, 20 for an inline slot. @default 64 */
  size?: OrbSize;
}

/**
 * The app's full-screen loading state: a ThinkingOrb plus an optional caption.
 *
 * Three things live here so no screen has to remember them:
 *
 *  - **Theme.** The port's `theme="auto"` follows the OS appearance only
 *    (`useColorScheme()`), while this app can pin either appearance from
 *    `AuthContext`. `useThemeName()` is that resolved answer, so the orb
 *    matches the rest of the screen.
 *  - **Lifetime.** Callers render this only inside a deferred-loading branch
 *    (see `useDeferredLoading`), so the orb exists exactly while a load is in
 *    flight. That matters because the port records a frame on the JS thread
 *    per orb per frame — the same reason this belongs in a single full-screen
 *    slot and never inside a list.
 *  - **Layout.** `f={1}` centres it, so the parent must be the flex container
 *    holding the screen body; every caller wraps it in one.
 */
export default function LoadingOrb({
  label,
  state = "searching",
  size = 64,
}: LoadingOrbProps) {
  const isLight = useThemeName() === "light";

  return (
    <YStack f={1} ai="center" jc="center" gap="$3">
      <ThinkingOrb
        state={state}
        size={size}
        theme={isLight ? "light" : "dark"}
      />
      {label ? (
        <Text color="$color" opacity={0.55}>
          {label}
        </Text>
      ) : null}
    </YStack>
  );
}
