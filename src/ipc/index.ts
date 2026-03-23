// Main IPC module — re-exports everything from all IPC submodules.

// ─── Shared types ─────────────────────────────────────────────────────────────
export type {
  SessionInfo,
  RoomInfo,
  CreateRoomOptions,
  TimelineEvent,
  ReactionGroup,
  EmojiEntry,
  EmojiPack,
  MediaDownload,
  VerificationStatus,
  SpaceChild,
  ThreadRoot,
  GifResult,
  Mapping,
  MapType,
  Unmap,
  OptionValue,
  SetOption,
  LetBinding,
  SourceDirective,
  ColorschemeDiretive,
  RcDirective,
  ParseError,
  ParsedRc,
} from "./types.js";

// ─── Client (auth) ────────────────────────────────────────────────────────────
export { login, restoreSession, logout } from "./client.js";

// ─── Rooms ────────────────────────────────────────────────────────────────────
export { getRooms, joinRoom, leaveRoom, createRoom } from "./rooms.js";

// ─── Timeline ─────────────────────────────────────────────────────────────────
export {
  getTimeline,
  sendMessage,
  editMessage,
  redactMessage,
} from "./timeline.js";

// ─── Reactions ────────────────────────────────────────────────────────────────
export { sendReaction, getReactions } from "./reactions.js";

// ─── Emoji / Stickers ─────────────────────────────────────────────────────────
export {
  getEmojiPacks,
  getStickerPacks,
  getUserEmoji,
  getRoomEmoji,
} from "./emoji.js";

// ─── Media ────────────────────────────────────────────────────────────────────
export { downloadMedia, getThumbnail, uploadMedia } from "./media.js";

// ─── Crypto ───────────────────────────────────────────────────────────────────
export { getVerificationStatus, startSasVerification } from "./crypto.js";

// ─── Spaces ───────────────────────────────────────────────────────────────────
export {
  getSpaceHierarchy,
  getSpaceChildren,
  getSpaceRooms,
  getSubSpaces,
} from "./spaces.js";

// ─── Threads ──────────────────────────────────────────────────────────────────
export { getThreadRoots, getThreadTimeline } from "./threads.js";

// ─── GIF ──────────────────────────────────────────────────────────────────────
export { searchGifs } from "./gif.js";
export type { GifProvider } from "./gif.js";

// ─── Config ───────────────────────────────────────────────────────────────────
export { loadTheme, parseQuarkrc } from "./config.js";
