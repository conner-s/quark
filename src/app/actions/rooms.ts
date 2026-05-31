// Room & space navigation actions: selecting rooms/spaces, pagination,
// jumping to messages, joining rooms, DM resolution, and the room list refresh.

import { AppState } from "../state.js";
import { isMobile, closeDrawer } from "../mobile.js";

import {
  getRoomMembers,
  getTimeline,
  getSpaceChildren,
  getUserSpaces,
  getRooms,
  joinRoom as ipcJoinRoom,
  createRoom,
  markRoomRead,
  getEventContext,
  paginateForward,
  downloadMedia,
} from "../../ipc/index.js";

import { getPseudoSpace, sortByRecency } from "../pseudo_spaces.js";

import type { RoomMember } from "../../ipc/types.js";
import type { RoomSection } from "../../ui/RoomList.js";
import type { SpaceItem } from "../../ui/SpaceStrip.js";

import { showError, showSuccess } from "../../ui/NotificationToast.js";

import {
  getComponents,
  paginationState,
  _memberDisplayName,
  _memberAvatarMxc,
  _avatarDataUrl,
  _roomAvatarDataUrl,
  _dmRoomByUser,
  _dmUserByRoom,
  _mediaToBlobUrl,
  roomInfoToEntry,
  roomMemberToEntry,
  _applyEdits,
  _buildThreadRootCounts,
  timelineEventToMessage,
  _downloadReactionEmoji,
  _downloadMessageImages,
  _downloadInlineEmoji,
  _downloadMemberAvatars,
  ensureSenderAvatarDownloaded,
} from "./context.js";
import { closeThread } from "./threads.js";
import { cancelReply } from "./messages.js";
import { openRoomSettings } from "./dialogs.js";
import { openProfileForUser } from "./profile.js";

/**
 * Select a room: fetch timeline, update header, mark read.
 */
export async function selectRoom(roomId: string): Promise<void> {
  const { roomList, roomHeader, timeline, memberList, statusBar, typingIndicator } = getComponents();
  const prevRoom = AppState.get("currentRoomId");

  AppState.set("currentRoomId", roomId);
  AppState.set("activePanel", "timeline");
  // On mobile, picking a room dismisses the room-list drawer — including when the
  // tapped room is already the active one. AppState.set skips no-op changes, so the
  // currentRoomId listener in App.ts that normally closes the drawer won't fire for
  // a re-tap of the current room; closing here covers that case. (#49)
  if (isMobile()) closeDrawer();
  if (AppState.get("threadRootEventId")) closeThread();
  // Clear per-room display name cache so stale names from the previous room
  // don't appear in reply previews before the new room's member list loads.
  _memberDisplayName.clear();
  paginationState.prevBatch = null;
  paginationState.nextBatch = null;
  paginationState.inContextView = false;
  paginationState.paginationLoading = false;
  paginationState.paginationLoadingForward = false;
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

  // Default: clicking the room avatar opens room settings (DM rooms override below)
  roomHeader.setAvatarClickHandler(() => void openRoomSettings(), "Room settings (:roomsettings)");
  roomHeader.setRoom(
    roomName,
    roomInfo?.topic ?? undefined,
    roomInfo?.member_count,
    roomInfo?.is_encrypted,
    cachedRoomAvatar
  );
  // The mobile top bar mirrors the room avatar — tap opens settings.
  getComponents().mobileTopBar.setRoom(roomName, cachedRoomAvatar);
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
        getComponents().mobileTopBar.setRoom(roomName, blobUrl);
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
    paginationState.prevBatch = prev_batch;

    AppState.set("currentTimeline", events);

    // Render with cached display names immediately — update once members arrive
    // Thread replies (thread_root set) are excluded from the main timeline;
    // they belong in the thread panel only.
    const threadRootCounts = _buildThreadRootCounts(events);
    const mainEvents = _applyEdits(events).filter((e) => !e.thread_root);
    const messages = mainEvents.map((e) => timelineEventToMessage(e, events, threadRootCounts));
    // Pass unread count so the timeline can insert a "── new messages ──" separator
    if (roomInfo && roomInfo.unread_count > 0) {
      timeline.setUnreadCount(roomInfo.unread_count);
    }
    timeline.setMessages(messages);

    // Register pagination callbacks (re-registers on each room change). The
    // top callback fires only when the in-memory buffer is exhausted; the
    // bottom callback fires only while in context view (forward fetches).
    timeline.onScrollToTop(() => void loadMoreMessages());
    timeline.onScrollToBottom(() => void loadMoreMessagesForward());

    // Kick off media/emoji downloads now — these depend only on the timeline
    // events (already fetched) and the rendered DOM, not on member data. Starting
    // them here lets images load in parallel with the member round-trip below
    // instead of waiting for it.
    _downloadMessageImages(events, timeline);
    void _downloadReactionEmoji(events, timeline);
    _downloadInlineEmoji(timeline);

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
          _dmUserByRoom.set(roomId, dmPartnerId);
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

      // Download uncached avatar thumbnails in the background. This depends on
      // member data, so it stays here; the media/emoji downloads were already
      // started above in parallel with the member fetch.
      _downloadMemberAvatars(members, timeline);
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
  if (paginationState.paginationLoading || !paginationState.prevBatch) {
    return;
  }
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const { timeline } = getComponents();
  paginationState.paginationLoading = true;
  timeline.showLoadingMore();

  try {
    // Loop to skip over pages whose events are all non-displayable (reactions,
    // state events, etc. that get filtered by the Rust backend). Cap iterations
    // to avoid a runaway loop on pathological room histories.
    const MAX_EMPTY_PAGES = 10;
    let emptyPages = 0;

    while (paginationState.prevBatch && roomId === AppState.get("currentRoomId")) {
      const page = await getTimeline(roomId, { limit: 50, before: paginationState.prevBatch });
      paginationState.prevBatch = page.prev_batch;

      if (page.events.length === 0) {
        emptyPages++;
        if (!paginationState.prevBatch || emptyPages >= MAX_EMPTY_PAGES) break;
        // History remains but page was all filtered events — keep going
        continue;
      }

      const existingEvents = AppState.get("currentTimeline");
      AppState.set("currentTimeline", [...page.events, ...existingEvents]);

      const threadRootCounts = _buildThreadRootCounts(page.events);
      const mainEvents = _applyEdits(page.events).filter((e) => !e.thread_root);
      const messages = mainEvents.map((e) => timelineEventToMessage(e, page.events, threadRootCounts));
      timeline.prependMessages(messages);

      _downloadMessageImages(page.events, timeline);
      _downloadInlineEmoji(timeline);
      void _downloadReactionEmoji(page.events, timeline);
      // Download avatars for senders not yet cached (e.g., older messages
      // from users whose avatars weren't in the initial timeline page).
      const seenSenders = new Set<string>();
      for (const e of page.events) {
        if (!seenSenders.has(e.sender)) {
          seenSenders.add(e.sender);
          ensureSenderAvatarDownloaded(e.sender, timeline);
        }
      }
      break;
    }
  } catch (err) {
    showError(`Failed to load more messages: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    paginationState.paginationLoading = false;
    timeline.hideLoadingMore();
  }
}

/**
 * Load the next page of newer messages for the current room and append them.
 * Only meaningful in context view (when the timeline is showing a window in
 * the middle of history rather than the live tail). When the forward fetch
 * returns no `next_batch`, the live tail has been reached and we exit context
 * view so subsequent sync messages append normally.
 */
async function loadMoreMessagesForward(): Promise<void> {
  if (paginationState.paginationLoadingForward || !paginationState.inContextView || !paginationState.nextBatch) return;
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const { timeline } = getComponents();
  paginationState.paginationLoadingForward = true;
  timeline.showLoadingMore();

  try {
    const MAX_EMPTY_PAGES = 10;
    let emptyPages = 0;

    while (paginationState.nextBatch && roomId === AppState.get("currentRoomId")) {
      const page = await paginateForward(roomId, paginationState.nextBatch, 50);
      paginationState.nextBatch = page.next_batch;

      if (page.events.length === 0) {
        emptyPages++;
        if (!paginationState.nextBatch || emptyPages >= MAX_EMPTY_PAGES) break;
        continue;
      }

      const existingEvents = AppState.get("currentTimeline");
      AppState.set("currentTimeline", [...existingEvents, ...page.events]);

      const threadRootCounts = _buildThreadRootCounts(page.events);
      const mainEvents = _applyEdits(page.events).filter((e) => !e.thread_root);
      const messages = mainEvents.map((e) => timelineEventToMessage(e, page.events, threadRootCounts));
      timeline.appendMessages(messages);

      _downloadMessageImages(page.events, timeline);
      _downloadInlineEmoji(timeline);
      void _downloadReactionEmoji(page.events, timeline);
      const seenSenders = new Set<string>();
      for (const e of page.events) {
        if (!seenSenders.has(e.sender)) {
          seenSenders.add(e.sender);
          ensureSenderAvatarDownloaded(e.sender, timeline);
        }
      }
      break;
    }

    // Reaching `next_batch === null` means the live tail has been reached.
    // Drop out of context view so future sync messages append at the bottom.
    if (paginationState.nextBatch === null) {
      paginationState.inContextView = false;
      timeline.setContextView(false);
    }
  } catch (err) {
    showError(`Failed to load more messages: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    paginationState.paginationLoadingForward = false;
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

    paginationState.prevBatch = ctx.prev_batch;
    paginationState.nextBatch = ctx.next_batch;
    paginationState.inContextView = ctx.next_batch !== null;

    AppState.set("currentTimeline", ctx.events);
    const threadRootCounts = _buildThreadRootCounts(ctx.events);
    const mainEvents = _applyEdits(ctx.events).filter((e) => !e.thread_root);
    const messages = mainEvents.map((e) => timelineEventToMessage(e, ctx.events, threadRootCounts));
    // skipAutoScroll prevents setMessages from scheduling _scrollToBottom calls
    // that would override the jumpToMessage scroll that follows.
    timeline.setMessages(messages, { skipAutoScroll: true });
    timeline.setContextView(paginationState.inContextView);
    requestAnimationFrame(() => {
      timeline.scrollToMessage(eventId);
    });

    _downloadMessageImages(ctx.events, timeline);
    _downloadInlineEmoji(timeline);
    void _downloadReactionEmoji(ctx.events, timeline);
    const seenSenders = new Set<string>();
    for (const e of ctx.events) {
      if (!seenSenders.has(e.sender)) {
        seenSenders.add(e.sender);
        ensureSenderAvatarDownloaded(e.sender, timeline);
      }
    }
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

  if (!paginationState.inContextView) {
    // Not in context view — just scroll to the bottom of what's loaded
    timeline.selectLast();
    return;
  }

  try {
    const page = await getTimeline(roomId, { limit: 50 });
    paginationState.prevBatch = page.prev_batch;
    paginationState.nextBatch = null;
    paginationState.inContextView = false;

    AppState.set("currentTimeline", page.events);
    const threadRootCounts = _buildThreadRootCounts(page.events);
    const mainEvents = _applyEdits(page.events).filter((e) => !e.thread_root);
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

  const pseudo = getPseudoSpace(spaceId);
  if (pseudo) {
    const allRooms = AppState.get("roomListCache");
    const spaceRoomIds = new Set(AppState.get("spaceRoomIds"));
    const filtered = sortByRecency(allRooms.filter((r) => pseudo.filter(r, spaceRoomIds)));
    roomList.setRooms(filtered.map(roomInfoToEntry));
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
          sections.push({ label: sub.name ?? sub.room_id, rooms: subRooms, spaceId: sub.room_id });
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
        _dmUserByRoom.set(room.room_id, userId);
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
    _dmUserByRoom.set(roomId, userId);
    await refreshRooms();
    await selectRoom(roomId);
  } catch (err) {
    showError(`Failed to open DM: ${err instanceof Error ? err.message : String(err)}`);
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
 * Optimistically reflect a room name/topic edit (from Room settings) in the
 * local cache — and, when it's the current room, the header — so the change is
 * visible immediately instead of waiting for the next sync round-trip. The
 * authoritative value still arrives via `refreshRooms()` on the next
 * `quark://sync/rooms` event.
 */
export function applyLocalRoomMeta(
  roomId: string,
  meta: { name?: string; topic?: string },
): void {
  const cache = AppState.get("roomListCache");
  const updated = cache.map((r) =>
    r.room_id === roomId
      ? {
          ...r,
          ...(meta.name !== undefined ? { name: meta.name } : {}),
          ...(meta.topic !== undefined ? { topic: meta.topic } : {}),
        }
      : r,
  );
  AppState.set("roomListCache", updated);

  if (roomId === AppState.get("currentRoomId")) {
    const entry = updated.find((r) => r.room_id === roomId);
    if (entry) {
      // setRoom leaves member count / encryption / avatar untouched when those
      // args are omitted.
      getComponents().roomHeader.setRoom(entry.name ?? roomId, entry.topic ?? undefined);
    }
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

    // Refresh the current pseudo-space view with fresh data. Real spaces are
    // refreshed by their own getSpaceChildren flow when re-selected.
    const spaceId = AppState.get("currentSpaceId");
    const pseudo = getPseudoSpace(spaceId ?? "__home__");
    if (pseudo) {
      const spaceRoomIdsSet = new Set(AppState.get("spaceRoomIds"));
      const filtered = sortByRecency(rooms.filter((r) => pseudo.filter(r, spaceRoomIdsSet)));
      roomList.setRooms(filtered.map(roomInfoToEntry));
    }
  } catch (err) {
    showError(`Failed to load rooms: ${err instanceof Error ? err.message : String(err)}`);
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
