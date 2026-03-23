// Mock IPC layer for browser-only dev mode (no Tauri backend)
// Provides fake data so the UI renders and can be interacted with

import type { RoomInfo, TimelineEvent, EmojiPack, GifResult } from "./types.js";

export interface CacheStats {
  total_size_bytes: number;
  entry_count: number;
  max_size_bytes: number;
  usage_percent: number;
}

const MOCK_ROOMS: RoomInfo[] = [
  { room_id: "!general:matrix.org", name: "general", topic: "General discussion", avatar_url: null, unread_count: 3, notification_count: 1, is_direct: false, is_encrypted: true, member_count: 42 },
  { room_id: "!dev:matrix.org", name: "dev", topic: "Development talk", avatar_url: null, unread_count: 0, notification_count: 0, is_direct: false, is_encrypted: true, member_count: 18 },
  { room_id: "!random:matrix.org", name: "random", topic: "Off-topic banter", avatar_url: null, unread_count: 12, notification_count: 0, is_direct: false, is_encrypted: false, member_count: 35 },
  { room_id: "!dm-alice:matrix.org", name: "Alice", topic: null, avatar_url: null, unread_count: 1, notification_count: 0, is_direct: true, is_encrypted: true, member_count: 2 },
  { room_id: "!dm-bob:matrix.org", name: "Bob", topic: null, avatar_url: null, unread_count: 0, notification_count: 0, is_direct: true, is_encrypted: true, member_count: 2 },
];

let msgCounter = 100;

function mockEvent(sender: string, body: string, minutesAgo: number): TimelineEvent {
  return {
    event_id: `$evt${msgCounter++}`,
    sender,
    body,
    formatted_body: null,
    timestamp: Date.now() - minutesAgo * 60000,
    msg_type: "m.text",
    is_edit: false,
    relates_to_event_id: null,
    in_reply_to: null,
    thread_root: null,
    media_url: null,
    media_mimetype: null,
    media_width: null,
    media_height: null,
  };
}

const MOCK_TIMELINE: TimelineEvent[] = [
  mockEvent("@alice:matrix.org", "hey everyone, check this out", 30),
  mockEvent("@alice:matrix.org", "I just pushed the new theme system :partyblob:", 29),
  mockEvent("@bob:matrix.org", "nice! the phosphor theme looks great", 25),
  mockEvent("@carol:matrix.org", "Can we get a catppuccin variant too?", 20),
  mockEvent("@alice:matrix.org", "already done — try :theme catppuccin-mocha", 18),
  mockEvent("@bob:matrix.org", "the vim keybindings feel really natural", 15),
  mockEvent("@carol:matrix.org", "agreed, dd to redact is *chef's kiss*", 12),
  mockEvent("@dave:matrix.org", "just joined, this client looks amazing", 8),
  mockEvent("@alice:matrix.org", "welcome! try :help to see available commands", 5),
  mockEvent("@bob:matrix.org", "anyone working on the sticker packs?", 2),
];

// Check if we're running inside Tauri
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Mock invoke that returns fake data
export async function mockInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  // Simulate a small network delay
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));

  switch (cmd) {
    case "login":
      return null;
    case "get_rooms":
      return MOCK_ROOMS;
    case "get_timeline":
      return MOCK_TIMELINE;
    case "send_message": {
      const body = args?.body as string ?? "";
      MOCK_TIMELINE.push(mockEvent("@you:matrix.org", body, 0));
      return null;
    }
    case "join_room":
    case "leave_room":
    case "send_reaction":
    case "edit_message":
    case "redact_message":
    case "start_sync":
      return null;
    case "get_space_hierarchy":
      return [
        { space_id: "!space1:matrix.org", name: "Work", avatar_url: null },
        { space_id: "!space2:matrix.org", name: "Gaming", avatar_url: null },
      ];
    case "get_space_children":
      return MOCK_ROOMS.slice(0, 3);
    case "load_theme":
      return null;
    case "get_cache_stats":
      return { total_size_bytes: 15728640, entry_count: 42, max_size_bytes: 209715200, usage_percent: 7.5 } as CacheStats;
    case "get_emoji_packs":
    case "get_sticker_packs":
      return [] as EmojiPack[];
    case "search_gifs":
      return [] as GifResult[];
    case "get_notification_config":
      return { enabled: true, show_body: true, show_sender: true, mute_rooms: [], quiet_hours: null };
    default:
      console.warn(`[mock] unhandled command: ${cmd}`, args);
      return null;
  }
}
