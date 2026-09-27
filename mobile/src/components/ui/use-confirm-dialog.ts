import { useCallback, useMemo, useRef, useState } from "react";

import {
  closeConfirmDialog,
  openConfirmDialog,
  type ConfirmDialogState,
} from "./confirm-dialog-state";
import type {
  ConfirmDialogOptions,
  ConfirmDialogProps,
} from "./confirm-dialog.types";

/**
 * A single confirmation dialog for one screen.
 *
 * The opening call site stays imperative — `confirm({ ... })` from a handler,
 * exactly how these screens read before — while the rendering is declarative,
 * which is what Jetpack Compose requires of `AlertDialog`.
 */
export function useConfirmDialog(): {
  confirm: (options: ConfirmDialogOptions) => void;
  /**
   * Spread into `<ConfirmDialog>`, or `null` when nothing is open. Always guard
   * the render on it: a closed dialog has no presentation of its own.
   */
  dialogProps: ConfirmDialogProps | null;
} {
  const [state, setState] = useState<ConfirmDialogState>(closeConfirmDialog);
  /** Bumped per request, so each opening is distinguishable from the last. */
  const lastRequestId = useRef(0);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    lastRequestId.current += 1;
    setState(openConfirmDialog(options, lastRequestId.current));
  }, []);

  const dialogProps = useMemo<ConfirmDialogProps | null>(() => {
    if (!state.visible) return null;
    const { options, requestId } = state;

    return {
      ...options,
      visible: true,
      requestId,
      // Close before acting. The handler may sign the user out or navigate
      // away, and the dialog must not survive that.
      onConfirm: () => {
        setState(closeConfirmDialog());
        options.onConfirm();
      },
      onCancel: () => {
        setState(closeConfirmDialog());
        options.onCancel?.();
      },
      onDismiss: () => setState(closeConfirmDialog()),
    };
  }, [state]);

  return { confirm, dialogProps };
}

