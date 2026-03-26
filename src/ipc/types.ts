// Shared IPC type definitions — mirror the serde-serialized Rust structs.
// Keep field names in snake_case to match Tauri's default serialization.

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  user_id: string;
  device_id: string;
  access_token: string;
  homeserver_url: string;
}

/** Own user profile — matches matrix::client::OwnProfile */
export interface OwnProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

/** Serializable room info — matches matrix::rooms::RoomInfo */
export interface RoomInfo {
  room_id: string;
  name: string | null;
  topic: string | null;
  avatar_url: string | null;
  unread_count: number;
  notification_count: number;
  is_direct: boolean;
  is_encrypted: boolean;
  member_count: number;
}

/** Options for creating a room — matches matrix::rooms::CreateRoomOptions */
export interface CreateRoomOptions {
  name?: string | null;
  topic?: string | null;
  alias?: string | null;
  is_public: boolean;
  is_direct: boolean;
  invite: string[];
  enable_encryption: boolean;
}

// ─── Members ──────────────────────────────────────────────────────────────────

/** Power level categories */
export type MemberPowerLevel = "admin" | "mod" | "member";

/** A single room member — matches matrix::rooms::RoomMember */
export interface RoomMember {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  power_level: MemberPowerLevel;
  presence: "online" | "unavailable" | "offline" | null;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

/** A page of timeline events with a cursor for loading older messages. */
export interface TimelinePage {
  events: TimelineEvent[];
  /** Token to pass as `before` to fetch the previous (older) page. Null at the start of history. */
  prev_batch: string | null;
}

/** Serializable timeline event — matches matrix::timeline::TimelineEvent */
export interface TimelineEvent {
  event_id: string;
  sender: string;
  body: string;
  formatted_body: string | null;
  timestamp: number;
  msg_type: string;
  is_edit: boolean;
  relates_to_event_id: string | null;
  in_reply_to: string | null;
  thread_root: string | null;
  media_url: string | null;
  media_mimetype: string | null;
  media_width: number | null;
  media_height: number | null;
  reactions?: ReactionGroup[];
}

// ─── Reactions ────────────────────────────────────────────────────────────────

/** Aggregated reaction group — matches matrix::reactions::ReactionGroup */
export interface ReactionGroup {
  key: string;
  count: number;
  senders: string[];
  /** Serialized as "own" by the Rust backend (serde rename). */
  own: boolean;
  own_event_id: string | null;
}

// ─── Emoji ────────────────────────────────────────────────────────────────────

/** A single emoji entry — matches matrix::emoji::EmojiEntry */
export interface EmojiEntry {
  shortcode: string;
  url: string;
  body: string | null;
  /** Usage tags: ["emoticon"], ["sticker"], or both */
  usage: string[];
}

/** An emoji/sticker pack — matches matrix::emoji::EmojiPack */
export interface EmojiPack {
  pack_id: string;
  display_name: string | null;
  avatar_url: string | null;
  /** "room" | "user" */
  source: string;
  room_id: string | null;
  emojis: EmojiEntry[];
}

// ─── Media ────────────────────────────────────────────────────────────────────

/** Result of a media download — matches matrix::media::MediaDownload */
export interface MediaDownload {
  data_base64: string;
  mime_type: string;
  filename: string | null;
}

// ─── Crypto ───────────────────────────────────────────────────────────────────

/** Verification status for a device — matches matrix::crypto::VerificationStatus */
export interface VerificationStatus {
  user_id: string;
  device_id: string;
  is_verified: boolean;
  is_cross_signed: boolean;
  trust_level: string;
}

/**
 * Cross-signing key status — matches matrix::crypto::CrossSigningInfo.
 * `is_complete` is true when all three keys (master, self-signing, user-signing)
 * are present locally.
 */
export interface CrossSigningInfo {
  has_master: boolean;
  has_self_signing: boolean;
  has_user_signing: boolean;
  is_complete: boolean;
}

/**
 * SAS emoji verification info — matches matrix::crypto::SasInfo.
 * `emoji` is a list of [symbol, description] pairs (up to 7).
 * Available only after key exchange; poll get_sas_info until present.
 */
export interface SasInfo {
  flow_id: string;
  other_user_id: string;
  other_device_id: string;
  /** Each element is [emoji_symbol, description], e.g. ["🐶", "Dog"] */
  emoji: [string, string][];
  /** Three-digit decimal alternative to emoji, or null */
  decimals: [number, number, number] | null;
}

// ─── Spaces ───────────────────────────────────────────────────────────────────

/** A child room/space — matches matrix::spaces::SpaceChild */
export interface SpaceChild {
  room_id: string;
  name: string | null;
  topic: string | null;
  avatar_url: string | null;
  is_space: boolean;
  member_count: number | null;
  order: string | null;
  canonical_alias: string | null;
}

// ─── Threads ──────────────────────────────────────────────────────────────────

/** A thread root message — matches matrix::threads::ThreadRoot */
export interface ThreadRoot {
  event_id: string;
  sender: string;
  body: string;
  timestamp: number;
  reply_count: number;
  latest_reply_timestamp: number | null;
}

// ─── GIF ──────────────────────────────────────────────────────────────────────

/** A GIF result — matches gif::GifResult */
export interface GifResult {
  id: string;
  title: string;
  url: string;
  preview_url: string;
  width: number;
  height: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * A parsed key mapping — matches config::quarkrc::Mapping.
 * map_type is serialized as lowercase via serde rename_all.
 */
export interface Mapping {
  map_type: MapType;
  noremap: boolean;
  key: string;
  action: string;
}

export type MapType =
  | "normal"
  | "insert"
  | "timeline"
  | "roomlist"
  | "picker"
  | "command"
  | "visual";

export interface Unmap {
  map_type: MapType;
  key: string;
}

export type OptionValue =
  | boolean
  | number
  | string;

export interface SetOption {
  name: string;
  value: OptionValue;
}

export interface LetBinding {
  name: string;
  value: string;
}

export interface SourceDirective {
  path: string;
}

export interface ColorschemeDiretive {
  name: string;
}

/** A parsed directive line — matches config::quarkrc::RcDirective (tagged union) */
export type RcDirective =
  | { type: "map"; map_type: MapType; noremap: boolean; key: string; action: string }
  | { type: "unmap"; map_type: MapType; key: string }
  | { type: "set"; name: string; value: OptionValue }
  | { type: "let"; name: string; value: string }
  | { type: "source"; path: string }
  | { type: "colorscheme"; name: string }
  | { type: "comment"; content: string };

export interface ParseError {
  line_number: number;
  line: string;
  message: string;
}

/** Parsed quarkrc file — matches config::quarkrc::ParsedRc */
export interface ParsedRc {
  directives: RcDirective[];
  errors: ParseError[];
}
