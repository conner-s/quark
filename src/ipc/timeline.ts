// Timeline IPC calls

import { invoke } from "@tauri-apps/api/core";
import type { TimelineEvent } from "./types.js";

export type { TimelineEvent };

/**
 * Fetch recent timeline events for a room.
 * Matches the Rust `get_timeline` command.
 */
export async function getTimeline(
  roomId: string,
  limit?: number,
): Promise<TimelineEvent[]> {
  return invoke<TimelineEvent[]>("get_timeline", { roomId, limit });
}

/**
 * Send a plain-text (or HTML) message. Returns the new event ID.
 * Matches the Rust `send_message` command.
 */
export async function sendMessage(
  roomId: string,
  body: string,
  formattedBody?: string,
): Promise<string> {
  return invoke<string>("send_message", { roomId, body, formattedBody });
}

/**
 * Edit an existing message. Returns the edit event ID.
 * Matches the Rust `edit_message` command.
 */
export async function editMessage(
  roomId: string,
  eventId: string,
  newBody: string,
  newFormattedBody?: string,
): Promise<string> {
  return invoke<string>("edit_message", {
    roomId,
    eventId,
    newBody,
    newFormattedBody,
  });
}

/**
 * Redact (delete) a message. Returns the redaction event ID.
 * Matches the Rust `redact_message` command.
 */
export async function redactMessage(
  roomId: string,
  eventId: string,
  reason?: string,
): Promise<string> {
  return invoke<string>("redact_message", { roomId, eventId, reason });
}
