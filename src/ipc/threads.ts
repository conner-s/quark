// Thread IPC calls

import { invoke } from "./invoke.js";
import type { TimelineEvent, ThreadRoot } from "./types.js";

export type { ThreadRoot };

/**
 * Get all thread roots in a room.
 * Matches the Rust `get_thread_roots` command.
 */
export async function getThreadRoots(roomId: string): Promise<ThreadRoot[]> {
  return invoke<ThreadRoot[]>("get_thread_roots", { roomId });
}

/**
 * Get the full timeline of a thread (root + replies).
 * Matches the Rust `get_thread_timeline` command.
 */
export async function getThreadTimeline(
  roomId: string,
  threadRootEventId: string,
): Promise<TimelineEvent[]> {
  return invoke<TimelineEvent[]>("get_thread_timeline", {
    roomId,
    threadRootEventId,
  });
}

/**
 * Send a reply in a thread. Returns the new event ID.
 * Matches the Rust `send_thread_reply` command.
 */
export async function sendThreadReplyIpc(
  roomId: string,
  threadRootEventId: string,
  body: string,
  formattedBody?: string,
): Promise<string> {
  return invoke<string>("send_thread_reply", {
    roomId,
    threadRootEventId,
    body,
    formattedBody,
  });
}
