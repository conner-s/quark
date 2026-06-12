// Reaction IPC calls

import { invoke } from "./invoke.js";
import type { ReactionGroup } from "./types.js";

export type { ReactionGroup };

/**
 * Send a reaction to an event. Returns the reaction event ID.
 * Matches the Rust `send_reaction` command.
 */
export async function sendReaction(
  roomId: string,
  eventId: string,
  key: string,
): Promise<string> {
  return invoke<string>("send_reaction", { roomId, eventId, key });
}

/**
 * Get aggregated reactions for a specific event.
 * Matches the Rust `get_reactions` command.
 */
export async function getReactions(
  roomId: string,
  eventId: string,
): Promise<ReactionGroup[]> {
  return invoke<ReactionGroup[]>("get_reactions", { roomId, eventId });
}
