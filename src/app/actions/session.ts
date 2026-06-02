// Session lifecycle actions: login, session restore, logout.

import { AppState } from "../state.js";
import { saveSession, clearSession } from "../session.js";

import {
  login as ipcLogin,
  restoreSession as ipcRestoreSession,
  logout as ipcLogout,
  getOwnProfile,
  downloadMedia,
  getAppConfig,
} from "../../ipc/index.js";

import { showMainLayout } from "../../ui/App.js";
import { showSuccess } from "../../ui/NotificationToast.js";

import { getComponents } from "./context.js";
import { refreshRooms, applyCacheConfig } from "./rooms.js";
import { loadThemeFromConfig } from "./theme.js";

/** Apply persisted runtime preferences from config at session start: the
 *  in-memory cache budgets and the read-receipt display setting (non-critical). */
function _applyStartupConfig(): void {
  void getAppConfig().then((cfg) => {
    applyCacheConfig(cfg);
    AppState.set("showReadReceipts", cfg.general.show_read_receipts);
  }).catch(() => { /* defaults stand */ });
}

/** Fetch own profile and store userId + displayName in AppState. Non-critical. */
async function _loadOwnProfile(): Promise<void> {
  try {
    const profile = await getOwnProfile();
    AppState.set("ownUserId", profile.user_id);
    AppState.set("ownDisplayName", profile.display_name);

    // Render the user's avatar in the space-strip profile button. Mxc URLs
    // need downloading; the initial fallback works without network. Both
    // the space strip's own renderer handles either case.
    const initialSource = profile.display_name || profile.user_id.replace(/^@/, "");
    const { spaceStrip } = getComponents();
    spaceStrip.setOwnProfile(initialSource, null);

    if (profile.avatar_url?.startsWith("mxc://")) {
      try {
        const dl = await downloadMedia(profile.avatar_url);
        const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
        spaceStrip.setOwnProfile(initialSource, dataUrl);
      } catch {
        // Network or media error — leave the initial fallback in place.
      }
    }
  } catch {
    // Non-critical — sendMessage falls back to user ID string
  }
}

/**
 * Poll refreshRooms() until the room cache populates, capped at ~8s.
 *
 * Rationale: on first login the backend `start_sync` has only just been
 * spawned and the long-poll sync hasn't returned any rooms yet. Calling
 * refreshRooms() once at this point gets an empty list. The matrix-sdk
 * sync loop runs internally and exits the `Ok(_)` arm of our Rust loop
 * rarely — so the EVENT_CONNECTED frontend listener can't be relied on
 * for the initial population on slower mobile networks.
 *
 * We poll instead, backing off as we go: tight 500ms ticks early (fast networks
 * land rooms in a second or two), then easing off so a slow first sync — common
 * on mobile networks and when the initial E2EE/room state is large — still gets
 * picked up without hammering IPC. The window is ~30s (the old 8s cap gave up
 * before slow first syncs completed, leaving the list blank until an app
 * restart, when the persisted store makes getRooms() instant). Stops the moment
 * rooms appear; after that the sync/connected and sync/rooms listeners take over.
 */
async function _pollUntilRoomsLoaded(): Promise<void> {
  const DELAYS_MS = [
    ...Array<number>(10).fill(500),   // 0–5s
    ...Array<number>(10).fill(1000),  // 5–15s
    ...Array<number>(8).fill(2000),   // 15–31s
  ];
  for (const delay of DELAYS_MS) {
    if (AppState.get("roomListCache").length > 0) return;
    await new Promise((r) => setTimeout(r, delay));
    try { await refreshRooms(); } catch { /* keep polling */ }
  }
}

/**
 * Attempt password login. On success, transitions to main layout and loads rooms.
 */
export async function login(homeserver: string, username: string, password: string): Promise<void> {
  const { loginScreen } = getComponents();
  loginScreen.setLoading(true);

  try {
    const session = await ipcLogin(homeserver, username, password);
    saveSession(session);
    AppState.set("loggedIn", true);

    showMainLayout(getComponents());
    loginScreen.hide();

    void _loadOwnProfile();
    await loadThemeFromConfig();
    _applyStartupConfig();
    await refreshRooms();
    // First-login race: the Rust sync loop is up but hasn't returned rooms yet.
    // Keep retrying in the background so the user doesn't have to relaunch.
    void _pollUntilRoomsLoaded();

    showSuccess("Connected successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loginScreen.setStatus(message, "error");
  } finally {
    loginScreen.setLoading(false);
  }
}

/**
 * Attempt to restore a previously saved session. Returns true on success.
 * Call this on startup before showing the login form.
 */
export async function attemptSessionRestore(components: import("../../ui/App.js").AppComponents): Promise<boolean> {
  const { loadSession } = await import("../session.js");
  const session = loadSession();
  if (!session) return false;

  try {
    await ipcRestoreSession(session.homeserver_url, session);
    AppState.set("loggedIn", true);
    showMainLayout(components);
    void _loadOwnProfile();
    await loadThemeFromConfig();
    _applyStartupConfig();
    await refreshRooms();
    // Persisted sync state usually makes getRooms() instant on restore, but if
    // the store hasn't hydrated yet (cold start) the first call can be empty —
    // keep retrying in the background so the list isn't blank until a relaunch.
    // Same race the login path guards against. (#33/#43)
    void _pollUntilRoomsLoaded();
    return true;
  } catch (err) {
    // Stale/invalid session — clear it and fall through to login form
    clearSession();
    console.warn("Session restore failed, showing login:", err);
    return false;
  }
}

/**
 * Logout: revoke server session, clear local session, show login screen.
 */
export async function logout(): Promise<void> {
  try {
    await ipcLogout();
  } catch (err) {
    console.warn("Logout IPC failed (continuing anyway):", err);
  }
  clearSession();
  AppState.set("loggedIn", false);
  window.location.reload();
}
