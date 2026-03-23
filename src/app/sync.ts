// Sync event handler — listens for backend-pushed events via Tauri event system

import { AppState } from "./state.js";
import type { AppComponents } from "../ui/App.js";
import type { TimelineEvent, RoomInfo } from "../ipc/types.js";
import { refreshRooms, selectRoom } from "./actions.js";
import { showToast } from "../ui/NotificationToast.js";

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
    senderName: e.sender,
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
        // Append to active timeline
        timeline.appendMessage(timelineEventToMessage(payload.event));

        // Also append to state cache
        const current = AppState.get("currentTimeline");
        AppState.set("currentTimeline", [...current, payload.event]);
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
      if (!connected) {
        showToast("Connection lost — reconnecting…", "error", 5000);
      }
    }
  );

  _unlisteners = [
    unlistenMessage,
    unlistenRooms,
    unlistenTyping,
    unlistenPresence,
    unlistenConnected,
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
