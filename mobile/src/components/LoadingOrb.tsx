import { useIsFocused } from "expo-router";
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
 * Four things live here so no screen has to remember them:
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
 *  - **Focus.** The orb also stops when its screen is not the focused one.
 *    `ThinkingOrb` already idles itself when the *app* is backgrounded, but
 *    that is the wrong signal here: the tab navigator mounts every tab at
 *    launch, so an orb on a tab the user has never opened would otherwise
 *    animate from startup until the app is put away. Screen focus is the
 *    signal that matches "is this orb actually on screen".
 *  - **Layout.** `f={1}` centres it, so the parent must be the flex container
 *    holding the screen body; every caller wraps it in one.
 */
export default function LoadingOrb({
  label,
  state = "searching",
  size = 64,
}: LoadingOrbProps) {
  const isLight = useThemeName() === "light";
  const isFocused = useIsFocused();

  return (
    <YStack f={1} ai="center" jc="center" gap="$3">
      <ThinkingOrb
        state={state}
        size={size}
        theme={isLight ? "light" : "dark"}
        // Idles off-screen. The port still records one frame while paused, so
        // a tab that becomes focused has a correct orb immediately rather than
        // an empty canvas.
        paused={!isFocused}
      />
      {label ? (
        <Text color="$color" opacity={0.55}>
          {label}
        </Text>
      ) : null}
    </YStack>
  );
}
