/**
 * Shared contract for the confirmation dialogs.
 *
 * `ConfirmDialog.tsx` renders the alert iOS and web have always shown;
 * `ConfirmDialog.android.tsx` renders the same dialog with Jetpack Compose
 * through `@expo/ui`. Both are typed against this file, so the Android variant
 * cannot quietly drift from the contract the call sites use — TypeScript
 * resolves this non-platform file for types even though Metro picks the
 * platform variant at runtime.
 */

/** What a call site hands to `confirm(...)`. */
export interface ConfirmDialogOptions {
  /** Dialog title. */
  title: string;
  /** Body copy. */
  message: string;
  /** Confirming action's label. Defaults to `Confirm`, or `OK` when `infoOnly`. */
  confirmLabel?: string;
  /** Declining action's label. Defaults to `Cancel`. Ignored when `infoOnly`. */
  cancelLabel?: string;
  /** Draws the confirming action in the destructive red. */
  destructive?: boolean;
  /**
   * Acknowledgment only: a single button and no way to decline. This replaces
   * the one-argument `Alert.alert(title, message)` notices.
   */
  infoOnly?: boolean;
  /** Runs when the user confirms. */
  onConfirm: () => void;
  /**
   * Runs when the user declines explicitly ("Cancel" / "No").
   *
   * Deliberately separate from `onDismiss`: the media screen's "No" falls back
   * to marking a single episode, which must not happen when the dialog is waved
   * away by an accidental tap outside it.
   */
  onCancel?: () => void;
}

/** `ConfirmDialogOptions` with every default filled in by the state helper. */
export type ResolvedConfirmDialogOptions = Required<
  Omit<ConfirmDialogOptions, "onCancel">
> & {
  onCancel?: () => void;
};

/** Props for `<ConfirmDialog>`. */
export interface ConfirmDialogProps extends ResolvedConfirmDialogOptions {
  visible: boolean;
  /**
   * Identifies this opening of the dialog.
   *
   * The iOS and web variants raise a native alert from an effect, and an effect
   * keyed on callback identity can run twice — `useMemo` is a performance
   * optimisation, not a guarantee. The id is what those variants actually
   * compare against, so one request can only ever raise one alert.
   */
  requestId: number;
  /**
   * Runs for every dismissal that is neither a confirm nor an explicit cancel:
   * tapping outside, or the Android back gesture.
   */
  onDismiss: () => void;
}
