// Matrix client IPC calls — auth commands

import { invoke } from "./invoke.js";
import type { OwnProfile } from "./types.js";

/**
 * Login with password credentials. On success the backend persists the session
 * in the OS keyring; the access token is never returned to the frontend.
 * Matches the Rust `login` command.
 */
export async function login(
  homeserverUrl: string,
  username: string,
  password: string,
): Promise<void> {
  return invoke<void>("login", {
    homeserverUrl,
    username,
    password,
  });
}

/**
 * Result of a session-restore attempt. Mirrors the Rust `RestoreOutcome` enum.
 * Only `Invalid` means the stored session is dead and should be cleared — an
 * `Unavailable` (locked/unreachable keyring) must NOT trigger a wipe, or a
 * transient lock at startup would destroy the encrypted local store.
 */
export type RestoreOutcome = "Restored" | "NoSession" | "Unavailable" | "Invalid";

/**
 * Restore a previously saved session from the OS keyring. The returned outcome
 * tells the caller what to do: `Restored` → syncing; `NoSession` → show login;
 * `Unavailable` → show login with unlock guidance (do not clear); `Invalid` →
 * `clearStoredSession()` then show login.
 * Matches the Rust `restore_session` command.
 */
export async function restoreSession(): Promise<RestoreOutcome> {
  return invoke<RestoreOutcome>("restore_session", {});
}

/**
 * Drop all local session state (keyring session + store-encryption key + SQLite
 * store) without contacting the server. Used to recover from a failed restore.
 * Matches the Rust `clear_session` command.
 */
export async function clearStoredSession(): Promise<void> {
  return invoke<void>("clear_session", {});
}

/**
 * Logout the current session.
 * Matches the Rust `logout` command.
 */
export async function logout(): Promise<void> {
  return invoke<void>("logout");
}

/**
 * Fetch the current user's own profile.
 * Matches the Rust `get_own_profile` command.
 */
export async function getOwnProfile(): Promise<OwnProfile> {
  return invoke<OwnProfile>("get_own_profile", {});
}

/**
 * Set the current user's presence status message (m.presence status_msg).
 * Pass an empty string to clear the status.
 */
export async function setPresenceStatus(statusMsg: string): Promise<void> {
  return invoke<void>("set_presence_status", { statusMsg });
}

export interface PresenceInfo {
  user_id: string;
  /** "online" | "unavailable" | "offline" — string-typed for forward compat. */
  presence: string;
  status_msg: string | null;
}

/**
 * Fetch a user's current presence + status message from the homeserver.
 * Used as a fallback when the sync-driven cache has no entry yet.
 */
export async function getPresenceStatus(userId: string): Promise<PresenceInfo> {
  return invoke<PresenceInfo>("get_presence_status", { userId });
}

/**
 * Set the current user's display name.
 * Matches the Rust `set_display_name` command.
 */
export async function setDisplayName(name: string): Promise<void> {
  return invoke<void>("set_display_name", { name });
}

/**
 * Upload and set the account avatar from base64 image data. Returns the new
 * mxc:// URI. Matches the Rust `set_avatar` command.
 */
export async function setAvatar(dataBase64: string, mime: string): Promise<string> {
  return invoke<string>("set_avatar", { dataBase64, mime });
}
