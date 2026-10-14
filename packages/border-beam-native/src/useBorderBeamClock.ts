import { useEffect } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

/**
 * The beam's animation clock, in milliseconds since the callback started.
 *
 * Skia's `useClock` is a thin wrapper over Reanimated's `useFrameCallback`, and
 * that callback runs a `requestAnimationFrame` loop for as long as it stays
 * registered — regardless of whether anything is painted. That rules it out for
 * `BorderBeam`'s always-mounted parent, which would tick on every tab whether
 * the beam was active or not. This hook lives in the beam children instead,
 * which only mount while the beam is actually drawn, and it takes the same
 * `isActive` parameter the timer should have had: pass `false` and the loop is
 * unregistered until it turns true.
 *
 * This mirrors `useTimestamp` in react-native-reanimated (its
 * `useFrameCallback(cb, isActive)` + `setActive(isActive)` effect), kept
 * explicit here so the reason the clock can be paused is documented at the
 * point of use rather than only in the port's history.
 *
 * Note `manageStateFrameCallback(id, false)` clears the callback's start time,
 * so a paused clock resumes at 0 rather than jumping forward by the time spent
 * paused. Every consumer drives its geometry from `clock / 1000` through a
 * periodic function (angle modulo 1, keyframe cycles), so the phase restarting
 * cannot show as a jump.
 */
export function useBorderBeamClock(isActive: boolean = true) {
  const clock = useSharedValue(0);
  const frameCallback = useFrameCallback(({ timeSinceFirstFrame }) => {
    'worklet';
    // Written straight into the shared value the uniforms read: no React
    // render happens per frame.
    clock.value = timeSinceFirstFrame;
  }, isActive);

  useEffect(() => {
    frameCallback.setActive(isActive);
  }, [isActive, frameCallback]);

  return clock;
}
