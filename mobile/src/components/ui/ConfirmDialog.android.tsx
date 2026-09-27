import { AlertDialog, Host, Text, TextButton } from "@expo/ui/jetpack-compose";
import { StyleSheet } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/hooks/use-theme";

import type { ConfirmDialogProps } from "./confirm-dialog.types";

/** The destructive red the settings list already uses for the same actions. */
const DESTRUCTIVE = "#FF3B30";

/**
 * Confirmation dialog for Android, drawn with the Material 3 `AlertDialog` from
 * `@expo/ui` — the same slot structure as Jetpack Compose's own component.
 *
 * Two consequences of using the native component are worth stating:
 *
 * - The slot children have to be Compose components (`Text`, `TextButton`),
 *   not React Native ones. Crossing back into React Native inside the dialog
 *   would give up the point of using it.
 * - Compose renders the dialog into its own window, so the `Host` that owns the
 *   composition is parked out of the layout rather than sized. It still has to
 *   be mounted for the dialog to exist, which is why the screens render this
 *   component next to their content instead of calling an imperative helper.
 */
export default function ConfirmDialog({
  visible,
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
  const theme = useTheme();
  const { themeMode } = useAuth();

  if (!visible) return null;

  return (
    <Host
      style={styles.host}
      // The host is invisible, but never interactive: taps belong to the screen
      // behind it.
      pointerEvents="none"
      colorScheme={themeMode === "system" ? undefined : themeMode}
    >
      <AlertDialog
        // Tapping outside, or the back gesture, dismisses without declining.
        // "Cancel" and "No" stay deliberate choices.
        onDismissRequest={onDismiss}
        colors={{
          containerColor: theme.backgroundElement,
          titleContentColor: theme.text,
          textContentColor: theme.textSecondary,
        }}
      >
        <AlertDialog.Title>
          <Text>{title}</Text>
        </AlertDialog.Title>
        <AlertDialog.Text>
          <Text>{message}</Text>
        </AlertDialog.Text>

        {infoOnly || !onCancel ? null : (
          <AlertDialog.DismissButton>
            <TextButton onClick={onCancel}>
              <Text>{cancelLabel}</Text>
            </TextButton>
          </AlertDialog.DismissButton>
        )}

        <AlertDialog.ConfirmButton>
          <TextButton
            onClick={onConfirm}
            colors={destructive ? { contentColor: DESTRUCTIVE } : undefined}
          >
            <Text>{confirmLabel}</Text>
          </TextButton>
        </AlertDialog.ConfirmButton>
      </AlertDialog>
    </Host>
  );
}

/**
 * Zero-sized and out of the flow. Compose's dialog lives in its own window, so
 * this holder exists only to give the composition a parent.
 */
const styles = StyleSheet.create({
  host: {
    position: "absolute",
    width: 0,
    height: 0,
  },
});
