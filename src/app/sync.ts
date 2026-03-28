// Sync event handler — listens for backend-pushed events via Tauri event system

import { AppState } from "./state.js";
import type { AppComponents } from "../ui/App.js";
import type { TimelineEvent, RoomInfo } from "../ipc/types.js";
import { refreshRooms, selectRoom, resolveDisplayName, consumeOwnSentEvent, applyIncomingReaction, resolveInlineEmojiForTimeline, handleIncomingVerificationRequest } from "./actions.js";
import { showToast } from "../ui/NotificationToast.js";
import { handleIncomingMessage } from "./notifications.js";

// ── Tauri event types ─────────────────────────────────────────────────────────

interface SyncNewMessagePayload {
  room_id: string;
  event: TimelineEvent;
}

interface SyncRoomListChangedPayload {
  rooms: RoomInfo[];
}

interface SyncTypingPayload {
  room_id: string;
  user_ids: string[];
}

interface SyncPresencePayload {
  user_id: string;
  presence: "online" | "unavailable" | "offline";
}

interface SyncReactionPayload {
  room_id: string;
  target_event_id: string;
  sender: string;
  key: string;
  reaction_event_id: string;
}

interface SyncVerificationRequestPayload {
  user_id: string;
  device_id: string;
  flow_id: string;
}

// ── Tauri event listener shim ─────────────────────────────────────────────────

type UnlistenFn = () => void;

/**
 * Attempt to import @tauri-apps/api/event and call listen().
 * Falls back gracefully if running outside Tauri (e.g. browser dev mode).
 */
async function tauriListen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<T>(event, (e) => handler(e.payload));
  } catch {
    // Not running in Tauri or event not available — no-op unlisten
    return () => {};
  }
}

// ── Message helpers ───────────────────────────────────────────────────────────

function timelineEventToMessage(e: TimelineEvent) {
  const msgType = (() => {
    if (e.msg_type === "m.image") return "image" as const;
    if (e.msg_type === "m.sticker") return "sticker" as const;
    return "text" as const;
  })();

  return {
    id: e.event_id,
    senderId: e.sender,
    senderName: resolveDisplayName(e.sender),
    timestamp: new Date(e.timestamp).toISOString(),
    body: e.body,
    htmlBody: e.formatted_body ?? undefined,
    type: msgType,
    mediaUrl: e.media_url ?? undefined,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

let _unlisteners: UnlistenFn[] = [];

/**
 * Start listening for sync events from the Tauri backend.
 * Returns a cleanup function.
 */
export async function startSync(components: AppComponents): Promise<() => void> {
  const { timeline, roomList, statusBar } = components;

  // ── quark://sync/message ──────────────────────────────────────────────────
  const unlistenMessage = await tauriListen<SyncNewMessagePayload>(
    "quark://sync/message",
    (payload) => {
      const currentRoom = AppState.get("currentRoomId");

      if (payload.room_id === currentRoom) {
        // Deduplicate: skip events already in the state cache (e.g. initial sync
        // replay of messages already loaded via getTimeline, or a second client
        // emitting the same event in dev hot-reload scenarios).
        const current = AppState.get("currentTimeline");
        const alreadyInState = current.some((e) => e.event_id === payload.event.event_id);
        if (!alreadyInState) {
          AppState.set("currentTimeline", [...current, payload.event]);
        }

        // Skip rendering if: (a) already in state (replay), (b) it's our own
        // echo (deduplication via _ownSentEventIds), or (c) it's already in the
        // DOM (race: echo arrived after confirmMessage but before add-to-set).
        const alreadyInDom = !!timeline.getMessageElementById(payload.event.event_id);
        if (!alreadyInState && !alreadyInDom && !consumeOwnSentEvent(payload.event.event_id)) {
          timeline.appendMessage(timelineEventToMessage(payload.event));
          resolveInlineEmojiForTimeline(timeline);
        }
      } else {
        // Update unread count on room list item
        const cached = AppState.get("roomListCache");
        const updated = cached.map((r) => {
          if (r.room_id === payload.room_id) {
            return { ...r, unread_count: r.unread_count + 1 };
          }
          return r;
        });
        AppState.set("roomListCache", updated);
        roomList.setRooms(
          updated.map((r) => ({
            id: r.room_id,
            name: r.name ?? r.room_id,
            unreadCount: r.unread_count,
            mentionCount: r.notification_count,
            muted: false,
          }))
        );
      }

      // Trigger in-app toast when window is focused (OS notification is handled
      // by the Rust backend when the window is not focused).
      const roomName =
        AppState.get("roomListCache").find((r) => r.room_id === payload.room_id)
          ?.name ?? payload.room_id;
      handleIncomingMessage(
        payload.room_id,
        resolveDisplayName(payload.event.sender),
        payload.event.body,
        roomName
      );
    }
  );

  // ── quark://sync/rooms ────────────────────────────────────────────────────
  const unlistenRooms = await tauriListen<SyncRoomListChangedPayload>(
    "quark://sync/rooms",
    (_payload) => {
      void refreshRooms();
    }
  );

  // ── quark://sync/typing ───────────────────────────────────────────────────
  const unlistenTyping = await tauriListen<SyncTypingPayload>(
    "quark://sync/typing",
    (payload) => {
      const currentRoom = AppState.get("currentRoomId");
      if (payload.room_id !== currentRoom) return;

      if (payload.user_ids.length > 0) {
        const names = payload.user_ids.join(", ");
        statusBar.setRoom(`${names} is typing…`);
      } else {
        // Restore room name
        const cached = AppState.get("roomListCache");
        const room = cached.find((r) => r.room_id === currentRoom);
        statusBar.setRoom(room?.name ?? currentRoom ?? null);
      }
    }
  );

  // ── quark://sync/presence ─────────────────────────────────────────────────
  const unlistenPresence = await tauriListen<SyncPresencePayload>(
    "quark://sync/presence",
    (_payload) => {
      // If member list is visible, refresh it
      if (AppState.get("memberListVisible")) {
        // A full refresh would require re-fetching member list from IPC.
        // For now we just note the update is received.
      }
    }
  );

  // ── quark://sync/connected ────────────────────────────────────────────────
  const unlistenConnected = await tauriListen<boolean>(
    "quark://sync/connected",
    (connected) => {
      statusBar.setConnected(connected);
      if (connected) {
        // Refresh rooms after the first sync completes — on first login the
        // initial refreshRooms() fires before sync has populated joined_rooms().
        void refreshRooms();
      } else {
        showToast("Connection lost — reconnecting…", "error", 5000);
      }
    }
  );

  // ── quark://sync/reaction ─────────────────────────────────────────────────
  const unlistenReaction = await tauriListen<SyncReactionPayload>(
    "quark://sync/reaction",
    (payload) => {
      const currentRoom = AppState.get("currentRoomId");
      if (payload.room_id !== currentRoom) return;
      applyIncomingReaction(payload.target_event_id, payload.sender, payload.key, payload.reaction_event_id);
    }
  );

  // ── quark://sync/verification_request ────────────────────────────────────
  const unlistenVerification = await tauriListen<SyncVerificationRequestPayload>(
    "quark://sync/verification_request",
    (payload) => {
      handleIncomingVerificationRequest(
        payload.user_id,
        payload.device_id,
        payload.flow_id,
      );
    }
  );

  _unlisteners = [
    unlistenMessage,
    unlistenRooms,
    unlistenTyping,
    unlistenPresence,
    unlistenConnected,
    unlistenReaction,
    unlistenVerification,
  ];

  // Mark as online
  statusBar.setConnected(true);

  return stopSync;
}

/**
 * Stop all sync listeners.
 */
export function stopSync(): void {
  for (const unlisten of _unlisteners) {
    unlisten();
  }
  _unlisteners = [];
}
