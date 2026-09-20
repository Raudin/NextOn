import { useCallback, useEffect, useRef, useState } from "react";

/**
 * True for `idleMs` after the most recent keystroke.
 *
 * Written for `BorderBeam`'s `active` prop on a search field. The port fades in
 * over 0.6 s, and once inactive it fades out over 0.5 s and unmounts its Skia
 * canvas — so this window is what decides how long the effect costs anything at
 * all. A burst of typing keeps it lit; the window then expires on its own.
 *
 * `markTyping` restarts the window on every keystroke, so it is safe to call
 * unconditionally. `stopTyping` ends it immediately, for the cases where waiting
 * it out would look wrong (the field was cleared, the keyboard was dismissed),
 * and is also what a focus-based caller would use on blur.
 *
 * The timer lives in a ref and is cleared on unmount, so a screen that goes away
 * mid-burst leaves nothing behind.
 */
export function useTypingActivity(idleMs = 900) {
  const [typing, setTyping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const markTyping = useCallback(() => {
    setTyping(true);
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      setTyping(false);
    }, idleMs);
  }, [clearTimer, idleMs]);

  const stopTyping = useCallback(() => {
    clearTimer();
    setTyping(false);
  }, [clearTimer]);

  // The cleanup *is* clearTimer: no timeout outlives the screen that started it.
  useEffect(() => clearTimer, [clearTimer]);

  return { typing, markTyping, stopTyping };
}
