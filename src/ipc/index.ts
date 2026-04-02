// Main IPC module — re-exports everything from all IPC submodules.

// ─── Shared types ─────────────────────────────────────────────────────────────
export type {
  SessionInfo,
  OwnProfile,
  RoomInfo,
  CreateRoomOptions,
  RoomMember,
  TimelineEvent,
  ReactionGroup,
  EmojiEntry,
  EmojiPack,
  MediaDownload,
  VerificationStatus,
  CrossSigningInfo,
  SasInfo,
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
  PinnedEventInfo,
  PublicRoomInfo,
} from "./types.js";

// ─── Client (auth) ────────────────────────────────────────────────────────────
export { login, restoreSession, logout, getOwnProfile, setPresenceStatus } from "./client.js";

// ─── Rooms ────────────────────────────────────────────────────────────────────
export { getRooms, joinRoom, leaveRoom, createRoom, getRoomMembers, markRoomRead, getPinnedEvents, searchRoomDirectory } from "./rooms.js";

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
  sendSticker,
} from "./emoji.js";

// ─── Media ────────────────────────────────────────────────────────────────────
export { downloadMedia, getThumbnail, uploadMedia, sendPastedImage, getCacheStats, clearMediaCache, setCacheSizeLimit } from "./media.js";
export type { CacheStats } from "./media.js";

// ─── Notifications ────────────────────────────────────────────────────────────
export { getNotificationConfig, setNotificationConfig, muteRoomIpc, unmuteRoomIpc, testNotification } from "./notifications.js";
export type { NotificationConfig, QuietHours } from "./notifications.js";

// ─── Crypto ───────────────────────────────────────────────────────────────────
export {
  getVerificationStatus,
  getCrossSigningStatus,
  bootstrapCrossSigning,
  getUserDevices,
  startSasVerification,
  acceptVerificationRequest,
  acceptSasVerification,
  confirmSasVerification,
  cancelSasVerification,
  getSasInfo,
} from "./crypto.js";

// ─── Spaces ───────────────────────────────────────────────────────────────────
export {
  getSpaceHierarchy,
  getSpaceChildren,
  getSpaceRooms,
  getSubSpaces,
  getUserSpaces,
} from "./spaces.js";

// ─── Threads ──────────────────────────────────────────────────────────────────
export { getThreadRoots, getThreadTimeline } from "./threads.js";

// ─── GIF ──────────────────────────────────────────────────────────────────────
export { searchGifs, sendGif } from "./gif.js";
export type { GifProvider } from "./gif.js";

// ─── Config ───────────────────────────────────────────────────────────────────
export { loadTheme, parseQuarkrc } from "./config.js";
