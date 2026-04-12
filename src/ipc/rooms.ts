// Room IPC calls

import { invoke } from "./invoke.js";
import type { RoomInfo, CreateRoomOptions, RoomMember, PinnedEventInfo, PublicRoomInfo } from "./types.js";

export type { RoomInfo, CreateRoomOptions, RoomMember, PinnedEventInfo, PublicRoomInfo };

/**
 * Get all joined rooms.
 * Matches the Rust `get_rooms` command.
 */
export async function getRooms(): Promise<RoomInfo[]> {
  return invoke<RoomInfo[]>("get_rooms");
}

/**
 * Join a room by ID or alias. Returns the canonical room ID.
 * Matches the Rust `join_room` command.
 */
export async function joinRoom(roomIdOrAlias: string): Promise<string> {
  return invoke<string>("join_room", { roomIdOrAlias });
}

/**
 * Leave a room by ID.
 * Matches the Rust `leave_room` command.
 */
export async function leaveRoom(roomId: string): Promise<void> {
  return invoke<void>("leave_room", { roomId });
}

/**
 * Create a new room. Returns the new room ID.
 * Matches the Rust `create_room` command.
 */
export async function createRoom(options: CreateRoomOptions): Promise<string> {
  return invoke<string>("create_room", { options });
}

/**
 * Get the member list for a room.
 * Matches the Rust `get_room_members` command.
 */
export async function getRoomMembers(roomId: string): Promise<RoomMember[]> {
  return invoke<RoomMember[]>("get_room_members", { roomId });
}

/**
 * Send a read receipt for the latest event in a room, clearing the unread count.
 * Matches the Rust `mark_room_read` command.
 */
export async function markRoomRead(roomId: string): Promise<void> {
  return invoke<void>("mark_room_read", { roomId });
}

/**
 * Get pinned events for a room.
 * Matches the Rust `get_pinned_events` command.
 */
export async function getPinnedEvents(roomId: string): Promise<PinnedEventInfo[]> {
  return invoke<PinnedEventInfo[]>("get_pinned_events", { roomId });
}

/**
 * Search the public room directory.
 * Matches the Rust `search_room_directory` command.
 */
export async function searchRoomDirectory(filter?: string, limit?: number): Promise<PublicRoomInfo[]> {
  return invoke<PublicRoomInfo[]>("search_room_directory", {
    filter: filter ?? null,
    limit: limit ?? null,
  });
}

/**
 * Invite a user to the given room.
 * Matches the Rust `invite_user` command.
 */
export async function inviteUser(roomId: string, userId: string): Promise<void> {
  return invoke<void>("invite_user", { roomId, userId });
}

/**
 * Kick a user from the given room with an optional reason.
 * Matches the Rust `kick_user` command.
 */
export async function kickUser(roomId: string, userId: string, reason?: string): Promise<void> {
  return invoke<void>("kick_user", { roomId, userId, reason: reason ?? null });
}

/**
 * Ban a user from the given room with an optional reason.
 * Matches the Rust `ban_user` command.
 */
export async function banUser(roomId: string, userId: string, reason?: string): Promise<void> {
  return invoke<void>("ban_user", { roomId, userId, reason: reason ?? null });
}

/**
 * Unban a user from the given room.
 * Matches the Rust `unban_user` command.
 */
export async function unbanUser(roomId: string, userId: string): Promise<void> {
  return invoke<void>("unban_user", { roomId, userId });
}
