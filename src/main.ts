// Quark entry point — clean bootstrap wiring everything together
// Note: base.css and vars.css are referenced via <link> tags in index.html

import { mountApp } from "./ui/App.js";
import { AppState } from "./app/state.js";
import { setComponents, login, logout, attemptSessionRestore, selectRoom, selectSpace, refreshRooms } from "./app/actions.js";
import { setupKeyboard } from "./app/keyboard.js";
import { setupPanelNav } from "./app/panels.js";
import { startSync } from "./app/sync.js";
import { showError } from "./ui/NotificationToast.js";
import { setForceMock } from "./ipc/invoke.js";
import { showMainLayout } from "./ui/App.js";

// ── Debug mode ────────────────────────────────────────────────────────────────
// Append ?debug to the URL to skip login and show the chat UI with mock data.

const DEBUG_MODE = new URLSearchParams(window.location.search).has("debug");

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const appEl = document.getElementById("app");
if (!appEl) {
  throw new Error("Fatal: #app element not found in DOM");
}

// Mount all UI components into the DOM
const components = mountApp(appEl);

// Register components with the action dispatcher
setComponents(components);

// Wire panel navigation (must happen before any keyboard setup)
setupPanelNav(components);

// ── Debug auto-login ──────────────────────────────────────────────────────────

if (DEBUG_MODE) {
  setForceMock(true);
  AppState.set("loggedIn", true);
  showMainLayout(components);
  setupKeyboard(components);
  void refreshRooms().then(async () => {
    // Auto-select the first room so the timeline is populated
    const rooms = AppState.get("roomListCache");
    if (rooms.length > 0) {
      await selectRoom(rooms[0].room_id);
    }
  });
}

// ── Session restore ───────────────────────────────────────────────────────────
// Try to restore a saved session before showing the login form. Only runs in
// Tauri (the real IPC is needed); skipped in DEBUG_MODE which uses mock data.

if (!DEBUG_MODE) {
  void attemptSessionRestore(components).then((restored) => {
    if (restored) {
      setupKeyboard(components);
      void startSync(components);
    }
  });
}

// ── Login screen wiring ───────────────────────────────────────────────────────

components.loginScreen.onLogin(async (homeserver, username, password) => {
  await login(homeserver, username, password);

  // On successful login, set up keyboard handler and start sync
  if (AppState.get("loggedIn")) {
    setupKeyboard(components);
    void startSync(components);
  }
});

// ── Room list wiring ──────────────────────────────────────────────────────────

components.roomList.onSelect((roomId) => {
  void selectRoom(roomId);
});

// ── Space strip wiring ────────────────────────────────────────────────────────

components.spaceStrip.onSelect((spaceId) => {
  void selectSpace(spaceId);
});

// ── GIF pause/resume on window focus ─────────────────────────────────────────
// Freeze GIF animations while the window is hidden or blurred to avoid wasting
// CPU/GPU when the user is not looking at the app.

function pauseGifs(): void {
  document.querySelectorAll<HTMLImageElement>('img[data-gif="1"]').forEach((img) => {
    if (img.src && !img.dataset.gifSrc) {
      img.dataset.gifSrc = img.src;
      img.src = "";
    }
  });
}

function resumeGifs(): void {
  document.querySelectorAll<HTMLImageElement>('img[data-gif="1"]').forEach((img) => {
    if (img.dataset.gifSrc) {
      img.src = img.dataset.gifSrc;
      delete img.dataset.gifSrc;
    }
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseGifs(); else resumeGifs();
});
window.addEventListener("blur", pauseGifs);
window.addEventListener("focus", resumeGifs);

// ── Global error handler ──────────────────────────────────────────────────────

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
  showError(`Unhandled error: ${msg}`);
  console.error("Unhandled promise rejection:", e.reason);
});

window.addEventListener("error", (e) => {
  showError(`Runtime error: ${e.message}`);
  console.error("Runtime error:", e.error);
});
