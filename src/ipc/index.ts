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
  PowerLevels,
  RawStateEvent,
} from "./types.js";

// ─── Client (auth) ────────────────────────────────────────────────────────────
export { login, restoreSession, logout, getOwnProfile, setPresenceStatus, setDisplayName } from "./client.js";

// ─── Rooms ────────────────────────────────────────────────────────────────────
export { getRooms, joinRoom, leaveRoom, createRoom, getRoomMembers, markRoomRead, getPinnedEvents, searchRoomDirectory, inviteUser, kickUser, banUser, unbanUser } from "./rooms.js";

// ─── Timeline ─────────────────────────────────────────────────────────────────
export {
  getTimeline,
  getEventContext,
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
export { downloadMedia, getThumbnail, uploadMedia, sendPastedImage, sendFile, saveMediaToTemp, openMediaExternally, getCacheStats, clearMediaCache, setCacheSizeLimit, getUrlPreview } from "./media.js";
export type { CacheStats, UrlPreview } from "./media.js";

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
export { getThreadRoots, getThreadTimeline, sendThreadReplyIpc } from "./threads.js";

// ─── GIF ──────────────────────────────────────────────────────────────────────
export { searchGifs, sendGif } from "./gif.js";
export type { GifProvider } from "./gif.js";

// ─── Room Settings ────────────────────────────────────────────────────────────
export {
  getPowerLevels,
  setPowerLevels,
  setRoomName,
  setRoomTopic,
  setRoomJoinRule,
  setRoomHistoryVisibility,
  getRoomStateEvents,
  getRawEvent,
} from "./room_settings.js";

// ─── Config ───────────────────────────────────────────────────────────────────
export { loadTheme, parseQuarkrc } from "./config.js";
export { getAppConfig, setAppConfig, DEFAULT_APP_CONFIG } from "./app_config.js";
export type { AppConfig, GeneralConfig, SyncConfig, MediaConfig, GifConfig, GifRating, EmojiConfig } from "./app_config.js";
