// Session persistence — save/load/clear the Matrix session from localStorage.
// Stored as JSON; the SessionInfo struct includes the homeserver_url so it's
// self-contained for restore_session IPC calls.

import type { SessionInfo } from "../ipc/types.js";

const SESSION_KEY = "quark_session";

export function saveSession(session: SessionInfo): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): SessionInfo | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionInfo;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
