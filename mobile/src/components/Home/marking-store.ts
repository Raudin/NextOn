import { useSyncExternalStore } from "react";

/**
 * Which schedule row is currently being marked watched.
 *
 * This deliberately does *not* live in `useState` on the Home screen.
 *
 * The screen renders the schedule through one FlashList, and FlashList's cells
 * are memoised against the `renderItem` it is handed (`ViewHolder.js` compares
 * `prevProps.renderItem === nextProps.renderItem`). A `markingId` held in state
 * would therefore be captured by that function, and every tap would hand
 * FlashList a new `renderItem` — which is the signal for every cell in the
 * list to re-render, not just the one that gained a spinner.
 *
 * Moving the value into a store that the rows subscribe to individually takes
 * it out of `renderItem`'s closure entirely. `renderItem` then only changes
 * when the schedule data does, and marking an episode re-renders exactly the
 * two rows whose spinner state actually changed.
 *
 * React Compiler cannot do this on its own: it memoises against values captured
 * during render, and `markingId` is genuinely captured by anything that reads
 * it. The subscription is what keeps the value *out* of the captured set, so
 * `renderRow` is a function of the schedule alone and every row but the one
 * being marked can skip its re-render. That is why this is a module-scoped
 * store read through `useSyncExternalStore` rather than `useState`.
 *
 * The store owns the value but not its lifetime: nothing is reset here when the
 * screen unmounts, so the screen releases the slot in its cleanup.
 */

let markingId: number | null = null;

const listeners = new Set<() => void>();

/**
 * Stable across the module's lifetime, so it never invalidates
 * `useSyncExternalStore`'s subscription. `notify` always iterates a copy, so a
 * subscriber that unsubscribes mid-notification cannot corrupt the loop.
 */
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = () => {
  for (const listener of [...listeners]) {
    listener();
  }
};

/** The id being marked right now, or null. */
export const getMarkingId = (): number | null => markingId;

/**
 * Claims (or releases, with null) the marking slot.
 *
 * A no-op when the value is unchanged, so an idempotent call cannot wake every
 * subscriber for nothing.
 */
export const setMarkingId = (next: number | null): void => {
  if (markingId === next) return;
  markingId = next;
  notify();
};

/**
 * Whether `id` is the row currently being marked.
 *
 * `useSyncExternalStore` re-reads the snapshot on every notification but only
 * re-renders this component when the *returned boolean* changes, which is what
 * gives per-row granularity: marking row 3 notifies all 60 subscribers and
 * re-renders one of them.
 *
 * No `useCallback` on the snapshot: React Compiler memoises it on `id` already,
 * and this hook lives in its own module, so nothing here can make the compiler
 * bail out of the file the way `try`/`finally` does for the Home screen.
 */
export function useIsMarking(id: number): boolean {
  const getSnapshot = () => getMarkingId() === id;
  return useSyncExternalStore(subscribe, getSnapshot);
}
