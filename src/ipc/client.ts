// Matrix client IPC calls — auth commands

import { invoke } from "./invoke.js";
import type { SessionInfo, OwnProfile } from "./types.js";

/**
 * Login with password credentials.
 * Matches the Rust `login` command.
 */
export async function login(
  homeserverUrl: string,
  username: string,
  password: string,
): Promise<SessionInfo> {
  return invoke<SessionInfo>("login", {
    homeserverUrl,
    username,
    password,
  });
}

/**
 * Restore a previously saved session.
 * Matches the Rust `restore_session` command.
 */
export async function restoreSession(
  homeserverUrl: string,
  session: SessionInfo,
): Promise<void> {
  return invoke<void>("restore_session", {
    homeserverUrl,
    session,
  });
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

/**
 * Set the current user's display name.
 * Matches the Rust `set_display_name` command.
 */
export async function setDisplayName(name: string): Promise<void> {
  return invoke<void>("set_display_name", { name });
}
