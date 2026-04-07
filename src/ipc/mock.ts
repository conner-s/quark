// Mock IPC layer for browser-only dev mode (no Tauri backend)
// Provides fake data so the UI renders and can be interacted with

import type { RoomInfo, TimelineEvent, EmojiPack, GifResult, RoomMember } from "./types.js";

export interface CacheStats {
  total_size_bytes: number;
  entry_count: number;
  max_size_bytes: number;
  usage_percent: number;
}

const _now = Date.now();
const MOCK_ROOMS: RoomInfo[] = [
  { room_id: "!general:matrix.org", name: "general", topic: "General discussion", avatar_url: null, unread_count: 3, notification_count: 1, is_direct: false, is_encrypted: true, member_count: 42, last_activity_ts: _now - 5 * 60_000 },
  { room_id: "!dev:matrix.org", name: "dev", topic: "Development talk", avatar_url: null, unread_count: 0, notification_count: 0, is_direct: false, is_encrypted: true, member_count: 18, last_activity_ts: _now - 2 * 60 * 60_000 },
  { room_id: "!random:matrix.org", name: "random", topic: "Off-topic banter", avatar_url: null, unread_count: 12, notification_count: 0, is_direct: false, is_encrypted: false, member_count: 35, last_activity_ts: _now - 30 * 60_000 },
  { room_id: "!dm-alice:matrix.org", name: "Alice", topic: null, avatar_url: null, unread_count: 1, notification_count: 0, is_direct: true, is_encrypted: true, member_count: 2, last_activity_ts: _now - 10 * 60_000 },
  { room_id: "!dm-bob:matrix.org", name: "Bob", topic: null, avatar_url: null, unread_count: 0, notification_count: 0, is_direct: true, is_encrypted: true, member_count: 2, last_activity_ts: _now - 3 * 60 * 60_000 },
];

let msgCounter = 100;

// Deterministic SVG avatar per sender (colored initial square)
const AVATAR_COLORS: Record<string, string> = {
  "@alice:matrix.org": "#00ff41",
  "@bob:matrix.org":   "#00aaff",
  "@carol:matrix.org": "#ff4466",
  "@dave:matrix.org":  "#ffaa00",
  "@you:matrix.org":   "#aa44ff",
};

function mockAvatar(sender: string): string {
  const color = AVATAR_COLORS[sender] ?? "#888888";
  const initial = sender.startsWith("@") ? sender[1].toUpperCase() : sender[0].toUpperCase();
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`,
    `<rect width="24" height="24" rx="3" fill="${color}" opacity="0.15"/>`,
    `<rect width="24" height="24" rx="3" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.7"/>`,
    `<text x="12" y="17" text-anchor="middle" font-family="monospace" font-size="13" font-weight="bold" fill="${color}">${initial}</text>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

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
    // Non-spec field used by mock layer only — picked up in timelineEventToMessage
    _mock_avatar_url: mockAvatar(sender),
  } as TimelineEvent & { _mock_avatar_url: string };
}

// Build the mock timeline. We capture event IDs from specific events so replies
// can reference them by ID.
const _aliceThemeEvent = mockEvent("@alice:matrix.org", "I just pushed the new theme system :partyblob:", 31);
const _carolQuestionEvent = mockEvent("@carol:matrix.org", "Can we get a catppuccin variant too?", 20);

const MOCK_TIMELINE: TimelineEvent[] = [
  // Alice sends three messages in a row — middle one has reactions, tests inline reaction layout
  mockEvent("@alice:matrix.org", "hey everyone, check this out", 32),
  { ..._aliceThemeEvent,
    reactions: [
      { key: "🎉", count: 4, own: false, senders: [], own_event_id: null },
      { key: "🚀", count: 2, own: true, senders: ["@you:matrix.org"], own_event_id: "$mock-rxn1" },
    ] },
  mockEvent("@alice:matrix.org", "also shipping the notification system today", 30),

  mockEvent("@bob:matrix.org", "nice! the phosphor theme looks great", 25),
  // Bob replies to Alice's theme push — tests reply bubble break in a consecutive group
  { ...mockEvent("@bob:matrix.org", "the vim keybindings feel really natural too", 24),
    in_reply_to: _aliceThemeEvent.event_id },

  _carolQuestionEvent,

  // Alice again — two messages, second has reactions (tests bottom-corner treatment)
  mockEvent("@alice:matrix.org", "already done — try :theme catppuccin-mocha", 18),
  { ...mockEvent("@alice:matrix.org", "eight built-in themes total now", 17),
    reactions: [
      { key: "👍", count: 3, own: true, senders: ["@you:matrix.org"], own_event_id: "$mock-rxn2" },
    ] },

  // Carol replies to her own question — tests same-sender reply bubble break
  { ...mockEvent("@carol:matrix.org", "actually catppuccin latte too please!", 15),
    in_reply_to: _carolQuestionEvent.event_id },

  { ...mockEvent("@carol:matrix.org", "agreed, dd to redact is *chef's kiss*", 12),
    reactions: [
      { key: "😄", count: 2, own: false, senders: [], own_event_id: null },
      { key: "💯", count: 1, own: false, senders: [], own_event_id: null },
    ] },

  mockEvent("@dave:matrix.org", "just joined, this client looks amazing", 8),
  mockEvent("@alice:matrix.org", "welcome! try :help to see available commands", 5),
  mockEvent("@bob:matrix.org", "anyone working on the sticker packs?", 2),
];

const MOCK_MEMBERS: RoomMember[] = [
  { user_id: "@alice:matrix.org", display_name: "Alice", avatar_url: null, power_level: "admin", presence: "online" },
  { user_id: "@bob:matrix.org",   display_name: "Bob",   avatar_url: null, power_level: "mod",   presence: "online" },
  { user_id: "@carol:matrix.org", display_name: "Carol", avatar_url: null, power_level: "member", presence: "unavailable" },
  { user_id: "@dave:matrix.org",  display_name: "Dave",  avatar_url: null, power_level: "member", presence: "offline" },
  { user_id: "@you:matrix.org",   display_name: "you",   avatar_url: null, power_level: "member", presence: "online" },
  { user_id: "@eve:matrix.org",   display_name: "Eve",   avatar_url: null, power_level: "member", presence: "offline" },
  { user_id: "@frank:matrix.org", display_name: "Frank", avatar_url: null, power_level: "member", presence: "offline" },
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
      return { user_id: "@you:matrix.org", device_id: "MOCKDEVICE", access_token: "mock_token", homeserver_url: (args?.homeserverUrl as string) ?? "https://matrix.org" };
    case "restore_session":
    case "logout":
      return null;
    case "get_rooms":
      return MOCK_ROOMS;
    case "get_timeline":
      return { events: MOCK_TIMELINE, prev_batch: null };
    case "get_event_context": {
      const targetId = args?.eventId as string ?? "";
      const idx = MOCK_TIMELINE.findIndex((e) => e.event_id === targetId);
      const start = Math.max(0, idx - 10);
      const end = Math.min(MOCK_TIMELINE.length, idx + 11);
      return {
        events: MOCK_TIMELINE.slice(start, end),
        target_event_id: targetId,
        prev_batch: start > 0 ? "mock-prev" : null,
        next_batch: end < MOCK_TIMELINE.length ? "mock-next" : null,
      };
    }
    case "get_room_members":
      return MOCK_MEMBERS;
    case "send_message": {
      const body = args?.body as string ?? "";
      const ev = mockEvent("@you:matrix.org", body, 0);
      if (args?.inReplyTo) ev.in_reply_to = args.inReplyTo as string;
      MOCK_TIMELINE.push(ev);
      return ev.event_id;
    }
    case "send_thread_reply": {
      const body = args?.body as string ?? "";
      const ev = mockEvent("@you:matrix.org", body, 0);
      ev.thread_root = args?.threadRootEventId as string ?? null;
      return ev.event_id;
    }
    case "create_room": {
      const opts = args?.options as { name?: string; invite?: string[]; is_direct?: boolean } | undefined;
      const roomId = `!mock-${Date.now()}:matrix.org`;
      const inviteUser = opts?.invite?.[0];
      const name = opts?.name ?? (inviteUser ? inviteUser.slice(1, inviteUser.indexOf(":")) : "New Room");
      MOCK_ROOMS.push({
        room_id: roomId,
        name,
        topic: null,
        avatar_url: null,
        unread_count: 0,
        notification_count: 0,
        is_direct: opts?.is_direct ?? false,
        is_encrypted: true,
        member_count: opts?.is_direct ? 2 : 1,
        last_activity_ts: Date.now(),
      });
      return roomId;
    }
    case "join_room":
    case "leave_room":
    case "mark_room_read":
    case "send_reaction":
    case "edit_message":
    case "redact_message":
    case "start_sync":
      return null;
    case "get_user_spaces":
      return [
        { room_id: "!space1:matrix.org", name: "Work", avatar_url: null, is_space: true, topic: null, member_count: 5, order: null, canonical_alias: null },
        { room_id: "!space2:matrix.org", name: "Gaming", avatar_url: null, is_space: true, topic: null, member_count: 10, order: null, canonical_alias: null },
      ];
    case "get_space_hierarchy":
      return [
        { room_id: "!general:matrix.org", name: "general", avatar_url: null, is_space: false, topic: "General discussion", member_count: 42, order: "1", canonical_alias: null },
        { room_id: "!dev:matrix.org", name: "dev", avatar_url: null, is_space: false, topic: "Development talk", member_count: 18, order: "2", canonical_alias: null },
      ];
    case "get_space_children":
      return MOCK_ROOMS.slice(0, 2).map((r, i) => ({ room_id: r.room_id, name: r.name, avatar_url: r.avatar_url, is_space: false, topic: r.topic, member_count: r.member_count, order: String(i + 1), canonical_alias: null }));
    case "load_quarkrc":
      // No rc file in mock mode — return empty parsed result
      return { directives: [], errors: [] };
    case "load_theme":
      // Return a minimal theme object so :theme commands don't crash in debug mode
      return {
        name: (args?.name as string) ?? "mock",
        colors: {},
      };
    case "get_cache_stats":
      return { total_size_bytes: 15728640, entry_count: 42, max_size_bytes: 209715200, usage_percent: 7.5 } as CacheStats;
    case "get_emoji_packs":
      return [
        {
          pack_id: "mock-custom",
          display_name: "Mock Emoji",
          avatar_url: null,
          source: "user",
          room_id: null,
          emojis: [
            { shortcode: "partyblob", url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='28'>🎉</text></svg>", body: "Party blob", usage: ["emoticon"] },
            { shortcode: "blobcat", url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='28'>🐱</text></svg>", body: "Blob cat", usage: ["emoticon"] },
            { shortcode: "blobwave", url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='28'>👋</text></svg>", body: "Blob wave", usage: ["emoticon"] },
          ],
        },
      ] as EmojiPack[];
    case "get_sticker_packs":
      return [
        {
          pack_id: "mock-sticker-pack",
          display_name: "Mock Stickers",
          avatar_url: null,
          source: "user",
          room_id: null,
          emojis: [
            { shortcode: "wave", url: "mxc://matrix.org/mock-wave", usage: ["sticker"], body: "Wave" },
            { shortcode: "thumbsup", url: "mxc://matrix.org/mock-thumbsup", usage: ["sticker"], body: "Thumbs Up" },
            { shortcode: "heart", url: "mxc://matrix.org/mock-heart", usage: ["sticker"], body: "Heart" },
          ],
        },
      ] as EmojiPack[];
    case "search_gifs": {
      const query = ((args?.query as string) ?? "").toLowerCase();
      // Placeholder SVG thumbnails so the grid actually renders in dev mode
      const makeSvg = (label: string, color: string) =>
        `data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">` +
          `<rect width="160" height="90" fill="${color}" opacity="0.15"/>` +
          `<rect width="160" height="90" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.6"/>` +
          `<text x="80" y="50" text-anchor="middle" font-family="monospace" font-size="11" fill="${color}">${label}</text>` +
          `<text x="80" y="70" text-anchor="middle" font-family="monospace" font-size="9" fill="${color}" opacity="0.6">GIF</text>` +
          `</svg>`,
        )}`;
      const MOCK_GIFS: GifResult[] = [
        { id: "gif1", title: "Happy Dance", url: "https://example.com/gifs/dance.gif",     preview_url: makeSvg("happy dance", "#00ff41"),  width: 480, height: 270 },
        { id: "gif2", title: "Thumbs Up",   url: "https://example.com/gifs/thumbsup.gif",  preview_url: makeSvg("thumbs up",   "#00aaff"),  width: 320, height: 240 },
        { id: "gif3", title: "Cat Typing",  url: "https://example.com/gifs/cattype.gif",   preview_url: makeSvg("cat typing",  "#ff4466"),  width: 480, height: 320 },
        { id: "gif4", title: "Mind Blown",  url: "https://example.com/gifs/mindblown.gif", preview_url: makeSvg("mind blown",  "#ffaa00"),  width: 400, height: 300 },
        { id: "gif5", title: "Applause",    url: "https://example.com/gifs/applause.gif",  preview_url: makeSvg("applause",    "#aa44ff"),  width: 480, height: 270 },
        { id: "gif6", title: "Facepalm",    url: "https://example.com/gifs/facepalm.gif",  preview_url: makeSvg("facepalm",    "#888888"),  width: 360, height: 240 },
      ];
      if (query) {
        return MOCK_GIFS.filter((g) => g.title.toLowerCase().includes(query));
      }
      return MOCK_GIFS;
    }
    case "send_gif": {
      const title = (args?.title as string) ?? "GIF";
      MOCK_TIMELINE.push({
        ...mockEvent("@you:matrix.org", `[GIF: ${title}]`, 0),
        msg_type: "m.image",
        media_url: (args?.gifUrl as string) ?? "",
        media_mimetype: "image/gif",
      } as TimelineEvent);
      return "$mock-gif-event-id";
    }
    case "send_pasted_image": {
      const filename = (args?.filename as string) ?? "pasted-image.png";
      MOCK_TIMELINE.push({
        ...mockEvent("@you:matrix.org", `[Image: ${filename}]`, 0),
        msg_type: "m.image",
        media_url: "",
        media_mimetype: (args?.mimeType as string) ?? "image/png",
      } as TimelineEvent);
      return "$mock-paste-event-id";
    }
    case "send_file": {
      const filename = (args?.filename as string) ?? "file";
      MOCK_TIMELINE.push({
        ...mockEvent("@you:matrix.org", `[File: ${filename}]`, 0),
        msg_type: "m.file",
        media_url: "",
        media_mimetype: (args?.mimeType as string) ?? "application/octet-stream",
      } as TimelineEvent);
      return "$mock-file-event-id";
    }
    case "send_sticker":
      return "$mock-sticker-event-id";
    case "get_own_profile":
      return { user_id: "@you:matrix.org", display_name: "You", avatar_url: null };
    case "set_presence_status":
      return;
    case "get_notification_config":
      return { enabled: true, show_body: true, show_sender: true, mute_rooms: [], quiet_hours: null };

    // ─── Crypto ──────────────────────────────────────────────────────────
    case "get_verification_status":
      return { user_id: "@you:matrix.org", device_id: "MOCKDEVICE", is_verified: true, is_cross_signed: false, trust_level: "self-verified" };
    case "get_cross_signing_status":
      return { has_master: false, has_self_signing: false, has_user_signing: false, is_complete: false };
    case "bootstrap_cross_signing":
      // Simulate server needing UIAA if no password supplied
      if (!args?.password) throw new Error("UIAA_REQUIRED");
      return null;
    case "get_user_devices":
      return [
        { user_id: args?.userId as string ?? "@alice:matrix.org", device_id: "ALICEPHONE", is_verified: false, is_cross_signed: false, trust_level: "unverified" },
        { user_id: args?.userId as string ?? "@alice:matrix.org", device_id: "ALICEDESKTOP", is_verified: true, is_cross_signed: false, trust_level: "self-verified" },
      ];
    case "start_sas_verification":
      return "mock-flow-id-" + Date.now();
    case "accept_verification_request":
    case "accept_sas_verification":
    case "confirm_sas_verification":
    case "cancel_sas_verification":
      return null;
    case "get_sas_info": {
      // Simulate emojis becoming available after a short delay
      const MOCK_EMOJIS: [string, string][] = [
        ["🐶", "Dog"], ["🌙", "Moon"], ["🎩", "Hat"],
        ["🌹", "Rose"], ["🏠", "House"], ["🐧", "Penguin"], ["🎉", "Party"],
      ];
      return {
        flow_id: args?.flowId as string ?? "mock-flow-id",
        other_user_id: args?.userId as string ?? "@alice:matrix.org",
        other_device_id: "ALICEPHONE",
        emoji: MOCK_EMOJIS,
        decimals: null,
      };
    }

    case "get_pinned_events":
      return [
        { event_id: "$pin1:matrix.org", sender: "@alice:matrix.org", body: "Check out the new release notes!", formatted_body: null, timestamp: Date.now() - 24 * 60 * 60_000 },
        { event_id: "$pin2:matrix.org", sender: "@bob:matrix.org", body: "Server maintenance scheduled for Sunday 02:00 UTC.", formatted_body: null, timestamp: Date.now() - 3 * 24 * 60 * 60_000 },
        { event_id: "$pin3:matrix.org", sender: "@alice:matrix.org", body: "Welcome to #general! Please read the rules in #announcements.", formatted_body: null, timestamp: Date.now() - 7 * 24 * 60 * 60_000 },
      ];
    case "search_room_directory": {
      const filterStr = ((args?.filter as string | null) ?? "").toLowerCase();
      const rooms = [
        { room_id: "!pub1:matrix.org", name: "Matrix HQ", topic: "The official Matrix headquarters room", alias: "#matrix:matrix.org", avatar_url: null, member_count: 12500 },
        { room_id: "!pub2:matrix.org", name: "Open Source Developers", topic: "For FOSS contributors and enthusiasts", alias: "#opensource:matrix.org", avatar_url: null, member_count: 3800 },
        { room_id: "!pub3:matrix.org", name: "Gaming Lounge", topic: "All things gaming", alias: "#gaming:matrix.org", avatar_url: null, member_count: 950 },
        { room_id: "!pub4:matrix.org", name: "Linux & BSD", topic: "Linux, BSD and unix-like system discussion", alias: "#linux:matrix.org", avatar_url: null, member_count: 2100 },
        { room_id: "!pub5:matrix.org", name: "Privacy & Security", topic: "Privacy tools and best practices", alias: "#privacy:matrix.org", avatar_url: null, member_count: 4400 },
      ];
      return filterStr
        ? rooms.filter((r) => (r.name + " " + (r.topic ?? "")).toLowerCase().includes(filterStr))
        : rooms;
    }
    case "get_app_config":
      return {
        general: { theme: "phosphor", notifications: true, confirm_redact: true, icon_radius: "50%" },
        sync: { sliding_sync: true, timeline_limit: 50 },
        media: { auto_load_images: true, max_image_width: 600, max_image_height: 400, sticker_max_size: 256, cache_size_mb: 500 },
        gif: { provider: "tenor", api_key: "", rating: "pg", cache_results: true },
        emoji: { shortcode_autocomplete: true, autocomplete_min_chars: 2 },
      };
    case "set_app_config":
    case "set_notification_config":
    case "clear_media_cache":
    case "set_cache_size_limit":
    case "mute_room":
    case "unmute_room":
      return null;
    case "save_media_to_temp":
      return `/tmp/quark-mock-video.mp4`;
    case "open_media_externally":
      console.log("[mock] open_media_externally", args);
      return null;

    case "download_media": {
      // Return a placeholder SVG so emoji/sticker previews render in mock mode.
      const label = ((args?.mxcUrl as string) ?? "").split("/").pop()?.slice(0, 8) ?? "media";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
        `<rect width="64" height="64" rx="8" fill="#00ff41" opacity="0.15"/>` +
        `<rect width="64" height="64" rx="8" fill="none" stroke="#00ff41" stroke-width="1.5" opacity="0.6"/>` +
        `<text x="32" y="38" text-anchor="middle" font-family="monospace" font-size="9" fill="#00ff41">${label}</text>` +
        `</svg>`;
      return { data_base64: btoa(svg), mime_type: "image/svg+xml", filename: null };
    }

    default:
      console.warn(`[mock] unhandled command: ${cmd}`, args);
      return null;
  }
}
