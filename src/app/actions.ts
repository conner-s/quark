// Action dispatcher — connects IPC calls to UI state updates

import { AppState } from "./state.js";

import { saveSession, clearSession } from "./session.js";

import {
  login as ipcLogin,
  restoreSession as ipcRestoreSession,
  logout as ipcLogout,
  getOwnProfile,
  setPresenceStatus as ipcSetPresenceStatus,
  getRooms,
  getRoomMembers,
  getTimeline,
  sendMessage as ipcSendMessage,
  sendReaction as ipcSendReaction,
  editMessage as ipcEditMessage,
  redactMessage as ipcRedactMessage,
  getSpaceChildren,
  getUserSpaces,
  joinRoom as ipcJoinRoom,
  leaveRoom,
  createRoom,
  markRoomRead,
  getThreadTimeline,
  sendThreadReplyIpc,
  loadTheme as ipcLoadTheme,
  getCrossSigningStatus,
  bootstrapCrossSigning,
  getUserDevices,
  startSasVerification,
  acceptVerificationRequest,
  acceptSasVerification,
  confirmSasVerification,
  cancelSasVerification,
  getSasInfo,
  searchGifs,
  sendGif as ipcSendGif,
  getThumbnail,
  downloadMedia,
  saveMediaToTemp,
  openMediaExternally,
  sendPastedImage,
  sendFile,
  getEmojiPacks,
  getStickerPacks,
  sendSticker as ipcSendSticker,
  getEventContext,
} from "../ipc/index.js";

import { applyTheme } from "../theme/loader.js";
import { BUILTIN_THEME_MAP } from "../theme/builtins.js";
import { getAppConfig } from "../ipc/app_config.js";
import { setCurrentThemeName } from "../ui/SettingsDialog.js";
import { registerAnimatedUrl } from "./animated_urls.js";

import type { AppComponents } from "../ui/App.js";
import type { RoomInfo, TimelineEvent, RoomMember } from "../ipc/types.js";
import type { ParsedCommand } from "../vim/commands.js";

import { showToast, showError, showSuccess } from "../ui/NotificationToast.js";
import { showMainLayout } from "../ui/App.js";

// UI component types for building display data
import type { RoomEntry, RoomSection } from "../ui/RoomList.js";
import type { MessageData, ReplyPreviewData } from "../ui/Timeline.js";
import type { MemberEntry } from "../ui/MemberList.js";
import type { SpaceItem } from "../ui/SpaceStrip.js";
import type { EmojiEntry, EmojiPickerCategory, StickerEntry } from "../ui/EmojiPicker.js";
import type { CustomEmojiEntry } from "../ui/QuickReactPicker.js";
import { BUILTIN_EMOJI, EMOJI_CATEGORIES } from "../data/unicode-emoji.js";

// ── Own-sent event deduplication ─────────────────────────────────────────────

/**
 * Event IDs of messages sent by this client that are awaiting their sync echo.
 * The sync handler checks this set and skips appending the echo to avoid
 * showing a duplicate alongside the already-visible optimistic message.
 */
const _ownSentEventIds = new Set<string>();

/**
 * Consume an event ID from the own-sent set.
 * Returns true (and removes the ID) if this event was sent by us,
 * false otherwise.
 */
export function consumeOwnSentEvent(eventId: string): boolean {
  return _ownSentEventIds.delete(eventId);
}

// ── Pagination state ──────────────────────────────────────────────────────────

/** Pagination token for loading older messages; null when at the start of history. */
let _prevBatch: string | null = null;
/** Pagination token for loading newer messages; only set when in context view. */
let _nextBatch: string | null = null;
/** True when the timeline is showing a context window around a jumped-to message, not the live end. */
let _inContextView = false;
/** Prevents concurrent "load more" fetches. */
let _paginationLoading = false;

// ── Member caches ─────────────────────────────────────────────────────────────

/** userId → display name, populated when room members are fetched */
const _memberDisplayName = new Map<string, string>();
/** userId → mxc:// URL, populated when room members are fetched */
const _memberAvatarMxc = new Map<string, string>();
/** mxc:// URL → blob: URL, populated as thumbnails are downloaded */
const _avatarDataUrl = new Map<string, string>();
/** roomId → resolved blob: URL for the room avatar */
const _roomAvatarDataUrl = new Map<string, string>();
/** userId → known DM room ID, populated when a DM room is entered */
const _dmRoomByUser = new Map<string, string>();

/**
 * Convert a downloaded media blob to a Blob URL.
 * Blob URLs avoid synchronous base64 decoding when assigned to img.src,
 * which can take ~5ms per image in WebKitGTK.
 */
function _mediaToBlobUrl(mimeType: string, base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  if (mimeType === "image/gif" || mimeType === "image/webp") {
    registerAnimatedUrl(url);
  }
  return url;
}

/** Resolve a user ID to its display name, falling back to the raw ID. */
export function resolveDisplayName(userId: string): string {
  return _memberDisplayName.get(userId) ?? userId;
}

// ── Constants ────────────────────────────────────────────────────────────────
const THUMBNAIL_SIZE = 64;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert IPC RoomInfo → RoomList RoomEntry */
function roomInfoToEntry(r: RoomInfo): RoomEntry {
  return {
    id: r.room_id,
    name: r.name ?? r.room_id,
    unreadCount: r.unread_count,
    mentionCount: r.notification_count,
    muted: false,
  };
}

/** Build a map of thread root event IDs → reply count from a batch of events. */
function _buildThreadRootCounts(events: TimelineEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.thread_root) {
      counts.set(e.thread_root, (counts.get(e.thread_root) ?? 0) + 1);
    }
  }
  return counts;
}

/** Convert IPC TimelineEvent → Timeline MessageData */
function timelineEventToMessage(e: TimelineEvent, allEvents?: TimelineEvent[], threadRootCounts?: Map<string, number>): MessageData {
  const msgType = (() => {
    if (e.msg_type === "m.image") return "image" as const;
    if (e.msg_type === "m.sticker") return "sticker" as const;
    if (e.msg_type === "m.video") return "video" as const;
    if (e.msg_type === "m.file") return "file" as const;
    return "text" as const;
  })();

  let replyTo: ReplyPreviewData | undefined;
  if (e.in_reply_to && allEvents) {
    const parent = allEvents.find((ev) => ev.event_id === e.in_reply_to);
    if (parent) {
      replyTo = {
        eventId: parent.event_id,
        senderName: resolveDisplayName(parent.sender),
        body: parent.body.slice(0, 80),
      };
    }
  }

  // Resolve avatar: prefer cached data URL, then mock-injected URL (dev mode)
  const mxcUrl = _memberAvatarMxc.get(e.sender);
  const senderAvatarUrl =
    (mxcUrl && _avatarDataUrl.get(mxcUrl)) ??
    ((e as unknown as Record<string, unknown>)["_mock_avatar_url"] as string | undefined);

  const ownUserId = AppState.get("ownUserId");

  return {
    id: e.event_id,
    senderId: e.sender,
    senderName: resolveDisplayName(e.sender),
    senderAvatarUrl,
    isOwn: ownUserId ? e.sender === ownUserId : false,
    timestamp: new Date(e.timestamp).toISOString(),
    body: e.body,
    htmlBody: e.formatted_body ?? undefined,
    type: msgType,
    mediaUrl: e.media_url ?? undefined,
    mediaMimeType: e.media_mimetype ?? undefined,
    mediaEncryptionInfo: e.media_encryption_info ?? undefined,
    mediaThumbnailUrl: e.media_thumbnail_url ?? undefined,
    mediaThumbnailEncryptionInfo: e.media_thumbnail_encryption_info ?? undefined,
    reactions: e.reactions?.map((r) => ({
      key: r.key,
      count: r.count,
      own: r.own,
      imageUrl: _resolveReactionImage(r.key),
    })),
    replyTo,
    isThreadRoot: threadRootCounts ? threadRootCounts.has(e.event_id) : undefined,
    threadReplyCount: threadRootCounts?.get(e.event_id),
  };
}

// ── Module-level components reference ────────────────────────────────────────

let _components: AppComponents | null = null;

export function setComponents(components: AppComponents): void {
  _components = components;
}

function getComponents(): AppComponents {
  if (!_components) throw new Error("Actions: components not set");
  return _components;
}

// ── Actions ───────────────────────────────────────────────────────────────────

/** Fetch own profile and store userId + displayName in AppState. Non-critical. */
async function _loadOwnProfile(): Promise<void> {
  try {
    const profile = await getOwnProfile();
    AppState.set("ownUserId", profile.user_id);
    AppState.set("ownDisplayName", profile.display_name);
  } catch {
    // Non-critical — sendMessage falls back to user ID string
  }
}

/**
 * Attempt password login. On success, transitions to main layout and loads rooms.
 */
export async function login(homeserver: string, username: string, password: string): Promise<void> {
  const { loginScreen } = getComponents();
  loginScreen.setLoading(true);

  try {
    const session = await ipcLogin(homeserver, username, password);
    saveSession(session);
    AppState.set("loggedIn", true);

    showMainLayout(getComponents());
    loginScreen.hide();

    void _loadOwnProfile();
    await loadThemeFromConfig();
    await refreshRooms();

    showSuccess("Connected successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loginScreen.setStatus(message, "error");
  } finally {
    loginScreen.setLoading(false);
  }
}

/**
 * Attempt to restore a previously saved session. Returns true on success.
 * Call this on startup before showing the login form.
 */
export async function attemptSessionRestore(components: import("../ui/App.js").AppComponents): Promise<boolean> {
  const { loadSession } = await import("./session.js");
  const session = loadSession();
  if (!session) return false;

  try {
    await ipcRestoreSession(session.homeserver_url, session);
    AppState.set("loggedIn", true);
    showMainLayout(components);
    void _loadOwnProfile();
    await loadThemeFromConfig();
    await refreshRooms();
    return true;
  } catch (err) {
    // Stale/invalid session — clear it and fall through to login form
    clearSession();
    console.warn("Session restore failed, showing login:", err);
    return false;
  }
}

/**
 * Logout: revoke server session, clear local session, show login screen.
 */
export async function logout(): Promise<void> {
  try {
    await ipcLogout();
  } catch (err) {
    console.warn("Logout IPC failed (continuing anyway):", err);
  }
  clearSession();
  AppState.set("loggedIn", false);
  window.location.reload();
}

/**
 * Select a room: fetch timeline, update header, mark read.
 */
export async function selectRoom(roomId: string): Promise<void> {
  const { roomList, roomHeader, timeline, memberList, statusBar, typingIndicator } = getComponents();
  const prevRoom = AppState.get("currentRoomId");

  AppState.set("currentRoomId", roomId);
  AppState.set("activePanel", "timeline");
  if (AppState.get("threadRootEventId")) closeThread();
  _prevBatch = null;
  _nextBatch = null;
  _inContextView = false;
  _paginationLoading = false;
  roomList.setActiveRoom(roomId);

  // Show skeleton immediately before the async IPC fetch so the timeline doesn't
  // appear blank while waiting for message data.
  timeline.showSkeleton();

  // Clear typing indicator when switching rooms
  const typingTextEl = typingIndicator.querySelector(".typing-indicator__text");
  if (typingTextEl) typingTextEl.textContent = "";
  typingIndicator.classList.remove("typing-indicator--active");

  // Clear unread badge optimistically in local cache, then send read receipt.
  // Use updateRoomBadge (not setRooms) so the current space filter is preserved.
  const cached = AppState.get("roomListCache");
  if (cached.some((r) => r.room_id === roomId && (r.unread_count > 0 || r.notification_count > 0))) {
    AppState.set(
      "roomListCache",
      cached.map((r) =>
        r.room_id === roomId ? { ...r, unread_count: 0, notification_count: 0 } : r
      )
    );
    roomList.updateRoomBadge(roomId, 0, 0);
  }
  void markRoomRead(roomId).catch(() => {/* non-fatal: badge already cleared locally */});

  // Find room info in cache (re-read after potential update above)
  const updatedCache = AppState.get("roomListCache");
  const roomInfo = updatedCache.find((r) => r.room_id === roomId);
  const roomName = roomInfo?.name ?? roomId;

  // Pass a cached room avatar URL if one has already been resolved
  const cachedRoomAvatar = roomInfo?.room_id
    ? _roomAvatarDataUrl.get(roomInfo.room_id)
    : undefined;

  // Clear any DM avatar click handler from the previous room before rendering new avatar
  roomHeader.setAvatarClickHandler(null);
  roomHeader.setRoom(
    roomName,
    roomInfo?.topic ?? undefined,
    roomInfo?.member_count,
    roomInfo?.is_encrypted,
    cachedRoomAvatar
  );
  // Resolve the room avatar in the background if not already cached
  if (roomInfo?.avatar_url && roomInfo.room_id && !_roomAvatarDataUrl.has(roomInfo.room_id)) {
    const mxcUrl = roomInfo.avatar_url;
    const targetRoomId = roomInfo.room_id;
    void downloadMedia(mxcUrl).then((dl) => {
      const blobUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
      _roomAvatarDataUrl.set(targetRoomId, blobUrl);
      // Only update the header if the user is still looking at this room
      if (AppState.get("currentRoomId") === targetRoomId) {
        getComponents().roomHeader.setAvatarUrl(blobUrl);
      }
    }).catch(() => { /* non-fatal: fallback letter stays */ });
  }

  try {
    // Fetch timeline first for fast initial render; members come in parallel
    // but we don't wait for them before rendering (cached display names are used).
    const timelinePromise = getTimeline(roomId, { limit: 50 });
    const membersPromise = getRoomMembers(roomId).catch(() => [] as RoomMember[]);

    const page = await timelinePromise;
    const { events, prev_batch } = page;
    _prevBatch = prev_batch;

    AppState.set("currentTimeline", events);

    // Render with cached display names immediately — update once members arrive
    // Thread replies (thread_root set) are excluded from the main timeline;
    // they belong in the thread panel only.
    const threadRootCounts = _buildThreadRootCounts(events);
    const mainEvents = events.filter((e) => !e.thread_root);
    const messages = mainEvents.map((e) => timelineEventToMessage(e, events, threadRootCounts));
    // Pass unread count so the timeline can insert a "── new messages ──" separator
    if (roomInfo && roomInfo.unread_count > 0) {
      timeline.setUnreadCount(roomInfo.unread_count);
    }
    timeline.setMessages(messages);

    // Register scroll-to-top for pagination (re-registers on each room change)
    timeline.onScrollToTop(() => void loadMoreMessages());

    // Members arrive asynchronously — update display names and avatars when ready
    const members = await membersPromise;
    for (const m of members) {
      if (m.display_name) _memberDisplayName.set(m.user_id, m.display_name);
      if (m.avatar_url) _memberAvatarMxc.set(m.user_id, m.avatar_url);
    }

    // Update display names in place now that member data is available.
    // Avoids a full DOM rebuild — use targeted text swaps instead of setMessages.
    if (AppState.get("currentRoomId") === roomId) {
      // Accurate member count now available — update header in-place
      roomHeader.setMemberCount(members.length);
      for (const m of members) {
        if (m.display_name) {
          timeline.updateSenderName(m.user_id, m.display_name);
        }
      }

      // Populate the member list sidebar
      memberList.setMembers(members.map(roomMemberToEntry));

      // For DMs with no room avatar, use the other party's profile picture
      if (roomInfo?.is_direct && !roomInfo.avatar_url) {
        const ownUserId = AppState.get("ownUserId");
        const dmPartner = members.find((m) => m.user_id !== ownUserId);
        if (dmPartner) {
          const dmPartnerId = dmPartner.user_id;
          _dmRoomByUser.set(dmPartnerId, roomId);
          roomHeader.setAvatarClickHandler(() => void openProfileForUser(dmPartnerId));
          if (dmPartner.avatar_url) {
            const mxc = dmPartner.avatar_url;
            if (_roomAvatarDataUrl.has(roomId)) {
              roomHeader.setAvatarUrl(_roomAvatarDataUrl.get(roomId)!);
            } else {
              void downloadMedia(mxc).then((dl) => {
                const blobUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
                _roomAvatarDataUrl.set(roomId, blobUrl);
                if (AppState.get("currentRoomId") === roomId) {
                  roomHeader.setAvatarUrl(blobUrl);
                }
              }).catch(() => { /* non-fatal */ });
            }
          }
        }
      }

      // Download uncached avatar thumbnails in the background
      _downloadMemberAvatars(members, timeline);

      // Download mxc:// image content in the background
      _downloadMessageImages(events, timeline);

      // Resolve any mxc:// custom emoji used in reaction chips
      void _downloadReactionEmoji(events, timeline);

      // Resolve mxc:// URLs for inline custom emoji in formatted message bodies
      _downloadInlineEmoji(timeline);
    }
  } catch (err) {
    showError(`Failed to load timeline: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Cancel any active reply if we changed rooms
  if (prevRoom !== roomId) {
    cancelReply();
  }
}

/**
 * Load the next page of older messages for the current room and prepend them.
 * Called automatically when the user scrolls to the top of the timeline.
 *
 * If a fetched page contains no displayable messages (e.g. all reactions/state
 * events were filtered out) but history remains, we keep fetching until we
 * either find displayable messages or exhaust the history. This prevents the
 * loading spinner from disappearing with no result while `_scrollTopFired`
 * blocks re-triggering.
 */
async function loadMoreMessages(): Promise<void> {
  if (_paginationLoading || !_prevBatch) return;
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const { timeline } = getComponents();
  _paginationLoading = true;
  timeline.showLoadingMore();

  try {
    // Loop to skip over pages whose events are all non-displayable (reactions,
    // state events, etc. that get filtered by the Rust backend). Cap iterations
    // to avoid a runaway loop on pathological room histories.
    const MAX_EMPTY_PAGES = 10;
    let emptyPages = 0;

    while (_prevBatch && roomId === AppState.get("currentRoomId")) {
      const page = await getTimeline(roomId, { limit: 50, before: _prevBatch });
      _prevBatch = page.prev_batch;

      if (page.events.length === 0) {
        emptyPages++;
        if (!_prevBatch || emptyPages >= MAX_EMPTY_PAGES) break;
        // History remains but page was all filtered events — keep going
        continue;
      }

      const existingEvents = AppState.get("currentTimeline");
      AppState.set("currentTimeline", [...page.events, ...existingEvents]);

      const threadRootCounts = _buildThreadRootCounts(page.events);
      const mainEvents = page.events.filter((e) => !e.thread_root);
      const messages = mainEvents.map((e) => timelineEventToMessage(e, page.events, threadRootCounts));
      timeline.prependMessages(messages);

      _downloadMessageImages(page.events, timeline);
      _downloadInlineEmoji(timeline);
      void _downloadReactionEmoji(page.events, timeline);
      break;
    }
  } catch (err) {
    showError(`Failed to load more messages: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    _paginationLoading = false;
    timeline.hideLoadingMore();
  }
}

/**
 * Jump to a specific message by event ID.
 * If already rendered, scrolls to it. Otherwise fetches surrounding context from
 * the server and rebuilds the timeline centered on the target message.
 */
export async function jumpToMessage(eventId: string): Promise<void> {
  const { timeline } = getComponents();
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  // Fast path — message is already rendered
  if (timeline.scrollToMessage(eventId)) return;

  // Fetch context around the target event and rebuild the timeline
  try {
    const ctx = await getEventContext(roomId, eventId, 25);

    _prevBatch = ctx.prev_batch;
    _nextBatch = ctx.next_batch;
    _inContextView = ctx.next_batch !== null;

    AppState.set("currentTimeline", ctx.events);
    const threadRootCounts = _buildThreadRootCounts(ctx.events);
    const mainEvents = ctx.events.filter((e) => !e.thread_root);
    const messages = mainEvents.map((e) => timelineEventToMessage(e, ctx.events, threadRootCounts));
    timeline.setMessages(messages);
    timeline.setContextView(_inContextView);
    timeline.scrollToMessage(eventId);

    _downloadMessageImages(ctx.events, timeline);
    _downloadInlineEmoji(timeline);
    void _downloadReactionEmoji(ctx.events, timeline);
  } catch (err) {
    showError(`Failed to load message: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Jump back to the live end of the timeline (latest messages).
 * Called when the user presses the "jump to latest" button or G in context view.
 */
export async function jumpToLatest(): Promise<void> {
  const { timeline } = getComponents();
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  if (!_inContextView) {
    // Not in context view — just scroll to the bottom of what's loaded
    timeline.selectLast();
    return;
  }

  try {
    const page = await getTimeline(roomId, { limit: 50 });
    _prevBatch = page.prev_batch;
    _nextBatch = null;
    _inContextView = false;

    AppState.set("currentTimeline", page.events);
    const threadRootCounts = _buildThreadRootCounts(page.events);
    const mainEvents = page.events.filter((e) => !e.thread_root);
    const messages = mainEvents.map((e) => timelineEventToMessage(e, page.events, threadRootCounts));
    timeline.setMessages(messages);
    timeline.setContextView(false);
    timeline.selectLast();

    _downloadMessageImages(page.events, timeline);
    _downloadInlineEmoji(timeline);
    void _downloadReactionEmoji(page.events, timeline);
  } catch (err) {
    showError(`Failed to load latest messages: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Select a space: fetch children, filter room list.
 */
export async function selectSpace(spaceId: string): Promise<void> {
  const { spaceStrip, roomList } = getComponents();
  AppState.set("currentSpaceId", spaceId);
  spaceStrip.setActiveSpace(spaceId);

  if (spaceId === "__home__") {
    // Show rooms that are NOT in any space (and include DMs), sorted by recent activity
    const allRooms = AppState.get("roomListCache");
    const spaceRoomIds = new Set(AppState.get("spaceRoomIds"));
    const homeRooms = allRooms
      .filter((r) => r.is_direct || !spaceRoomIds.has(r.room_id))
      .sort((a, b) => {
        const aTs = a.last_activity_ts ?? 0;
        const bTs = b.last_activity_ts ?? 0;
        if (bTs !== aTs) return bTs - aTs;
        const aScore = a.notification_count * 2 + a.unread_count;
        const bScore = b.notification_count * 2 + b.unread_count;
        if (bScore !== aScore) return bScore - aScore;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });
    roomList.setRooms(homeRooms.map(roomInfoToEntry));
    AppState.focusPanel("roomlist");
    return;
  }

  if (spaceId === "__dms__") {
    const allRooms = AppState.get("roomListCache");
    const dms = allRooms
      .filter((r) => r.is_direct)
      .sort((a, b) => {
        // Primary: most recent activity first (last_activity_ts descending)
        const aTs = a.last_activity_ts ?? 0;
        const bTs = b.last_activity_ts ?? 0;
        if (bTs !== aTs) return bTs - aTs;
        // Fallback: unread/notification score descending
        const aScore = a.notification_count * 2 + a.unread_count;
        const bScore = b.notification_count * 2 + b.unread_count;
        if (bScore !== aScore) return bScore - aScore;
        // Final tiebreak: alphabetical
        return (a.name ?? "").localeCompare(b.name ?? "");
      })
      .map(roomInfoToEntry);
    roomList.setRooms(dms);
    AppState.focusPanel("roomlist");
    return;
  }

  try {
    const children = await getSpaceChildren(spaceId);
    // The backend already sorts by m.space.child order field (then alphabetically).
    const cache = AppState.get("roomListCache");
    const cacheById = new Map(cache.map((r) => [r.room_id, r]));

    // Check if there are any subspaces — if so, render as categories
    const subspaces = children.filter((c) => c.is_space);
    const topRooms = children.filter((c) => !c.is_space);

    if (subspaces.length > 0) {
      // Build sections: top-level rooms first (unlabeled), then each subspace as a category
      const sections: RoomSection[] = [];

      // Top-level rooms (not in any subspace) — unlabeled section
      const topEntries = topRooms.flatMap((c) => {
        const r = cacheById.get(c.room_id);
        return r ? [roomInfoToEntry(r)] : [];
      });
      if (topEntries.length > 0) {
        sections.push({ label: "", rooms: topEntries });
      }

      // Each subspace becomes a labeled category
      await Promise.all(subspaces.map(async (sub) => {
        try {
          const subChildren = await getSpaceChildren(sub.room_id);
          const subRooms = subChildren
            .filter((c) => !c.is_space)
            .flatMap((c) => {
              const r = cacheById.get(c.room_id);
              return r ? [roomInfoToEntry(r)] : [];
            });
          sections.push({ label: sub.name ?? sub.room_id, rooms: subRooms });
        } catch {
          // Skip subspace on error
        }
      }));

      roomList.setSections(sections);
    } else {
      const ordered = topRooms.flatMap((c) => {
        const r = cacheById.get(c.room_id);
        return r ? [roomInfoToEntry(r)] : [];
      });
      roomList.setRooms(ordered);
    }

    AppState.focusPanel("roomlist");
  } catch (err) {
    showError(`Failed to load space: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Send a message in the current room. Optimistically appends to timeline.
 */
export async function sendMessage(body: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId || !body.trim()) return;

  // Route to thread when one is open.
  const threadRootId = AppState.get("threadRootEventId");
  if (threadRootId) {
    await sendThreadReply(body, threadRootId, roomId);
    return;
  }

  const { timeline, input, replyPreview } = getComponents();
  const replyToEventId = AppState.get("replyToEventId");

  const composeBoxEl = input.getComposeBoxElement();
  const composeRect = composeBoxEl.getBoundingClientRect();

  let replyTo: ReplyPreviewData | undefined;
  if (replyToEventId) {
    const events = AppState.get("currentTimeline");
    const parent = events.find((e) => e.event_id === replyToEventId);
    if (parent) {
      replyTo = { eventId: parent.event_id, senderName: parent.sender, body: parent.body.slice(0, 80) };
    }
  }

  const ownUserId = AppState.get("ownUserId");
  const ownDisplayName = AppState.get("ownDisplayName");
  const ownSenderName = ownDisplayName ?? ownUserId ?? "you";

  const ownAvatarMxc = ownUserId ? _memberAvatarMxc.get(ownUserId) : undefined;
  const ownAvatarUrl = (ownAvatarMxc && _avatarDataUrl.get(ownAvatarMxc)) ?? undefined;

  // Build the formatted body before constructing the optimistic message so the
  // inline custom emoji (<img data-mx-emoticon>) are rendered immediately in the
  // timeline rather than appearing as plain `:shortcode:` text until the sync echo.
  const formattedBody = _buildFormattedBodyWithEmoji(body);

  const optimisticMsg: MessageData = {
    id: `optimistic-${Date.now()}`,
    senderId: ownUserId ?? undefined,
    senderName: ownSenderName,
    senderAvatarUrl: ownAvatarUrl,
    isOwn: true,
    timestamp: new Date().toISOString(),
    body,
    htmlBody: formattedBody,
    type: "text",
    replyTo,
  };
  timeline.appendMessageHidden(optimisticMsg);

  // Determine if this merged into an existing bubble or created a new one
  const hiddenEl = timeline.getLastHiddenEl();
  const isMerge = !!hiddenEl && !hiddenEl.classList.contains("message-group-wrapper");

  input.setValue("");

  if (isMerge) {
    // ── Merge: border fades out, text clone flies up into the bubble ─────────
    const fieldEl = input.getFieldElement();
    const fieldRect = fieldEl.getBoundingClientRect();
    const targetBodyEl = hiddenEl?.querySelector<HTMLElement>(".message__body");
    const targetRect = targetBodyEl?.getBoundingClientRect() ?? null;

    // Create a fixed text clone positioned over the input field
    const textClone = document.createElement("div");
    textClone.textContent = body;
    const fieldStyle = getComputedStyle(fieldEl);
    Object.assign(textClone.style, {
      position: "fixed",
      left: `${fieldRect.left + parseFloat(fieldStyle.paddingLeft)}px`,
      top: `${fieldRect.top + parseFloat(fieldStyle.paddingTop)}px`,
      maxWidth: `${fieldRect.width - parseFloat(fieldStyle.paddingLeft) - parseFloat(fieldStyle.paddingRight)}px`,
      fontFamily: fieldStyle.fontFamily,
      fontSize: fieldStyle.fontSize,
      lineHeight: fieldStyle.lineHeight,
      color: fieldStyle.color,
      padding: "0",
      margin: "0",
      zIndex: "500",
      pointerEvents: "none",
      background: "transparent",
      whiteSpace: "pre-wrap",
      overflow: "hidden",
    });
    document.body.appendChild(textClone);

    input.animateMerge();

    if (targetRect) {
      const dx = targetRect.left - fieldRect.left - parseFloat(fieldStyle.paddingLeft);
      const dy = targetRect.top - fieldRect.top - parseFloat(fieldStyle.paddingTop);

      const DURATION = 260;

      const anim = textClone.animate(
        [
          { transform: "translate(0, 0)" },
          { transform: `translate(${dx}px, ${dy}px)` },
        ],
        { duration: DURATION, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" }
      );

      void anim.finished.then(() => {
        timeline.showLastHiddenMessage(hiddenEl ?? undefined);
        requestAnimationFrame(() => textClone.remove());
      });
    } else {
      textClone.remove();
      timeline.showLastHiddenMessage(hiddenEl ?? undefined);
    }
  } else {
    // ── New group: clone compose box (+ reply bar if replying) and fly up ────
    // appendMessageHidden() did an instant scroll so hiddenEl's layout position
    // is accurate right now (counter-animation is deferred to the next rAF).
    const targetGroupEl = hiddenEl?.querySelector<HTMLElement>(".message-group") ?? hiddenEl;
    const targetRect = targetGroupEl?.getBoundingClientRect();

    if (replyToEventId && replyPreview.isVisible()) {
      // ── Reply send: fly a combined [reply-bar + compose-box] clone so the
      // quoted preview visually travels into the timeline with the message text.
      const replyBarEl = replyPreview.getElement();
      const replyBarRect = replyBarEl.getBoundingClientRect();
      // Natural pixel gap between the reply bar bottom and the compose box top.
      const gap = Math.max(0, composeRect.top - replyBarRect.bottom);
      const startH = replyBarRect.height + gap + composeRect.height;

      // Clone the reply bar (strip its layout margins; wrapper controls position)
      const replyBarClone = replyBarEl.cloneNode(true) as HTMLElement;
      replyBarClone.style.margin = "0";
      replyBarClone.style.flexShrink = "0";

      // Clone the compose box with the typed text
      const composeClone = composeBoxEl.cloneNode(true) as HTMLElement;
      const cloneField2 = composeClone.querySelector<HTMLInputElement>("input");
      if (cloneField2) cloneField2.value = body;
      Object.assign(composeClone.style, {
        margin: "0",
        flex: "",
        flexShrink: "0",
        width: `${composeRect.width}px`,
        height: `${composeRect.height}px`,
        background: getComputedStyle(composeBoxEl).backgroundColor || "var(--bg)",
      });

      // Wrapper: fixed column containing [reply-bar, gap-spacer, compose-box]
      const combinedClone = document.createElement("div");
      Object.assign(combinedClone.style, {
        position: "fixed",
        top: `${replyBarRect.top}px`,
        left: `${replyBarRect.left}px`,
        width: `${replyBarRect.width}px`,
        height: `${startH}px`,
        zIndex: "500",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      });
      combinedClone.appendChild(replyBarClone);
      if (gap > 0) {
        const spacer = document.createElement("div");
        spacer.style.cssText = `height:${gap}px;flex-shrink:0`;
        combinedClone.appendChild(spacer);
      }
      combinedClone.appendChild(composeClone);
      document.body.appendChild(combinedClone);

      // Hide originals: compose box via opacity (keeps layout); reply bar via
      // visibility (also keeps layout so that cancelReply below can collapse it
      // without the UI jumping before we've measured the target position).
      composeBoxEl.style.opacity = "0";
      replyBarEl.style.visibility = "hidden";

      // Cancel the reply state NOW so the reply bar collapses from the layout
      // before we measure deltaY. If we defer this to anim.finished, the bar's
      // ~30px height is removed at that point: the timeline grows, scrollTop is
      // clamped down, and the target message shifts ~30px below where the clone
      // landed — producing the visible downward jump.
      cancelReply();

      // Measure target after layout has settled. Align the clone's reply bar
      // with the .reply-preview element inside the target bubble (not the
      // message-group border, which sits above the reply preview by ~13px).
      const inlineReplyEl = hiddenEl?.querySelector<HTMLElement>(".reply-preview");
      const alignTop = inlineReplyEl
        ? inlineReplyEl.getBoundingClientRect().top
        : (targetRect?.top ?? composeRect.top - 60);
      const deltaY = alignTop - replyBarRect.top;

      // Slide the clone up — pure translation, no size/border morphing.
      // Remove + reveal in the same synchronous tick so the browser paints both
      // in one frame with no visible gap.
      const anim = combinedClone.animate(
        [
          { transform: "translate(0,0)" },
          { transform: `translate(0,${deltaY}px)` },
        ],
        { duration: 260, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" }
      );

      void anim.finished.then(() => {
        combinedClone.remove();
        timeline.showLastHiddenMessage(hiddenEl ?? undefined);
        replyBarEl.style.visibility = "";
        composeBoxEl.style.opacity = "";
        input.animateSent();
      });
    } else {
      // ── Normal send: fly the compose box clone alone ──────────────────────
      const deltaY = (targetRect?.top ?? composeRect.top - 60) - composeRect.top;

      const clone = composeBoxEl.cloneNode(true) as HTMLElement;
      const cloneField = clone.querySelector<HTMLInputElement>("input");
      if (cloneField) cloneField.value = body;
      Object.assign(clone.style, {
        position: "fixed",
        left: `${composeRect.left}px`,
        top: `${composeRect.top}px`,
        width: `${composeRect.width}px`,
        height: `${composeRect.height}px`,
        margin: "0",
        zIndex: "500",
        pointerEvents: "none",
        boxSizing: "border-box",
        background: getComputedStyle(composeBoxEl).backgroundColor || "var(--bg)",
      });
      document.body.appendChild(clone);
      composeBoxEl.style.opacity = "0";

      const anim = clone.animate(
        [
          { transform: "translate(0,0)", borderRadius: "0px 8px 8px 0px" },
          { transform: `translate(0,${deltaY}px)`, borderRadius: "8px" },
        ],
        { duration: 260, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" }
      );

      void anim.finished.then(() => {
        clone.remove();
        timeline.showLastHiddenMessage(hiddenEl ?? undefined);
        composeBoxEl.style.opacity = "";
        input.animateSent();
      });
    }
  }

  // Resolve inline emoji in the optimistic message now that it's in the DOM.
  // This converts the data-mxc attributes set by Timeline into actual image srcs.
  {
    const { timeline: tl } = getComponents();
    _downloadInlineEmoji(tl);
  }

  try {
    const eventId = await ipcSendMessage(roomId, body, formattedBody, replyToEventId ?? undefined);
    // Promote the optimistic message to its real server-assigned event ID and
    // register it so the sync echo is ignored (preventing a duplicate).
    const { timeline } = getComponents();
    timeline.confirmMessage(optimisticMsg.id, eventId);
    _ownSentEventIds.add(eventId);
  } catch (err) {
    showError(`Failed to send: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Send a reaction to an event. Optimistically updates the reaction bar so the
 * user gets immediate feedback before the server round-trip completes.
 */
export async function sendReaction(eventId: string, key: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  // Optimistic UI update ─────────────────────────────────────────────────────
  const { timeline } = getComponents();
  const events = AppState.get("currentTimeline");
  const targetEvent = events.find((e) => e.event_id === eventId);

  if (targetEvent) {
    const current = targetEvent.reactions ?? [];
    const existing = current.find((r) => r.key === key);

    let updated: typeof current;
    if (existing?.own) {
      // Toggle off — remove this user's reaction
      updated = current
        .map((r) => r.key === key ? { ...r, count: r.count - 1, own: false, own_event_id: null } : r)
        .filter((r) => r.count > 0);
    } else if (existing) {
      // Increment existing group
      updated = current.map((r) => r.key === key ? { ...r, count: r.count + 1, own: true } : r);
    } else {
      // Brand new reaction
      updated = [...current, { key, count: 1, senders: [], own: true, own_event_id: null }];
    }

    AppState.set(
      "currentTimeline",
      events.map((e) => (e.event_id === eventId ? { ...e, reactions: updated } : e))
    );

    timeline.updateMessageReactions(
      eventId,
      updated.map((r) => ({ key: r.key, count: r.count, own: r.own, imageUrl: _resolveReactionImage(r.key) }))
    );
  }

  try {
    const reactionEventId = await ipcSendReaction(roomId, eventId, key);
    // Pre-register so the sync echo of our own reaction is not double-counted.
    _seenReactionEventIds.add(reactionEventId);
  } catch (err) {
    showError(`Failed to react: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Return a cached data-URL for a reaction key that is an mxc:// URI,
 * or undefined for plain Unicode emoji.
 */
function _resolveReactionImage(key: string): string | undefined {
  if (!key.startsWith("mxc://")) return undefined;
  return _emojiImageCache.get(key);
}

/** Cache: mxc:// URL → data: URL for custom emoji rendered in reaction chips */
const _emojiImageCache = new Map<string, string>();

/** Seen reaction event IDs — prevents double-counting sync echoes of own reactions. */
const _seenReactionEventIds = new Set<string>();

/**
 * Apply an incoming reaction from another user (received via sync event).
 * Deduplicates by reaction_event_id so own-reaction echoes are not double-counted.
 */
export function applyIncomingReaction(
  targetEventId: string,
  _sender: string,
  key: string,
  reactionEventId: string,
): void {
  if (_seenReactionEventIds.has(reactionEventId)) return;
  _seenReactionEventIds.add(reactionEventId);

  const { timeline } = getComponents();
  const events = AppState.get("currentTimeline");
  const targetEvent = events.find((e) => e.event_id === targetEventId);
  if (!targetEvent) return;

  const current = targetEvent.reactions ?? [];
  const existing = current.find((r) => r.key === key);
  let updated: typeof current;
  if (existing) {
    updated = current.map((r) => r.key === key ? { ...r, count: r.count + 1 } : r);
  } else {
    updated = [...current, { key, count: 1, senders: [], own: false, own_event_id: null }];
  }

  AppState.set(
    "currentTimeline",
    events.map((e) => (e.event_id === targetEventId ? { ...e, reactions: updated } : e))
  );

  timeline.updateMessageReactions(
    targetEventId,
    updated.map((r) => ({ key: r.key, count: r.count, own: r.own, imageUrl: _resolveReactionImage(r.key) }))
  );
}

/**
 * Start composing a reply to a message.
 */
export function startReply(eventId: string, senderName: string, snippet: string): void {
  const { replyPreview } = getComponents();
  AppState.set("replyToEventId", eventId);
  replyPreview.show({ eventId, senderName, snippet });
}

/**
 * Cancel the current reply without touching thread mode.
 */
export function cancelReply(): void {
  const { replyPreview } = getComponents();
  AppState.set("replyToEventId", null);
  // Don't hide if we're in thread mode — thread has its own banner.
  if (!replyPreview.isThreadMode()) {
    replyPreview.hide();
  }
}

/**
 * Edit an existing message.
 */
export async function editMessage(eventId: string, newBody: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  try {
    await ipcEditMessage(roomId, eventId, newBody);
    showSuccess("Message edited");
  } catch (err) {
    showError(`Failed to edit: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Apply a redaction from another user (incoming via sync).
 * Removes the message from the DOM and state cache.
 */
export function applyIncomingRedaction(eventId: string): void {
  const { timeline } = getComponents();
  timeline.removeMessage(eventId);
  AppState.set(
    "currentTimeline",
    AppState.get("currentTimeline").filter((e) => e.event_id !== eventId)
  );
}

/**
 * Redact (delete) a message.
 */
export async function redactMessage(eventId: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  try {
    await ipcRedactMessage(roomId, eventId);
    // Remove immediately from DOM and state cache
    const { timeline } = getComponents();
    timeline.removeMessage(eventId);
    AppState.set(
      "currentTimeline",
      AppState.get("currentTimeline").filter((e) => e.event_id !== eventId)
    );
    showSuccess("Message deleted");
  } catch (err) {
    showError(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Open the inline thread panel for a given root event.
 * The panel expands directly below the root message in the timeline.
 */
export async function openThread(eventId: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const { timeline } = getComponents();
  AppState.set("threadRootEventId", eventId);

  const ownUserId = AppState.get("ownUserId");

  // Show the thread banner in the reply-preview bar so the compose box is
  // visually marked as "sending to thread".
  const { replyPreview } = getComponents();
  const rootEvent = AppState.get("currentTimeline").find((e) => e.event_id === eventId);
  const rootSnippet = rootEvent ? rootEvent.body.slice(0, 80) : "";
  replyPreview.showThread(rootSnippet);

  try {
    const replies = await getThreadTimeline(roomId, eventId);
    const replyData = replies.map((e) => ({
      id: e.event_id,
      senderName: resolveDisplayName(e.sender),
      isOwn: ownUserId ? e.sender === ownUserId : false,
      timestamp: new Date(e.timestamp).toISOString(),
      body: e.body,
      htmlBody: e.formatted_body ?? undefined,
      type: (e.msg_type === "m.image" ? "image" : e.msg_type === "m.sticker" ? "sticker" : e.msg_type === "m.video" ? "video" : e.msg_type === "m.file" ? "file" : "text") as "text" | "image" | "sticker" | "video" | "file",
      mediaUrl: e.media_url ?? undefined,
      mediaAlt: e.body,
      mediaMimeType: e.media_mimetype ?? undefined,
      mediaEncryptionInfo: e.media_encryption_info ?? undefined,
      mediaThumbnailUrl: e.media_thumbnail_url ?? undefined,
      mediaThumbnailEncryptionInfo: e.media_thumbnail_encryption_info ?? undefined,
    }));
    timeline.openInlineThread(eventId, replyData);
    _downloadMessageImages(replies, {
      updateMessageMedia: (id: string, url: string) => timeline.updateInlineThreadMedia(id, url),
    });
  } catch (err) {
    showError(`Failed to load thread: ${err instanceof Error ? err.message : String(err)}`);
    replyPreview.hide();
  }
}

/**
 * Close the inline thread panel.
 */
export function closeThread(): void {
  const { timeline, replyPreview } = getComponents();
  AppState.set("threadRootEventId", null);
  timeline.closeInlineThread();
  if (replyPreview.isThreadMode()) replyPreview.hide();
}

/**
 * Send a reply into the open inline thread.
 * Uses a text-clone fly animation from the compose field to the thread panel.
 */
async function sendThreadReply(body: string, threadRootId: string, roomId: string): Promise<void> {
  const { timeline, input } = getComponents();
  const ownUserId = AppState.get("ownUserId");
  const ownName = AppState.get("ownDisplayName") ?? ownUserId ?? "me";

  const optimisticId = `local-thread-${Date.now()}`;
  const optimisticMsg = {
    id: optimisticId,
    senderName: ownName,
    isOwn: true,
    timestamp: new Date().toISOString(),
    body,
  };

  // Append hidden to thread panel so we can measure its position.
  timeline.appendInlineReply(optimisticMsg);
  // Optimistically update the reply count indicator on the thread root.
  timeline.incrementThreadReplyCount(threadRootId);

  const fieldEl = input.getFieldElement();
  const fieldRect = fieldEl.getBoundingClientRect();
  const fieldStyle = getComputedStyle(fieldEl);

  // Find the just-appended message element's body as the target.
  const targetEl = timeline.getInlineThreadMessageEl(optimisticId);
  const targetRect = targetEl?.getBoundingClientRect() ?? null;

  input.setValue("");

  // Fly a text clone from the compose field to the target in the thread panel.
  const textClone = document.createElement("div");
  textClone.textContent = body;
  Object.assign(textClone.style, {
    position: "fixed",
    left: `${fieldRect.left + parseFloat(fieldStyle.paddingLeft)}px`,
    top: `${fieldRect.top + parseFloat(fieldStyle.paddingTop)}px`,
    maxWidth: `${fieldRect.width - parseFloat(fieldStyle.paddingLeft) - parseFloat(fieldStyle.paddingRight)}px`,
    fontFamily: fieldStyle.fontFamily,
    fontSize: fieldStyle.fontSize,
    lineHeight: fieldStyle.lineHeight,
    color: "var(--msg-thread-indicator)",
    padding: "0",
    margin: "0",
    zIndex: "500",
    pointerEvents: "none",
    background: "transparent",
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    opacity: "0.9",
  });
  document.body.appendChild(textClone);

  if (targetRect) {
    const dx = targetRect.left - fieldRect.left - parseFloat(fieldStyle.paddingLeft);
    const dy = targetRect.top - fieldRect.top - parseFloat(fieldStyle.paddingTop);

    const anim = textClone.animate(
      [
        { transform: "translate(0,0)", opacity: "0.9" },
        { transform: `translate(${dx}px,${dy}px)`, opacity: "0" },
      ],
      { duration: 240, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" }
    );
    void anim.finished.then(() => textClone.remove());
  } else {
    textClone.remove();
  }

  input.animateSent();

  const threadFormattedBody = _buildFormattedBodyWithEmoji(body);

  try {
    const eventId = await sendThreadReplyIpc(roomId, threadRootId, body, threadFormattedBody);
    _ownSentEventIds.add(eventId);
  } catch (err) {
    showError(`Failed to send thread reply: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Emoji picker state ────────────────────────────────────────────────────────

/** Whether the EmojiPicker callbacks have been wired (one-time setup). */
let _emojiPickerWired = false;

/** Cache of custom emoji categories per room ID (or "" for account-level). */
const _customEmojiCategoryCache = new Map<string, EmojiPickerCategory[]>();

/**
 * Map of shortcode → mxc:// URL for all loaded custom emoji.
 * Used to build formatted bodies with data-mx-emoticon when sending messages.
 * Populated when emoji packs are loaded; never replaced with data: URLs.
 */
const _shortcodeToMxc = new Map<string, string>();

/**
 * Scan `body` for `:shortcode:` patterns and, for any that match a known
 * custom emoji, return an HTML `formatted_body` string with each custom emoji
 * replaced by an `<img data-mx-emoticon>` tag (MSC2545 / Matrix custom emoji).
 *
 * Returns `undefined` if the body contains no resolvable custom emoji
 * shortcodes so the message is sent as plain text.
 */
function _buildFormattedBodyWithEmoji(body: string): string | undefined {
  const SHORTCODE_RE = /:([a-zA-Z0-9_-]+):/g;
  let hasCustom = false;

  // First pass: check if there are any resolvable shortcodes.
  let m: RegExpExecArray | null;
  while ((m = SHORTCODE_RE.exec(body)) !== null) {
    if (_shortcodeToMxc.has(m[1])) {
      hasCustom = true;
      break;
    }
  }
  if (!hasCustom) return undefined;

  // Second pass: build the HTML body.
  // Escape plain-text segments so they're safe in HTML.
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let html = "";
  let last = 0;
  SHORTCODE_RE.lastIndex = 0;
  while ((m = SHORTCODE_RE.exec(body)) !== null) {
    const [fullMatch, shortcode] = m;
    const mxc = _shortcodeToMxc.get(shortcode);
    html += escape(body.slice(last, m.index));
    if (mxc) {
      html += `<img data-mx-emoticon src="${mxc}" alt=":${shortcode}:" title=":${shortcode}:">`;
    } else {
      html += escape(fullMatch);
    }
    last = m.index + fullMatch.length;
  }
  html += escape(body.slice(last));
  return html;
}

/**
 * Show the emoji/sticker picker. Loads BUILTIN_EMOJI immediately and custom
 * emoji packs asynchronously. Wires callbacks on first call. Custom emoji
 * categories are cached per-room so they appear immediately on subsequent opens.
 */
export function openEmojiPicker(initialTab: "emoji" | "sticker" = "emoji"): void {
  const { emojiPicker, input } = getComponents();

  if (!_emojiPickerWired) {
    _emojiPickerWired = true;

    emojiPicker.onSelect((entry) => {
      const current = input.getValue();
      const insertion = entry.imageUrl ? `:${entry.shortcode}: ` : `${entry.key}`;
      input.setValue(current + insertion);
      input.focus();
    });

    emojiPicker.onTabChange((tab) => {
      // Only gif needs to close this picker and open another overlay
      if (tab === "gif") {
        emojiPicker.hide();
        openGifPicker();
      }
    });

    emojiPicker.onStickerTabActivated(() => {
      void _loadStickersIntoUnifiedPicker();
    });

    emojiPicker.onStickerSelect(async (sticker) => {
      const roomId = AppState.get("currentRoomId");
      if (!roomId) {
        showError("No room selected");
        return;
      }
      const sepIdx = sticker.id.lastIndexOf("::");
      const packId = sepIdx >= 0 ? sticker.id.slice(0, sepIdx) : sticker.id;
      const shortcode = sepIdx >= 0 ? sticker.id.slice(sepIdx + 2) : sticker.name;
      try {
        await ipcSendSticker(roomId, shortcode, sticker.url, sticker.name, packId, sticker.packName ?? null);
        showSuccess("Sticker sent");
      } catch (err) {
        showError(`Failed to send sticker: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  // Show builtin categories immediately so the picker opens without waiting
  const builtinCategories: EmojiPickerCategory[] = EMOJI_CATEGORIES.map((cat) => ({
    id: cat.id,
    icon: cat.icon,
    name: cat.name,
    entries: cat.entries.map(([shortcode, glyph]) => ({ key: glyph, shortcode })),
  }));
  emojiPicker.setCategories(builtinCategories);

  // Prepend cached custom categories immediately (avoids pop-in on repeat opens)
  const roomId = AppState.get("currentRoomId") ?? "";
  const cached = _customEmojiCategoryCache.get(roomId);
  if (cached && cached.length > 0) {
    emojiPicker.prependCategories(cached);
  }

  emojiPicker.show(initialTab);

  // Async: load custom emoji packs, update cache, and prepend into picker
  getEmojiPacks(roomId || undefined)
    .then(async (packs) => {
      const customCategories: EmojiPickerCategory[] = [];
      for (const pack of packs) {
        const entries: EmojiEntry[] = pack.emojis
          .filter((e) => e.usage.includes("emoticon"))
          .map((e) => ({ key: `:${e.shortcode}:`, shortcode: e.shortcode, imageUrl: e.url }));
        if (entries.length === 0) continue;

        // Record the mxc:// URL for each shortcode BEFORE resolving thumbnails,
        // so sendMessage() can look up the original mxc for data-mx-emoticon.
        for (const e of pack.emojis) {
          if (e.usage.includes("emoticon") && e.url.startsWith("mxc://")) {
            _shortcodeToMxc.set(e.shortcode, e.url);
          }
        }

        // Resolve mxc:// URLs to data: URLs
        await Promise.all(
          entries.map(async (entry, i) => {
            if (entry.imageUrl?.startsWith("mxc://")) {
              try {
                const dl = await getThumbnail(entry.imageUrl, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
                entries[i] = { ...entry, imageUrl: `data:${dl.mime_type};base64,${dl.data_base64}` };
              } catch { /* non-critical */ }
            }
          })
        );

        customCategories.push({
          id: `pack:${pack.pack_id}`,
          icon: entries[0].imageUrl ?? entries[0].key,
          name: pack.display_name ?? pack.pack_id,
          entries,
        });
      }

      if (customCategories.length > 0) {
        _customEmojiCategoryCache.set(roomId, customCategories);
        emojiPicker.prependCategories(customCategories);
      }
    })
    .catch(() => { /* non-critical */ });
}

async function _loadStickersIntoUnifiedPicker(): Promise<void> {
  const { emojiPicker } = getComponents();
  const roomId = AppState.get("currentRoomId");
  try {
    const packs = await getStickerPacks(roomId ?? undefined);
    const stickers: StickerEntry[] = [];
    for (const pack of packs) {
      for (const e of pack.emojis) {
        stickers.push({
          id: `${pack.pack_id}::${e.shortcode}`,
          name: e.body ?? e.shortcode,
          url: e.url,
          thumbnailUrl: e.url.startsWith("mxc://") ? undefined : e.url,
          packName: pack.display_name ?? pack.pack_id,
        });
      }
    }
    emojiPicker.setStickers(stickers);

    // Resolve mxc:// thumbnails asynchronously and patch cells as each arrives
    for (const sticker of stickers) {
      if (!sticker.url.startsWith("mxc://")) continue;
      const mxc = sticker.url;
      if (_emojiImageCache.has(mxc)) {
        emojiPicker.updateStickerThumbnail(sticker.id, _emojiImageCache.get(mxc)!);
        continue;
      }
      const capturedId = sticker.id;
      getThumbnail(mxc, 96, 96)
        .then((dl) => {
          const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
          _emojiImageCache.set(mxc, dataUrl);
          emojiPicker.updateStickerThumbnail(capturedId, dataUrl);
        })
        .catch(() => { /* non-critical */ });
    }
  } catch {
    emojiPicker.setStickers([]);
  }
}

/**
 * Open the profile dialog for a specific user ID.
 */
export async function openProfileForUser(userId: string): Promise<void> {
  const { profileDialog } = getComponents();
  try {
    const displayName = resolveDisplayName(userId);
    const mxcUrl = _memberAvatarMxc.get(userId);
    const cachedDataUrl = mxcUrl ? _avatarDataUrl.get(mxcUrl) : undefined;
    let avatarUrl: string | null = null;
    if (cachedDataUrl) {
      avatarUrl = cachedDataUrl;
    } else if (mxcUrl) {
      try {
        const dl = await downloadMedia(mxcUrl);
        avatarUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
        _avatarDataUrl.set(mxcUrl, avatarUrl);
      } catch { /* non-critical */ }
    }
    const ownUserId = AppState.get("ownUserId");
    const onMessage = userId !== ownUserId
      ? () => { void openOrCreateDm(userId); }
      : undefined;
    const statusMessage = AppState.getUserStatus(userId);
    profileDialog.show({ userId, displayName, avatarUrl, statusMessage, onMessage });
  } catch (err) {
    showError(`Failed to load profile: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Navigate to an existing DM room with `userId`, or create one if none exists.
 */
export async function openOrCreateDm(userId: string): Promise<void> {
  // Fast path: use cached room ID from a previously visited DM
  const cachedRoomId = _dmRoomByUser.get(userId);
  if (cachedRoomId) {
    await selectRoom(cachedRoomId);
    return;
  }

  // Scan the cached room list for a known DM with this user
  const rooms = AppState.get("roomListCache");
  const ownUserId = AppState.get("ownUserId");
  for (const room of rooms) {
    if (!room.is_direct || room.member_count !== 2) continue;
    // Fetch members to verify — only for small DM rooms
    try {
      const members = await getRoomMembers(room.room_id);
      if (members.some((m) => m.user_id === userId) &&
          members.some((m) => m.user_id === ownUserId)) {
        _dmRoomByUser.set(userId, room.room_id);
        await selectRoom(room.room_id);
        return;
      }
    } catch { /* skip on error */ }
  }

  // No existing DM found — create one
  try {
    const roomId = await createRoom({
      name: null,
      topic: null,
      alias: null,
      is_public: false,
      is_direct: true,
      invite: [userId],
      enable_encryption: true,
    });
    _dmRoomByUser.set(userId, roomId);
    await refreshRooms();
    await selectRoom(roomId);
  } catch (err) {
    showError(`Failed to open DM: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Open the profile dialog. Shows the selected message's sender if one is
 * selected, otherwise shows the current user's own profile.
 */
export async function openProfileDialog(): Promise<void> {
  const { profileDialog, timeline, memberList } = getComponents();
  try {
    // When the member list is focused, show that member's profile instead of
    // the selected message's sender.
    if (AppState.get("activePanel") === "members") {
      const focused = memberList.getFocusedMember();
      if (focused) {
        const mxcUrl = _memberAvatarMxc.get(focused.userId);
        const cachedDataUrl = mxcUrl ? _avatarDataUrl.get(mxcUrl) : undefined;
        let avatarUrl: string | null = null;
        if (cachedDataUrl) {
          avatarUrl = cachedDataUrl;
        } else if (mxcUrl) {
          try {
            const dl = await downloadMedia(mxcUrl);
            avatarUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
            _avatarDataUrl.set(mxcUrl, avatarUrl);
          } catch { /* non-critical */ }
        }
        const ownUserId = AppState.get("ownUserId");
        const onMessage = focused.userId !== ownUserId
          ? () => { void openOrCreateDm(focused.userId); }
          : undefined;
        profileDialog.show({ userId: focused.userId, displayName: focused.name, avatarUrl, onMessage });
        return;
      }
    }

    const selectedId = timeline.selectedMessageId;
    if (selectedId) {
      // Show the sender of the selected message
      const events = AppState.get("currentTimeline");
      const evt = events.find((e) => e.event_id === selectedId);
      if (evt) {
        const displayName = resolveDisplayName(evt.sender);
        const mxcUrl = _memberAvatarMxc.get(evt.sender);
        const cachedDataUrl = mxcUrl ? _avatarDataUrl.get(mxcUrl) : undefined;
        let avatarUrl: string | null = null;
        if (cachedDataUrl) {
          avatarUrl = cachedDataUrl;
        } else if (mxcUrl) {
          try {
            // Use full media (not thumbnail) so animated GIF/WEBP avatars are preserved.
            const dl = await downloadMedia(mxcUrl);
            avatarUrl = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
            _avatarDataUrl.set(mxcUrl, avatarUrl);
          } catch { /* non-critical */ }
        }
        const ownUserId = AppState.get("ownUserId");
        const onMessage = evt.sender !== ownUserId
          ? () => { void openOrCreateDm(evt.sender); }
          : undefined;
        profileDialog.show({ userId: evt.sender, displayName, avatarUrl, onMessage });
        return;
      }
    }
    // Fallback: own profile
    const profile = await getOwnProfile();
    let avatarUrl: string | null = null;
    if (profile.avatar_url) {
      try {
        // Use full media (not thumbnail) so animated GIF/WEBP avatars are preserved.
        const dl = await downloadMedia(profile.avatar_url);
        avatarUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
      } catch { /* non-critical */ }
    }
    profileDialog.show({
      userId: profile.user_id,
      displayName: profile.display_name,
      avatarUrl,
    });
  } catch (err) {
    showError(`Failed to load profile: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Join a room by ID or alias, refresh the room list, and navigate to it.
 * Convenience wrapper for use in UI components.
 */
export async function joinRoom(roomIdOrAlias: string): Promise<void> {
  const roomId = await ipcJoinRoom(roomIdOrAlias);
  showSuccess(`Joined ${roomId}`);
  await refreshRooms();
  await selectRoom(roomId);
}

/**
 * Open the settings dialog.
 */
export function openSettings(): void {
  const { settingsDialog } = getComponents();
  settingsDialog.show();
}

/**
 * Open the room info dialog for the current room.
 */
export async function openRoomInfo(): Promise<void> {
  const { roomInfoDialog } = getComponents();
  await roomInfoDialog.show();
}

/**
 * Open the pinned messages dialog for the current room.
 */
export async function openPinnedMessages(): Promise<void> {
  const { pinnedMessagesDialog } = getComponents();
  await pinnedMessagesDialog.show();
}

/**
 * Open the room directory dialog.
 */
export function openRoomDirectory(): void {
  const { roomDirectoryDialog } = getComponents();
  roomDirectoryDialog.show();
}

// GIF picker search state (persisted across picker open/close within a session)
let _gifQuery = "";
let _gifResultCount = 0;

/**
 * Show the GIF search picker. Wires search/select/load-more callbacks on first call.
 */
export function openGifPicker(): void {
  const { gifPicker } = getComponents();

  gifPicker.onSearch(async (query) => {
    if (!query.trim()) return;
    _gifQuery = query.trim();
    _gifResultCount = 0;
    gifPicker.setStatus("Searching…");
    try {
      const config = await getAppConfig();
      const results = await searchGifs(
        _gifQuery,
        config.gif.provider,
        config.gif.api_key,
        20,
        config.gif.rating,
      );
      _gifResultCount = results.length;
      gifPicker.setResults(results);
      gifPicker.setStatus(
        results.length === 0
          ? "No results — try a different query"
          : "j/k/h/l: navigate · Tab: more · Enter: send · Esc: close",
      );
    } catch (err) {
      gifPicker.setStatus(
        `Search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  gifPicker.onLoadMore(async () => {
    if (!_gifQuery) return;
    gifPicker.setStatus("Loading more…");
    try {
      const config = await getAppConfig();
      // Re-fetch with a larger limit to append more results
      const more = await searchGifs(
        _gifQuery,
        config.gif.provider,
        config.gif.api_key,
        _gifResultCount + 20,
        config.gif.rating,
      );
      _gifResultCount = more.length;
      gifPicker.setResults(more);
      gifPicker.setStatus(
        `${more.length} results · Tab: more · Enter: send · Esc: close`,
      );
    } catch {
      gifPicker.setStatus("Failed to load more");
    }
  });

  gifPicker.onSelect(async (gif) => {
    const roomId = AppState.get("currentRoomId");
    if (!roomId) {
      showError("No room selected");
      return;
    }
    gifPicker.setStatus("Uploading GIF…");
    try {
      await ipcSendGif(roomId, gif.url, gif.title, gif.width, gif.height);
      showSuccess("GIF sent");
    } catch (err) {
      showError(
        `Failed to send GIF: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  gifPicker.show();

  // Set "Powered by" branding based on configured provider
  getAppConfig().then((config) => {
    gifPicker.setProvider(config.gif.provider);
  }).catch(() => {/* ignore */});
}

/** Open the sticker tab of the unified emoji/sticker picker. */
export function openStickerPicker(): void {
  openEmojiPicker("sticker");
}

/**
 * Handle a pasted image from the clipboard.
 * Uploads to the homeserver and sends as an m.image event.
 */
export async function handleImagePaste(blob: Blob): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  try {
    // Convert blob to base64
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const dataBase64 = btoa(binary);

    const ext = blob.type.split("/")[1] ?? "png";
    const filename = `pasted-image-${Date.now()}.${ext}`;

    showToast("Uploading image…", "info");
    await sendPastedImage(roomId, dataBase64, blob.type, filename);
  } catch (err) {
    showError(`Failed to send image: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Handle a file selected from the file picker.
 * Images are sent as m.image; everything else as m.file.
 */
export async function handleFilePick(file: File): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const dataBase64 = btoa(binary);

    if (file.type.startsWith("image/")) {
      showToast("Uploading image…", "info");
      await sendPastedImage(roomId, dataBase64, file.type, file.name);
    } else {
      showToast(`Uploading ${file.name}…`, "info");
      await sendFile(roomId, dataBase64, file.type || "application/octet-stream", file.name, file.size);
    }
  } catch (err) {
    showError(`Failed to send file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Execute a parsed : command.
 */
export async function executeCommand(parsed: ParsedCommand): Promise<void> {
  switch (parsed.name) {
    case "join": {
      const alias = parsed.args[0];
      if (!alias) {
        showError("Usage: :join <room-id-or-alias>");
        return;
      }
      try {
        await joinRoom(alias);
      } catch (err) {
        showError(`Failed to join: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "leave": {
      const roomId = parsed.args[0] ?? AppState.get("currentRoomId");
      if (!roomId) {
        showError("No room to leave");
        return;
      }
      try {
        await leaveRoom(roomId);
        showSuccess(`Left room`);
        AppState.set("currentRoomId", null);
        await refreshRooms();
      } catch (err) {
        showError(`Failed to leave: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case "theme": {
      const themeName = parsed.args[0];
      if (!themeName) {
        showError("Usage: :theme <name>");
        return;
      }
      await loadTheme(themeName);
      break;
    }

    case "logout": {
      await logout();
      break;
    }

    case "q":
    case "quit": {
      // In Tauri: close the window
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        void getCurrentWindow().close();
      } catch {
        showToast("quit not available in this context", "info");
      }
      break;
    }

    case "upload": {
      showToast("Upload: not yet implemented", "info");
      break;
    }

    case "help": {
      getComponents().helpDialog.show();
      break;
    }

    case "profile": {
      void openProfileDialog();
      break;
    }

    case "settings": {
      openSettings();
      break;
    }

    case "info": {
      void openRoomInfo();
      break;
    }

    case "pinned": {
      void openPinnedMessages();
      break;
    }

    case "directory": {
      openRoomDirectory();
      break;
    }

    case "msg": {
      const targetUser = parsed.args[0];
      if (!targetUser) {
        showError("Usage: :msg <user-id>");
        return;
      }
      void openOrCreateDm(targetUser);
      break;
    }

    case "verify": {
      const userId = parsed.args[0];
      if (!userId) {
        showError("Usage: :verify <user-id>");
        return;
      }
      await startVerification(userId);
      break;
    }

    case "cross-sign":
    case "setup-cross-signing": {
      await setupCrossSigning(parsed.args[0]);
      break;
    }

    default:
      showError(`Unknown command: ${parsed.name}`);
  }
}

/**
 * Load and apply a theme by name (built-in) or file path (custom).
 * Built-in themes are resolved from the embedded map without any IPC call.
 * Custom themes (containing path separators or ending in .toml) are loaded
 * via the Rust backend.
 */
export async function loadTheme(nameOrPath: string): Promise<void> {
  try {
    const builtin = BUILTIN_THEME_MAP[nameOrPath];
    if (builtin) {
      applyTheme(builtin);
      setCurrentThemeName(nameOrPath);
      showSuccess(`Theme "${nameOrPath}" applied`);
      return;
    }
    // Fall back to IPC for custom file paths
    const theme = await ipcLoadTheme(nameOrPath);
    applyTheme(theme);
    setCurrentThemeName(nameOrPath);
    const displayName = theme.meta?.name ?? nameOrPath;
    showSuccess(`Theme "${displayName}" applied`);
  } catch (err) {
    showError(`Failed to load theme: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Load the theme specified in config.toml and apply it on startup.
 * Silently falls back to the default if config is absent or theme is invalid.
 */
export async function loadThemeFromConfig(): Promise<void> {
  try {
    const config = await getAppConfig();
    const themeName = config.general.theme;
    if (themeName && themeName !== "phosphor") {
      await loadTheme(themeName);
    } else {
      setCurrentThemeName("phosphor");
    }
    // Apply app-level CSS variables from config
    const iconRadius = config.general.icon_radius;
    if (iconRadius) {
      document.documentElement.style.setProperty("--icon-radius", iconRadius);
    }
  } catch (err) {
    console.warn("Failed to load theme from config:", err);
  }
}

/**
 * Refresh the room list from the backend.
 */
export async function refreshRooms(): Promise<void> {
  const { roomList, spaceStrip } = getComponents();

  try {
    const [rooms, userSpaces] = await Promise.all([
      getRooms(),
      getUserSpaces().catch(() => [] as Awaited<ReturnType<typeof getUserSpaces>>),
    ]);
    AppState.set("roomListCache", rooms);

    // Build the set of rooms/subspaces that belong to any space, and collect
    // subspace IDs so they can be excluded from the sidebar strip.
    const spaceRoomIdSet = new Set<string>();
    const subspaceIdSet = new Set<string>();
    await Promise.all(
      userSpaces.map(async (space) => {
        try {
          const children = await getSpaceChildren(space.room_id);
          for (const c of children) {
            // Add all children (rooms and subspaces) so they're hidden from the home list
            spaceRoomIdSet.add(c.room_id);
            if (c.is_space) subspaceIdSet.add(c.room_id);
          }
        } catch {
          // Non-critical — worst case the home view shows extra rooms
        }
      })
    );
    AppState.set("spaceRoomIds", [...spaceRoomIdSet]);

    // Populate space strip — exclude subspaces (they appear nested inside their parent space)
    const topLevelSpaces = userSpaces.filter((s) => !subspaceIdSet.has(s.room_id));
    const spaceItems: SpaceItem[] = topLevelSpaces.map((s) => ({
      id: s.room_id,
      name: s.name ?? s.room_id,
    }));
    spaceStrip.setSpaces(spaceItems);

    // Resolve space avatar mxc:// URLs in the background
    for (const s of topLevelSpaces) {
      if (s.avatar_url?.startsWith("mxc://")) {
        const mxcUrl = s.avatar_url;
        const roomId = s.room_id;
        // Use full media (not thumbnail) so animated GIF/WEBP space avatars are preserved.
        downloadMedia(mxcUrl)
          .then((dl) => {
            const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
            spaceStrip.updateSpaceAvatar(roomId, dataUrl);
          })
          .catch(() => { /* non-critical */ });
      }
    }

    // Refresh the current space view with fresh data
    const spaceId = AppState.get("currentSpaceId");
    if (!spaceId || spaceId === "__home__") {
      const spaceRoomIds = new Set(AppState.get("spaceRoomIds"));
      const homeRooms = rooms
        .filter((r) => r.is_direct || !spaceRoomIds.has(r.room_id))
        .sort((a, b) => {
          const aTs = a.last_activity_ts ?? 0;
          const bTs = b.last_activity_ts ?? 0;
          if (bTs !== aTs) return bTs - aTs;
          const aScore = a.notification_count * 2 + a.unread_count;
          const bScore = b.notification_count * 2 + b.unread_count;
          if (bScore !== aScore) return bScore - aScore;
          return (a.name ?? "").localeCompare(b.name ?? "");
        });
      roomList.setRooms(homeRooms.map(roomInfoToEntry));
    }
  } catch (err) {
    showError(`Failed to load rooms: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Start a SAS device verification flow for a user.
 *
 * Gets the user's devices. If there is more than one, shows the DevicePicker
 * overlay so the user can choose. Then starts the SAS flow and polls for emoji.
 */
export async function startVerification(userId: string): Promise<void> {
  const { verification, devicePicker } = getComponents();

  try {
    const devices = await getUserDevices(userId);
    if (devices.length === 0) {
      showError(`No devices found for ${userId}`);
      return;
    }

    if (devices.length === 1) {
      // Only one device — skip the picker.
      await _beginSasFlow(userId, devices[0].device_id, verification);
    } else {
      // Multiple devices — let the user choose.
      devicePicker.show(devices, userId);
      devicePicker.onPick(async (device) => {
        await _beginSasFlow(userId, device.device_id, verification);
      });
      devicePicker.onCancel(() => {
        // Nothing to do — user closed the picker.
      });
    }
  } catch (err) {
    showError(`Failed to start verification: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Handle an incoming verification request from another device.
 * Shows the Verification overlay in "incoming" state so the user can accept or
 * reject. If accepted, transitions to SAS emoji polling.
 */
export function handleIncomingVerificationRequest(
  fromUserId: string,
  fromDeviceId: string,
  flowId: string,
): void {
  const { verification } = getComponents();

  verification.setIncomingRequest(fromUserId, fromDeviceId);
  verification.setState("incoming");
  verification.show();

  verification.onConfirm(async () => {
    try {
      await acceptVerificationRequest(fromUserId, flowId);
      verification.setState("waiting");

      // Re-wire for the emoji comparison phase.
      verification.onConfirm(async () => {
        try {
          await confirmSasVerification(fromUserId, flowId);
          verification.setState("verified");
        } catch (err) {
          showError(`Confirm failed: ${err instanceof Error ? err.message : String(err)}`);
          verification.setState("failed");
        }
      });
      verification.onDeny(async () => {
        try { await cancelSasVerification(fromUserId, flowId); } catch { /* best-effort */ }
        verification.setState("cancelled");
      });

      // skipAccept = false: we attempt sas.accept() on each poll tick so that
      // we handle both sides of a race — if start_sas() returned None (the
      // other device won the start race), we'll accept their flow instead.
      // When we ARE the initiator, accept() fails with a wrong-state error
      // that is silently ignored.
      pollSasEmoji(fromUserId, flowId, verification, /* skipAccept */ false);
    } catch (err) {
      showError(`Failed to accept verification: ${err instanceof Error ? err.message : String(err)}`);
      verification.setState("failed");
    }
  });

  verification.onDeny(async () => {
    try {
      await cancelSasVerification(fromUserId, flowId);
    } catch {
      // Best-effort.
    }
    verification.setState("cancelled");
  });
}

/** Shared helper: start a SAS flow for a known device_id. */
async function _beginSasFlow(
  userId: string,
  deviceId: string,
  verification: import("../ui/Verification.js").Verification,
): Promise<void> {
  const flowId = await startSasVerification(userId, deviceId);

  verification.setState("waiting");
  verification.show();

  verification.onConfirm(async () => {
    try {
      await confirmSasVerification(userId, flowId);
      verification.setState("verified");
    } catch (err) {
      showError(`Confirm failed: ${err instanceof Error ? err.message : String(err)}`);
      verification.setState("failed");
    }
  });

  verification.onDeny(async () => {
    try {
      await cancelSasVerification(userId, flowId);
    } catch {
      // Best-effort.
    }
    verification.setState("cancelled");
  });

  // Accept our side; may fail if the other device hasn't responded yet — the
  // poll will retry.
  try {
    await acceptSasVerification(userId, flowId);
  } catch {
    // Ignored.
  }

  pollSasEmoji(userId, flowId, verification);
}

/**
 * Poll for SAS emoji info until they become available, then populate the UI.
 * Gives up after ~60 seconds (30 × 2 s intervals).
 */
function pollSasEmoji(
  userId: string,
  flowId: string,
  verification: import("../ui/Verification.js").Verification,
  skipAccept = false,
): void {
  let attempts = 0;
  const MAX_ATTEMPTS = 30;

  const tick = async () => {
    if (attempts >= MAX_ATTEMPTS) {
      verification.setState("cancelled");
      showError("Verification timed out waiting for the other device.");
      return;
    }
    attempts++;

    try {
      const info = await getSasInfo(userId, flowId);
      if (info && info.emoji.length > 0) {
        verification.setSasEmoji(
          info.emoji.map(([emoji, description]) => ({ emoji, description })),
        );
        verification.setState("comparing");
        return; // Done polling.
      }

      // When we are the SAS acceptor (outgoing flow), retry accept until the
      // other device's start message arrives. Skip for incoming flows where we
      // are the SAS initiator — only the acceptor sends the accept message.
      if (!skipAccept) {
        try {
          await acceptSasVerification(userId, flowId);
        } catch {
          // Ignore — may already be accepted.
        }
      }
    } catch {
      // Ignore transient errors and keep polling.
    }

    setTimeout(tick, 2000);
  };

  setTimeout(tick, 1500);
}

/**
 * Bootstrap cross-signing keys for the local user.
 *
 * If the server requires UIAA and a password was not supplied, prompts the
 * user by showing an error with instructions to retry with their password:
 *   :cross-sign <password>
 */
export async function setupCrossSigning(password?: string): Promise<void> {
  try {
    // Show current status first.
    const status = await getCrossSigningStatus();

    if (status.is_complete) {
      showToast("Cross-signing is already set up for this account.", "info");
      return;
    }

    showToast("Setting up cross-signing…", "info");

    await bootstrapCrossSigning(password);

    showSuccess("Cross-signing keys uploaded successfully. Your account is now set up for cross-signing.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "UIAA_REQUIRED") {
      showError(
        "Server requires your password to set up cross-signing. " +
        "Run:  :cross-sign <your-password>",
      );
    } else {
      showError(`Cross-signing setup failed: ${msg}`);
    }
  }
}

/**
 * Toggle the member list sidebar visibility.
 */
export function toggleMemberList(): void {
  const { mainLayout } = getComponents();
  const current = AppState.get("memberListVisible");
  const next = !current;
  AppState.set("memberListVisible", next);

  if (!next && AppState.get("activePanel") === "members") {
    AppState.set("activePanel", "timeline");
  }

  mainLayout.classList.toggle("quark-layout--member-list-open", next);
}

/** Convert IPC RoomMember → MemberList MemberEntry */
function roomMemberToEntry(m: RoomMember): MemberEntry {
  // Use the already-resolved blob URL if available; mxc:// URLs can't be
  // loaded by the browser directly, so fall back to undefined (shows initial).
  const resolvedAvatar = m.avatar_url ? _avatarDataUrl.get(m.avatar_url) : undefined;
  // Prefer the live-cached presence state from sync events over the initial
  // member fetch (which always returns null from the backend).
  const cachedPresence = AppState.getUserPresence(m.user_id);
  const presence = (m.presence ?? cachedPresence ?? "offline") as "online" | "unavailable" | "offline";
  return {
    id: m.user_id,
    name: m.display_name ?? m.user_id,
    userId: m.user_id,
    powerLevel: m.power_level,
    presence,
    avatarUrl: resolvedAvatar,
  };
}

/**
 * Scan all events for reactions whose key is an mxc:// custom emoji URL,
 * download each (using the shared media cache), and update the reaction chips
 * in the timeline once the image arrives.
 */
async function _downloadReactionEmoji(
  events: TimelineEvent[],
  timeline: import("../ui/Timeline.js").Timeline
): Promise<void> {
  // Gather unique mxc:// keys across all events
  const mxcKeys = new Set<string>();
  for (const e of events) {
    for (const r of e.reactions ?? []) {
      if (r.key.startsWith("mxc://") && !_emojiImageCache.has(r.key)) {
        mxcKeys.add(r.key);
      }
    }
  }

  for (const mxc of mxcKeys) {
    getThumbnail(mxc, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
      .then((dl) => {
        const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
        _emojiImageCache.set(mxc, dataUrl);

        // Update every message that has a reaction with this mxc key
        for (const e of events) {
          const reactions = e.reactions ?? [];
          if (!reactions.some((r) => r.key === mxc)) continue;
          timeline.updateMessageReactions(
            e.event_id,
            reactions.map((r) => ({
              key: r.key,
              count: r.count,
              own: r.own,
              imageUrl: _emojiImageCache.get(r.key),
            }))
          );
        }
      })
      .catch(() => { /* non-critical */ });
  }
}

/** Download mxc:// image/sticker content and swap in data URLs once ready.
 * Video and audio are intentionally excluded — they are loaded on demand
 * via the `quark:open-video` event to avoid crashing WebKit on systems
 * without GStreamer. */
function _downloadMessageImages(events: TimelineEvent[], timeline: { updateMessageMedia(id: string, dataUrl: string): void }): void {
  for (const e of events) {
    if (!e.media_url || !e.media_url.startsWith("mxc://")) continue;
    // Skip video/audio — handled lazily on click
    if (e.msg_type === "m.video" || e.msg_type === "m.audio") continue;
    const eventId = e.event_id;
    const mxc = e.media_url;
    downloadMedia(mxc, e.media_encryption_info).then((dl) => {
      const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
      timeline.updateMessageMedia(eventId, dataUrl);
    }).catch((err) => {
      console.error(`[media] failed to download ${mxc}:`, err);
    });
  }
}

/** Download media for a single sync-pushed message and update the timeline. */
export function downloadSyncMessageImage(event: TimelineEvent, timeline: { updateMessageMedia(id: string, dataUrl: string): void }): void {
  _downloadMessageImages([event], timeline);
}

/** Return the cached avatar data URL for a sender, if already downloaded. */
export function resolveSenderAvatarUrl(senderId: string): string | undefined {
  const mxcUrl = _memberAvatarMxc.get(senderId);
  return mxcUrl ? _avatarDataUrl.get(mxcUrl) : undefined;
}

/**
 * Ensure a sender's avatar is downloaded and reflected in the timeline.
 * If the data URL is already cached, updates immediately; otherwise triggers
 * an async download. No-op if the sender has no known avatar mxc URL.
 */
export function ensureSenderAvatarDownloaded(senderId: string, timeline: import("../ui/Timeline.js").Timeline): void {
  const mxcUrl = _memberAvatarMxc.get(senderId);
  if (!mxcUrl) return;
  if (_avatarDataUrl.has(mxcUrl)) {
    timeline.updateSenderAvatar(senderId, _avatarDataUrl.get(mxcUrl)!);
    return;
  }
  downloadMedia(mxcUrl).then((dl) => {
    const url = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
    _avatarDataUrl.set(mxcUrl, url);
    timeline.updateSenderAvatar(senderId, url);
  }).catch(() => { /* non-critical */ });
}

/** Public alias used by sync.ts after appending a new message. */
export function resolveInlineEmojiForTimeline(timeline: import("../ui/Timeline.js").Timeline): void {
  _downloadInlineEmoji(timeline);
}

/** Resolve mxc:// URLs for inline custom emoji (data-mx-emoticon imgs) in the timeline. */
function _downloadInlineEmoji(timeline: import("../ui/Timeline.js").Timeline): void {
  const urls = timeline.getPendingInlineEmojiUrls();
  for (const mxc of urls) {
    if (_emojiImageCache.has(mxc)) {
      timeline.resolveInlineEmoji(mxc, _emojiImageCache.get(mxc)!);
      continue;
    }
    getThumbnail(mxc, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
      .then((dl) => {
        const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
        _emojiImageCache.set(mxc, dataUrl);
        timeline.resolveInlineEmoji(mxc, dataUrl);
      })
      .catch(() => { /* non-critical */ });
  }
}

/** Download uncached avatars and update the timeline when each arrives.
 * Full media (not thumbnail) is used so that animated GIF/WEBP avatars
 * are not transcoded to static images by the homeserver thumbnail endpoint.
 */
function _downloadMemberAvatars(members: RoomMember[], timeline: import("../ui/Timeline.js").Timeline): void {
  const { memberList } = getComponents();
  for (const m of members) {
    if (!m.avatar_url) continue;
    const mxc = m.avatar_url;
    if (_avatarDataUrl.has(mxc)) {
      timeline.updateSenderAvatar(m.user_id, _avatarDataUrl.get(mxc)!);
      memberList.updateMemberAvatar(m.user_id, _avatarDataUrl.get(mxc)!);
      continue;
    }
    downloadMedia(mxc).then((dl) => {
      const url = _mediaToBlobUrl(dl.mime_type, dl.data_base64);
      _avatarDataUrl.set(mxc, url);
      timeline.updateSenderAvatar(m.user_id, url);
      memberList.updateMemberAvatar(m.user_id, url);
    }).catch(() => { /* non-critical */ });
  }
}

/**
 * Refresh the member list for the current room (e.g. after a sync event).
 */
export async function loadRoomMembers(roomId: string): Promise<void> {
  const { memberList, timeline } = getComponents();
  try {
    const members = await getRoomMembers(roomId);
    for (const m of members) {
      if (m.display_name) _memberDisplayName.set(m.user_id, m.display_name);
      if (m.avatar_url) _memberAvatarMxc.set(m.user_id, m.avatar_url);
    }
    memberList.setMembers(members.map(roomMemberToEntry));
    _downloadMemberAvatars(members, timeline);
  } catch {
    // Non-critical — member list may just stay empty
  }
}

/**
 * Show the quick reaction picker anchored to the currently selected message.
 */
export function openQuickReactPicker(eventId: string): void {
  const { timeline, quickReactPicker } = getComponents();
  const anchor = timeline.getMessageElementById(eventId);
  quickReactPicker.show(eventId, anchor);

  // Load custom emoji for current room and inject into the picker.
  // For custom emoji reactions, the reaction key must be the mxc:// URL (MSC2545).
  const roomId = AppState.get("currentRoomId");
  getEmojiPacks(roomId ?? undefined)
    .then((packs) => {
      const custom: CustomEmojiEntry[] = [];
      for (const pack of packs) {
        for (const entry of pack.emojis) {
          if (!entry.usage.includes("emoticon")) continue;
          const mxc = entry.url;
          // Populate shortcode→mxc map so sendMessage() can build data-mx-emoticon.
          if (mxc.startsWith("mxc://")) {
            _shortcodeToMxc.set(entry.shortcode, mxc);
          }
          // Use the mxc:// URL as the reaction key (MSC2545 custom emoji reactions).
          const cached = _emojiImageCache.get(mxc);
          if (cached) {
            custom.push({ key: mxc, shortcode: entry.shortcode, imageUrl: cached });
          } else if (mxc.startsWith("mxc://")) {
            // Resolve then update picker once available.
            // Push a placeholder with imageUrl "" so the entry exists in `custom`
            // (for correct mapping in the .then), but filter it out when calling
            // setCustomEmoji so the picker never shows raw mxc:// text.
            getThumbnail(mxc, 32, 32).then((dl) => {
              const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
              _emojiImageCache.set(mxc, dataUrl);
              // Re-build if picker is still open, filtering out still-unresolved entries
              if (quickReactPicker.isVisible()) {
                quickReactPicker.setCustomEmoji(
                  custom
                    .map((c) => c.key === mxc ? { ...c, imageUrl: dataUrl } : c)
                    .filter((c) => c.imageUrl)
                );
              }
            }).catch(() => { /* non-critical */ });
            custom.push({ key: mxc, shortcode: entry.shortcode, imageUrl: "" });
          } else {
            custom.push({ key: mxc, shortcode: entry.shortcode, imageUrl: mxc });
          }
        }
      }
      if (quickReactPicker.isVisible()) {
        quickReactPicker.setCustomEmoji(custom.filter((c) => c.imageUrl));
      }
    })
    .catch(() => { /* non-critical */ });
}

/**
 * Wire the global chip-react event (bubbles up from reaction chips in the timeline).
 * Must be called once after components are set.
 */
export function setupReactionChipHandler(): void {
  document.addEventListener("quark:chip-react" as keyof DocumentEventMap, (e: Event) => {
    const customEv = e as CustomEvent<{ key: string }>;
    const target = e.target as HTMLElement | null;
    const msgEl = target?.closest<HTMLElement>("[data-message-id]");
    if (msgEl?.dataset.messageId) {
      void sendReaction(msgEl.dataset.messageId, customEv.detail.key);
    }
  });
}

/**
 * Wire the hover action bar buttons (react / reply) that bubble custom events
 * from message elements. Must be called once after components are set.
 */
export function setupMessageActionHandlers(): void {
  document.addEventListener("quark:msg-react" as keyof DocumentEventMap, (e: Event) => {
    const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
    if (eventId) openQuickReactPicker(eventId);
  });

  document.addEventListener("quark:msg-reply" as keyof DocumentEventMap, (e: Event) => {
    const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
    if (!eventId) return;
    const events = AppState.get("currentTimeline");
    const evt = events.find((ev) => ev.event_id === eventId);
    if (evt) {
      const { input } = getComponents();
      startReply(eventId, evt.sender, evt.body.slice(0, 80));
      input.focus();
    }
  });

  document.addEventListener("quark:open-thread" as keyof DocumentEventMap, (e: Event) => {
    const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
    if (eventId) void openThread(eventId);
  });

  document.addEventListener("quark:open-profile" as keyof DocumentEventMap, (e: Event) => {
    const { userId } = (e as CustomEvent<{ userId: string }>).detail;
    if (!userId) return;
    void openProfileForUser(userId);
  });

  document.addEventListener("quark:open-file" as keyof DocumentEventMap, (e: Event) => {
    const { mxcUrl, filename, encryptionInfo } =
      (e as CustomEvent<{ mxcUrl?: string; filename?: string; encryptionInfo?: string }>).detail;
    if (!mxcUrl) return;
    void openMediaExternally(mxcUrl, encryptionInfo, filename).catch((err) => {
      console.error("[file] open failed:", err);
    });
  });

  document.addEventListener("quark:open-video" as keyof DocumentEventMap, (e: Event) => {
    const { mxcUrl, filename, mimeType, encryptionInfo } =
      (e as CustomEvent<{ mxcUrl?: string; filename?: string; mimeType?: string; encryptionInfo?: string }>).detail;
    if (!mxcUrl) return;

    // Determine the message element so we can call showInlineVideo later.
    const target = e.target as HTMLElement | null;
    const msgEl = target?.closest<HTMLElement>("[data-message-id]");
    const eventId = msgEl?.dataset.messageId;

    // canPlayType on a detached video element is safe — it only queries codec
    // support, never initialises the GStreamer pipeline.
    const testVideo = document.createElement("video");
    const canPlay = mimeType
      ? testVideo.canPlayType(mimeType) !== ""
      : testVideo.canPlayType("video/mp4") !== "" || testVideo.canPlayType("video/webm") !== "";

    // Mark the affordance as loading so CSS can show a progress animation.
    const affordanceEl = (e.target as HTMLElement | null)?.closest<HTMLElement>(".message__video-affordance");
    affordanceEl?.classList.add("message__video-affordance--loading");
    const stopLoading = () => affordanceEl?.classList.remove("message__video-affordance--loading");

    if (canPlay && eventId) {
      // Download and play inline
      const { timeline } = getComponents();
      void downloadMedia(mxcUrl, encryptionInfo).then((dl) => {
        stopLoading();
        const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
        timeline.showInlineVideo(eventId, dataUrl, dl.mime_type);
      }).catch((err) => {
        stopLoading();
        console.error("[video] inline playback download failed:", err);
        // Fall through to external player
        void _openVideoExternally(mxcUrl, encryptionInfo, filename);
      });
    } else {
      void _openVideoExternally(mxcUrl, encryptionInfo, filename).finally(stopLoading);
    }
  });
}

async function _openVideoExternally(mxcUrl: string, encryptionInfo?: string, filename?: string): Promise<void> {
  try {
    await openMediaExternally(mxcUrl, encryptionInfo, filename);
  } catch (err) {
    showError(`Failed to open video: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Wire up the status bar's onSetStatus callback and load the initial status.
 * Call once after login completes.
 */
export function setupStatusBar(): void {
  const { statusBar } = getComponents();
  statusBar.onSetStatus((msg) => {
    void ipcSetPresenceStatus(msg).catch(() => { /* non-fatal */ });
  });
}

/**
 * Begin editing the status bar status message (triggered by the S key).
 */
export function editStatus(): void {
  const { statusBar } = getComponents();
  statusBar.beginEdit();
}
