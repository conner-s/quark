// Quark entry point — clean bootstrap wiring everything together
// Note: base.css and vars.css are referenced via <link> tags in index.html

import { mountApp } from "./ui/App.js";
import { AppState } from "./app/state.js";
import { setComponents, login, selectRoom, selectSpace } from "./app/actions.js";
import { setupKeyboard } from "./app/keyboard.js";
import { startSync } from "./app/sync.js";
import { showError } from "./ui/NotificationToast.js";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const appEl = document.getElementById("app");
if (!appEl) {
  throw new Error("Fatal: #app element not found in DOM");
}

// Mount all UI components into the DOM
const components = mountApp(appEl);

// Register components with the action dispatcher
setComponents(components);

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
