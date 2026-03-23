// Action dispatcher — connects IPC calls to UI state updates

import { AppState } from "./state.js";

import {
  login as ipcLogin,
  getRooms,
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
} from "../ipc/index.js";

import { applyTheme } from "../theme/loader.js";

import type { AppComponents } from "../ui/App.js";
import type { RoomInfo, TimelineEvent } from "../ipc/types.js";
import type { ParsedCommand } from "../vim/commands.js";

import { showToast, showError, showSuccess } from "../ui/NotificationToast.js";
import { showMainLayout } from "../ui/App.js";

// UI component types for building display data
import type { RoomEntry } from "../ui/RoomList.js";
import type { MessageData } from "../ui/Timeline.js";
import type { SpaceItem } from "../ui/SpaceStrip.js";

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
function timelineEventToMessage(e: TimelineEvent): MessageData {
  const msgType = (() => {
    if (e.msg_type === "m.image") return "image" as const;
    if (e.msg_type === "m.sticker") return "sticker" as const;
    return "text" as const;
  })();

  return {
    id: e.event_id,
    senderName: e.sender,
    timestamp: new Date(e.timestamp).toISOString(),
    body: e.body,
    htmlBody: e.formatted_body ?? undefined,
    type: msgType,
    mediaUrl: e.media_url ?? undefined,
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
    await ipcLogin(homeserver, username, password, "");
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
 * Select a room: fetch timeline, update header, mark read.
 */
export async function selectRoom(roomId: string): Promise<void> {
  const { roomList, roomHeader, timeline, statusBar } = getComponents();
  const prevRoom = AppState.get("currentRoomId");

  AppState.set("currentRoomId", roomId);
  AppState.set("activePanel", "timeline");
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
    const events = await getTimeline(roomId);
    AppState.set("currentTimeline", events);

    const messages = events.map(timelineEventToMessage);
    timeline.setMessages(messages);
  } catch (err) {
    showError(`Failed to load timeline: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Cancel any active reply if we changed rooms
  if (prevRoom !== roomId) {
    cancelReply();
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

  // Clear input immediately
  input.setValue("");

  // Optimistic message
  const optimisticMsg: MessageData = {
    id: `optimistic-${Date.now()}`,
    senderName: "you",
    isOwn: true,
    timestamp: new Date().toISOString(),
    body,
    type: "text",
  };
  timeline.appendMessage(optimisticMsg);

  // Cancel reply state
  if (replyToEventId) {
    cancelReply();
  }

  try {
    await ipcSendMessage(roomId, body);
  } catch (err) {
    showError(`Failed to send: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Send a reaction to an event.
 */
export async function sendReaction(eventId: string, key: string): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  try {
    await ipcSendReaction(roomId, eventId, key);
  } catch (err) {
    showError(`Failed to react: ${err instanceof Error ? err.message : String(err)}`);
  }
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
      }))
    );
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

/**
 * Show the GIF search picker.
 */
export function openGifPicker(): void {
  const { gifPicker } = getComponents();
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
      showToast(
        "Commands: join leave theme upload quit help msg invite kick ban unban nick topic",
        "info",
        6000
      );
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
  const { memberList } = getComponents();
  const current = AppState.get("memberListVisible");
  const next = !current;
  AppState.set("memberListVisible", next);

  memberList.getElement().style.display = next ? "" : "none";
}
