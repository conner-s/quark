// Status bar actions: wiring the presence-status setter and starting an edit.

import { setPresenceStatus as ipcSetPresenceStatus } from "../../ipc/index.js";

import { getComponents } from "./context.js";

/**
 * Wire up the status bar's onSetStatus callback and load the initial status.
 * Call once after login completes.
 */
export function setupStatusBar(): void {
  const { statusBar } = getComponents();
  statusBar.onSetStatus((msg) => {
    void ipcSetPresenceStatus(msg).catch(() => { /* non-fatal */ });
  });
}

/**
 * Begin editing the status bar status message (triggered by the S key).
 */
export function editStatus(): void {
  const { statusBar } = getComponents();
  statusBar.beginEdit();
}
