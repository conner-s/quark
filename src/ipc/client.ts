// Matrix client IPC calls — auth commands

import { invoke } from "./invoke.js";
import type { SessionInfo } from "./types.js";

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
