import { useEffect, useRef, useState } from "react";

interface DeferredLoadingOptions {
  /**
   * How long `loading` must stay true before the indicator appears — a debounce
   * on the rising edge. A load that resolves faster than this shows nothing at
   * all, which is the point: a cached payload would otherwise paint the
   * indicator for one or two frames and read as a glitch.
   *
   * @default 150
   */
  delayMs?: number;

  /**
   * How long the indicator is held once it has appeared — a floor, measured
   * from when it appeared rather than from when the load started. Without it a
   * load that finishes just after the indicator appears blinks it away.
   *
   * This is the knob that costs the user real time (the data is ready while the
   * gate is still up), so keep it modest for anything that covers content.
   *
   * @default 500
   */
  minVisibleMs?: number;
}

/**
 * Turns a `loading` flag into the flag the UI should actually render.
 *
 * Two symptoms, two mechanisms — they are not interchangeable:
 *
 *  - **Flash.** A fast load (cached payload) shows the indicator for a frame or
 *    two. `delayMs` debounces the rising edge: if the load is already finished
 *    when the delay elapses, nothing is ever shown.
 *  - **Blink.** An indicator that appears and immediately disappears. A
 *    debounce cannot fix this — it only moves the appearance later — so
 *    `minVisibleMs` holds it, making any appearance a deliberate beat instead
 *    of a flicker.
 *
 * While the delay is pending the caller should render *nothing*, not the
 * loading UI: a flash of a different component is worse than a brief hold on
 * the screen's own background.
 */
export function useDeferredLoading(
  loading: boolean,
  { delayMs = 150, minVisibleMs = 500 }: DeferredLoadingOptions = {}
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Invariant, relied on below: `shownAt === null` exactly when nothing has been
  // shown, so the falling edge never has to undo a render that never happened.
  //
  // Both state writes happen inside a timer rather than in the effect body:
  // setting state synchronously here would cascade a render on mount
  // (react-hooks/set-state-in-effect), the same reason the other hooks in this
  // directory defer their first load.
  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    if (loading) {
      // Debounced appearance, cancelled outright when the load finishes first.
      timer.current = setTimeout(() => {
        timer.current = null;
        shownAt.current = Date.now();
        setVisible(true);
      }, delayMs);

      return clearTimer;
    }

    if (shownAt.current === null) {
      return clearTimer;
    }

    // Falling edge: honour whatever is left of the minimum visible window. A
    // floor that has already elapsed still goes through a timer, for the same
    // reason as above.
    const shownFor = Date.now() - shownAt.current;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        shownAt.current = null;
        setVisible(false);
      },
      Math.max(0, minVisibleMs - shownFor)
    );

    return clearTimer;
  }, [loading, delayMs, minVisibleMs]);

  return visible;
}
