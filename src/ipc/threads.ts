// Thread IPC calls

import { invoke } from "@tauri-apps/api/core";
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
