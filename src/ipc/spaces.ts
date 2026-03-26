// Space IPC calls

import { invoke } from "./invoke.js";
import type { SpaceChild, RoomInfo } from "./types.js";

export type { SpaceChild };

/**
 * Get the child hierarchy of a space room.
 * Matches the Rust `get_space_hierarchy` command.
 */
export async function getSpaceHierarchy(
  spaceRoomId: string,
  maxDepth?: number,
): Promise<SpaceChild[]> {
  return invoke<SpaceChild[]>("get_space_hierarchy", { spaceRoomId, maxDepth });
}

/**
 * Convenience: get all direct children of a space (depth 1).
 */
export async function getSpaceChildren(spaceId: string): Promise<SpaceChild[]> {
  return getSpaceHierarchy(spaceId, 1);
}

/**
 * Convenience: get rooms within a space as RoomInfo-shaped objects.
 * Filters to non-space children only.
 */
export async function getSpaceRooms(spaceId: string): Promise<RoomInfo[]> {
  const children = await getSpaceChildren(spaceId);
  return children
    .filter((c) => !c.is_space)
    .map(
      (c): RoomInfo => ({
        room_id: c.room_id,
        name: c.name,
        topic: c.topic,
        avatar_url: c.avatar_url,
        unread_count: 0,
        notification_count: 0,
        is_direct: false,
        is_encrypted: false,
        member_count: c.member_count ?? 0,
      }),
    );
}

/**
 * Convenience: get sub-spaces within a space.
 */
export async function getSubSpaces(spaceId: string): Promise<SpaceChild[]> {
  const children = await getSpaceChildren(spaceId);
  return children.filter((c) => c.is_space);
}

/**
 * Get all space rooms the current user has joined.
 */
export async function getUserSpaces(): Promise<SpaceChild[]> {
  return invoke<SpaceChild[]>("get_user_spaces", {});
}
