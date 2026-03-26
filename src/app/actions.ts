// Action dispatcher — connects IPC calls to UI state updates

import { AppState } from "./state.js";

import { saveSession, clearSession } from "./session.js";

import {
  login as ipcLogin,
  restoreSession as ipcRestoreSession,
  logout as ipcLogout,
  getRooms,
  getRoomMembers,
  getTimeline,
  sendMessage as ipcSendMessage,
  sendReaction as ipcSendReaction,
  editMessage as ipcEditMessage,
  redactMessage as ipcRedactMessage,
  getSpaceChildren,
  joinRoom,
  leaveRoom,
  getThreadTimeline,
  loadTheme as ipcLoadTheme,
  startSasVerification,
  searchGifs,
  sendGif as ipcSendGif,
  getThumbnail,
  downloadMedia,
} from "../ipc/index.js";

import { applyTheme } from "../theme/loader.js";

import type { AppComponents } from "../ui/App.js";
import type { RoomInfo, TimelineEvent, RoomMember } from "../ipc/types.js";
import type { ParsedCommand } from "../vim/commands.js";

import { showToast, showError, showSuccess } from "../ui/NotificationToast.js";
import { showMainLayout } from "../ui/App.js";

// UI component types for building display data
import type { RoomEntry } from "../ui/RoomList.js";
import type { MessageData, ReplyPreviewData } from "../ui/Timeline.js";
import type { MemberEntry } from "../ui/MemberList.js";
import type { SpaceItem } from "../ui/SpaceStrip.js";

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
/** Prevents concurrent "load more" fetches. */
let _paginationLoading = false;

// ── Member caches ─────────────────────────────────────────────────────────────

/** userId → display name, populated when room members are fetched */
const _memberDisplayName = new Map<string, string>();
/** userId → mxc:// URL, populated when room members are fetched */
const _memberAvatarMxc = new Map<string, string>();
/** mxc:// URL → data: URL, populated as thumbnails are downloaded */
const _avatarDataUrl = new Map<string, string>();

/** Resolve a user ID to its display name, falling back to the raw ID. */
export function resolveDisplayName(userId: string): string {
  return _memberDisplayName.get(userId) ?? userId;
}

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

/** Convert IPC TimelineEvent → Timeline MessageData */
function timelineEventToMessage(e: TimelineEvent, allEvents?: TimelineEvent[]): MessageData {
  const msgType = (() => {
    if (e.msg_type === "m.image") return "image" as const;
    if (e.msg_type === "m.sticker") return "sticker" as const;
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

  return {
    id: e.event_id,
    senderId: e.sender,
    senderName: resolveDisplayName(e.sender),
    senderAvatarUrl,
    timestamp: new Date(e.timestamp).toISOString(),
    body: e.body,
    htmlBody: e.formatted_body ?? undefined,
    type: msgType,
    mediaUrl: e.media_url ?? undefined,
    reactions: e.reactions?.map((r) => ({
      key: r.key,
      count: r.count,
      own: r.own,
      imageUrl: _resolveReactionImage(r.key),
    })),
    replyTo,
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
  const { roomList, roomHeader, timeline, memberList, statusBar } = getComponents();
  const prevRoom = AppState.get("currentRoomId");

  AppState.set("currentRoomId", roomId);
  AppState.set("activePanel", "timeline");
  _prevBatch = null;
  _paginationLoading = false;
  roomList.setActiveRoom(roomId);

  // Find room info in cache
  const cached = AppState.get("roomListCache");
  const roomInfo = cached.find((r) => r.room_id === roomId);
  const roomName = roomInfo?.name ?? roomId;

  roomHeader.setRoom(
    roomName,
    roomInfo?.topic ?? undefined,
    roomInfo?.member_count,
    roomInfo?.is_encrypted
  );
  statusBar.setRoom(roomName);

  try {
    // Fetch timeline and members in parallel — members must be ready before
    // converting events so display names are available on first render.
    const [page, members] = await Promise.all([
      getTimeline(roomId, { limit: 50 }),
      getRoomMembers(roomId).catch(() => [] as RoomMember[]),
    ]);

    const { events, prev_batch } = page;
    _prevBatch = prev_batch;

    AppState.set("currentTimeline", events);

    // Populate display-name and mxc caches from members (synchronous)
    for (const m of members) {
      if (m.display_name) _memberDisplayName.set(m.user_id, m.display_name);
      if (m.avatar_url) _memberAvatarMxc.set(m.user_id, m.avatar_url);
    }

    // Render timeline — display names and any previously-cached avatars are now available
    const messages = events.map((e) => timelineEventToMessage(e, events));
    timeline.setMessages(messages);

    // Register scroll-to-top for pagination (re-registers on each room change)
    timeline.onScrollToTop(() => void loadMoreMessages());

    // Populate the member list sidebar
    memberList.setMembers(members.map(roomMemberToEntry));

    // Download uncached avatar thumbnails in the background
    _downloadMemberAvatars(members, timeline);

    // Download mxc:// image content in the background
    _downloadMessageImages(events, timeline);

    // Resolve any mxc:// custom emoji used in reaction chips
    void _downloadReactionEmoji(events, timeline);

    // Resolve mxc:// URLs for inline custom emoji in formatted message bodies
    _downloadInlineEmoji(timeline);
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
 */
async function loadMoreMessages(): Promise<void> {
  if (_paginationLoading || !_prevBatch) return;
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const { timeline } = getComponents();
  _paginationLoading = true;
  timeline.showLoadingMore();

  try {
    const page = await getTimeline(roomId, { limit: 50, before: _prevBatch });
    _prevBatch = page.prev_batch;

    if (page.events.length === 0) return;

    const existingEvents = AppState.get("currentTimeline");
    AppState.set("currentTimeline", [...page.events, ...existingEvents]);

    const messages = page.events.map((e) => timelineEventToMessage(e, page.events));
    timeline.prependMessages(messages);

    _downloadMessageImages(page.events, timeline);
    _downloadInlineEmoji(timeline);
    void _downloadReactionEmoji(page.events, timeline);
  } catch (err) {
    showError(`Failed to load more messages: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    _paginationLoading = false;
    timeline.hideLoadingMore();
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
    // Show all rooms
    const allRooms = AppState.get("roomListCache");
    roomList.setRooms(allRooms.map(roomInfoToEntry));
    return;
  }

  if (spaceId === "__dms__") {
    const allRooms = AppState.get("roomListCache");
    const dms = allRooms.filter((r) => r.is_direct).map(roomInfoToEntry);
    roomList.setRooms(dms);
    return;
  }

  try {
    const children = await getSpaceChildren(spaceId);
    const roomIds = new Set(children.filter((c) => !c.is_space).map((c) => c.room_id));
    const filtered = AppState.get("roomListCache")
      .filter((r) => roomIds.has(r.room_id))
      .map(roomInfoToEntry);
    roomList.setRooms(filtered);
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

  const optimisticMsg: MessageData = {
    id: `optimistic-${Date.now()}`,
    senderName: "you",
    isOwn: true,
    timestamp: new Date().toISOString(),
    body,
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
      const clonePaddingTop = getComputedStyle(clone).paddingTop;
      composeBoxEl.style.opacity = "0";

      const anim = clone.animate(
        [
          { transform: "translate(0,0)", opacity: "1", borderRadius: "0px 8px 8px 0px",
            width: `${composeRect.width}px`, height: `${composeRect.height}px`,
            paddingTop: clonePaddingTop },
          { transform: `translate(0,${deltaY}px)`, opacity: "1", borderRadius: "8px",
            width: `${targetRect?.width ?? composeRect.width}px`,
            height: `${targetRect?.height ?? composeRect.height}px`,
            paddingTop: "10px" },
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

  try {
    const eventId = await ipcSendMessage(roomId, body, undefined, replyToEventId ?? undefined);
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
 * Cancel the current reply.
 */
export function cancelReply(): void {
  const { replyPreview } = getComponents();
  AppState.set("replyToEventId", null);
  replyPreview.hide();
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
 * Redact (delete) a message.
 */
export async function redactMessage(eventId: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  try {
    await ipcRedactMessage(roomId, eventId);
    showSuccess("Message deleted");
  } catch (err) {
    showError(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Open a thread view for a given root event.
 */
export async function openThread(eventId: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const { threadView } = getComponents();
  AppState.set("threadRootEventId", eventId);

  // Find root message in timeline cache
  const cached = AppState.get("currentTimeline");
  const rootEvent = cached.find((e) => e.event_id === eventId);

  if (rootEvent) {
    threadView.setRoot({
      id: rootEvent.event_id,
      senderName: rootEvent.sender,
      timestamp: new Date(rootEvent.timestamp).toISOString(),
      body: rootEvent.body,
      htmlBody: rootEvent.formatted_body ?? undefined,
    });
  }

  try {
    const replies = await getThreadTimeline(roomId, eventId);
    threadView.setReplies(
      replies.map((e) => ({
        id: e.event_id,
        senderName: e.sender,
        timestamp: new Date(e.timestamp).toISOString(),
        body: e.body,
        htmlBody: e.formatted_body ?? undefined,
        type: (e.msg_type === "m.image" ? "image" : e.msg_type === "m.sticker" ? "sticker" : "text") as "text" | "image" | "sticker",
        mediaUrl: e.media_url ?? undefined,
        mediaAlt: e.body,
      }))
    );
    _downloadMessageImages(replies, threadView);
  } catch (err) {
    showError(`Failed to load thread: ${err instanceof Error ? err.message : String(err)}`);
  }

  threadView.show();
}

/**
 * Close the thread view.
 */
export function closeThread(): void {
  const { threadView } = getComponents();
  AppState.set("threadRootEventId", null);
  threadView.hide();
}

/**
 * Show the emoji picker.
 */
export function openEmojiPicker(): void {
  const { emojiPicker } = getComponents();
  emojiPicker.show();
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
      const results = await searchGifs(_gifQuery, "tenor", "", 20);
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
      // Re-fetch with a larger limit to append more results
      const more = await searchGifs(_gifQuery, "tenor", "", _gifResultCount + 20);
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
}

/**
 * Show the sticker picker.
 */
export function openStickerPicker(): void {
  const { stickerPicker } = getComponents();
  stickerPicker.show();
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
        const roomId = await joinRoom(alias);
        showSuccess(`Joined ${roomId}`);
        await refreshRooms();
        await selectRoom(roomId);
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

    case "verify": {
      const userId = parsed.args[0];
      if (!userId) {
        showError("Usage: :verify <user-id>");
        return;
      }
      await startVerification(userId);
      break;
    }

    default:
      showError(`Unknown command: ${parsed.name}`);
  }
}

/**
 * Load and apply a theme by name/path.
 */
export async function loadTheme(name: string): Promise<void> {
  try {
    const theme = await ipcLoadTheme(name);
    applyTheme(theme);
    showSuccess(`Theme "${name}" applied`);
  } catch (err) {
    showError(`Failed to load theme: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Refresh the room list from the backend.
 */
export async function refreshRooms(): Promise<void> {
  const { roomList, spaceStrip } = getComponents();

  try {
    const rooms = await getRooms();
    AppState.set("roomListCache", rooms);

    const spaceId = AppState.get("currentSpaceId");
    if (!spaceId || spaceId === "__home__") {
      roomList.setRooms(rooms.map(roomInfoToEntry));
    }

    // Build space strip from rooms that are spaces
    // (In a real integration the spaces would come from a dedicated IPC call;
    //  for now we surface any cached space IDs we know about.)
    const spaces: SpaceItem[] = [];
    spaceStrip.setSpaces(spaces);
  } catch (err) {
    showError(`Failed to load rooms: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Start a SAS device verification flow for a user.
 */
export async function startVerification(userId: string): Promise<void> {
  const { verification } = getComponents();

  try {
    await startSasVerification(userId, "");
    verification.setState("waiting");
    verification.show();
  } catch (err) {
    showError(`Failed to start verification: ${err instanceof Error ? err.message : String(err)}`);
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

  mainLayout.classList.toggle("quark-layout--member-list-open", next);
}

/** Convert IPC RoomMember → MemberList MemberEntry */
function roomMemberToEntry(m: RoomMember): MemberEntry {
  return {
    id: m.user_id,
    name: m.display_name ?? m.user_id,
    userId: m.user_id,
    powerLevel: m.power_level,
    presence: m.presence ?? "offline",
    avatarUrl: m.avatar_url ?? undefined,
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
    getThumbnail(mxc, 32, 32)
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

/** Download mxc:// image message content and swap in data URLs once ready. */
function _downloadMessageImages(events: TimelineEvent[], timeline: { updateMessageMedia(id: string, dataUrl: string): void }): void {
  for (const e of events) {
    if (!e.media_url || !e.media_url.startsWith("mxc://")) continue;
    const eventId = e.event_id;
    const mxc = e.media_url;
    downloadMedia(mxc).then((dl) => {
      const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
      timeline.updateMessageMedia(eventId, dataUrl);
    }).catch(() => { /* non-critical */ });
  }
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
    getThumbnail(mxc, 32, 32)
      .then((dl) => {
        const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
        _emojiImageCache.set(mxc, dataUrl);
        timeline.resolveInlineEmoji(mxc, dataUrl);
      })
      .catch(() => { /* non-critical */ });
  }
}

/** Download uncached avatar thumbnails and update the timeline when each arrives. */
function _downloadMemberAvatars(members: RoomMember[], timeline: import("../ui/Timeline.js").Timeline): void {
  for (const m of members) {
    if (!m.avatar_url) continue;
    const mxc = m.avatar_url;
    if (_avatarDataUrl.has(mxc)) {
      timeline.updateSenderAvatar(m.user_id, _avatarDataUrl.get(mxc)!);
      continue;
    }
    getThumbnail(mxc, 40, 40).then((dl) => {
      const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
      _avatarDataUrl.set(mxc, dataUrl);
      timeline.updateSenderAvatar(m.user_id, dataUrl);
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
