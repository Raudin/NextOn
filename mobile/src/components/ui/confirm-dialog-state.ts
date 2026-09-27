import type {
  ConfirmDialogOptions,
  ResolvedConfirmDialogOptions,
} from "./confirm-dialog.types";

/**
 * Whether a screen's confirmation dialog is open, and what it asked.
 *
 * Pure on purpose. Compose's `AlertDialog` — unlike `Alert.alert` — has to be
 * rendered inside a mounted `Host` in the tree, so a dialog can no longer be
 * fired at the screen from inside an event handler. Keeping the open/close
 * rules and the label defaults here makes them testable without rendering
 * anything, which is the only part of a native dialog a unit test can honestly
 * cover.
 *
 * There is no queue: a screen shows at most one dialog, and opening a second
 * one replaces the first.
 */
export type ConfirmDialogState =
  | { visible: false }
  | {
      visible: true;
      /** See `ConfirmDialogProps.requestId`. */
      requestId: number;
      options: ResolvedConfirmDialogOptions;
    };

export const CLOSED_CONFIRM_DIALOG: ConfirmDialogState = { visible: false };

/** Label of the confirming action of a confirm / cancel pair. */
export const DEFAULT_CONFIRM_LABEL = "Confirm";
/** Label of the single action of an `infoOnly` acknowledgment. */
export const DEFAULT_INFO_LABEL = "OK";
export const DEFAULT_CANCEL_LABEL = "Cancel";

/**
 * Opens a dialog, filling in the labels the call sites leave out.
 *
 * `infoOnly` swaps the confirming label to `OK` because there is nothing to
 * confirm — the button only dismisses the notice.
 *
 * `requestId` is supplied by the caller so this stays a pure function; the hook
 * that owns the counter is the only place that can meaningfully hand one out.
 */
export function openConfirmDialog(
  options: ConfirmDialogOptions,
  requestId: number,
): ConfirmDialogState {
  const infoOnly = options.infoOnly ?? false;

  return {
    visible: true,
    requestId,
    options: {
      ...options,
      confirmLabel:
        options.confirmLabel ??
        (infoOnly ? DEFAULT_INFO_LABEL : DEFAULT_CONFIRM_LABEL),
      cancelLabel: options.cancelLabel ?? DEFAULT_CANCEL_LABEL,
      destructive: options.destructive ?? false,
      infoOnly,
    },
  };
}

export function closeConfirmDialog(): ConfirmDialogState {
  return CLOSED_CONFIRM_DIALOG;
}
