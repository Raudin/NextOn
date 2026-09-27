import { useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";

import type { ConfirmDialogProps } from "./confirm-dialog.types";

/**
 * Confirmation dialog for iOS and web.
 *
 * This is the behaviour the screens already had, lifted out of the
 * `showConfirmDialog` helper that used to live in the profile screen: a native
 * `Alert` on iOS, `window.confirm` on web. Android draws the same dialog with
 * Jetpack Compose instead — see `ConfirmDialog.android.tsx`.
 *
 * The alert is raised from an effect rather than during render, because
 * `Alert.alert` is a side effect and a component's render has to stay pure.
 */
export default function ConfirmDialog({
  visible,
  requestId,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  infoOnly,
  onConfirm,
  onCancel,
  onDismiss,
}: ConfirmDialogProps) {
  /**
   * The request this component has already raised an alert for.
   *
   * `Alert.alert` is not declarative: without this, a re-render that produced
   * fresh callbacks would re-run the effect and stack a second alert on top of
   * the first.
   */
  const presentedRequestId = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      presentedRequestId.current = null;
      return;
    }
    if (presentedRequestId.current === requestId) return;
    presentedRequestId.current = requestId;

    if (Platform.OS === "web") {
      // Web has no equivalent of `Alert.alert`, and the one-button notice was
      // always a silent no-op there. Keep it that way rather than blocking the
      // page with something the user cannot decline.
      if (infoOnly) return;
      if (window.confirm(`${title}\n\n${message}`)) onConfirm();
      else onCancel?.();
      return;
    }

    Alert.alert(
      title,
      message,
      infoOnly
        ? [{ text: confirmLabel, onPress: onConfirm }]
        : [
            { text: cancelLabel, style: "cancel", onPress: onCancel },
            {
              text: confirmLabel,
              style: destructive ? "destructive" : "default",
              onPress: onConfirm,
            },
          ],
      // `cancelable` also covers the mirrored tap-outside gesture on Android;
      // `onDismiss` fires when nothing was chosen.
      { cancelable: true, onDismiss },
    );
  }, [
    visible,
    requestId,
    title,
    message,
    confirmLabel,
    cancelLabel,
    destructive,
    infoOnly,
    onConfirm,
    onCancel,
    onDismiss,
  ]);

  return null;
}
