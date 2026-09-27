import {
  CLOSED_CONFIRM_DIALOG,
  closeConfirmDialog,
  openConfirmDialog,
} from "./confirm-dialog-state";

/**
 * The label defaults, the request id and the open/close rules are the part of a
 * confirmation dialog worth asserting: everything else about it is native
 * presentation, which the test policy in `jest.config.js` leaves to a device.
 */
describe("confirm dialog state", () => {
  it("starts closed", () => {
    expect(CLOSED_CONFIRM_DIALOG.visible).toBe(false);
  });

  it("defaults to Confirm / Cancel", () => {
    const state = openConfirmDialog(
      {
        title: "Log Out",
        message: "Are you sure you want to log out of Nexton?",
        onConfirm: () => {},
      },
      1,
    );

    expect(state).toEqual({
      visible: true,
      requestId: 1,
      options: {
        title: "Log Out",
        message: "Are you sure you want to log out of Nexton?",
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
        destructive: false,
        infoOnly: false,
        onConfirm: expect.any(Function),
      },
    });
  });

  it("labels an acknowledgment notice OK", () => {
    const state = openConfirmDialog(
      {
        title: "Validation Error",
        message: "Name cannot be empty.",
        infoOnly: true,
        onConfirm: () => {},
      },
      2,
    );

    expect(state.visible && state.options.confirmLabel).toBe("OK");
    expect(state.visible && state.options.infoOnly).toBe(true);
  });

  it("keeps the labels and the destructive flag a call site sets", () => {
    const onCancel = jest.fn();
    const state = openConfirmDialog(
      {
        title: "Mark Previous Episodes?",
        message: "Mark all previous episodes as watched too?",
        confirmLabel: "Yes",
        cancelLabel: "No",
        destructive: true,
        onConfirm: () => {},
        onCancel,
      },
      7,
    );

    expect(state).toEqual({
      visible: true,
      requestId: 7,
      options: {
        title: "Mark Previous Episodes?",
        message: "Mark all previous episodes as watched too?",
        confirmLabel: "Yes",
        cancelLabel: "No",
        destructive: true,
        infoOnly: false,
        onConfirm: expect.any(Function),
        onCancel,
      },
    });
  });

  it("carries the request id, which is what stops a double alert", () => {
    const first = openConfirmDialog(
      { title: "T", message: "M", onConfirm: () => {} },
      41,
    );
    const second = openConfirmDialog(
      { title: "T", message: "M", onConfirm: () => {} },
      42,
    );

    expect(first.visible && first.requestId).toBe(41);
    expect(second.visible && second.requestId).toBe(42);
  });

  it("does not mutate the options it was handed", () => {
    const options = { title: "Log Out", message: "Sure?", onConfirm: () => {} };

    openConfirmDialog(options, 1);

    expect("confirmLabel" in options).toBe(false);
    expect("destructive" in options).toBe(false);
  });

  it("closes back to the initial state", () => {
    expect(closeConfirmDialog()).toEqual({ visible: false });
  });
});

