//! Tauri event emission for Matrix sync updates.
//!
//! This module defines serializable event payload structs and the function
//! that registers matrix-sdk event handlers to push sync events to the frontend
//! via Tauri's event system.

use matrix_sdk::{
    event_handler::Ctx,
    ruma::events::{
        key::verification::request::ToDeviceKeyVerificationRequestEventContent,
        presence::PresenceEvent,
        reaction::ReactionEventContent,
        receipt::ReceiptEventContent,
        room::message::{OriginalSyncRoomMessageEvent, SyncRoomMessageEvent},
        typing::SyncTypingEvent,
        OriginalSyncMessageLikeEvent, SyncEphemeralRoomEvent, ToDeviceEvent,
    },
    Client, Room,
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tracing::{error, warn};

use crate::{
    matrix::{rooms::RoomInfo, timeline::TimelineEvent},
    notifications::NotificationConfig,
};

// ─── Event Name Constants ─────────────────────────────────────────────────────

pub const EVENT_NEW_MESSAGE: &str = "quark://sync/message";
pub const EVENT_ROOM_UPDATE: &str = "quark://sync/rooms";
pub const EVENT_TYPING: &str = "quark://sync/typing";
pub const EVENT_READ_RECEIPT: &str = "quark://sync/read_receipt";
pub const EVENT_PRESENCE: &str = "quark://sync/presence";
pub const EVENT_VERIFICATION_REQUEST: &str = "quark://sync/verification_request";
pub const EVENT_UNREAD_COUNT: &str = "quark://sync/unread_count";
pub const EVENT_CONNECTED: &str = "quark://sync/connected";
pub const EVENT_REACTION: &str = "quark://sync/reaction";

// ─── Event Payload Structs ────────────────────────────────────────────────────

/// Emitted when a new message arrives in a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncNewMessage {
    pub room_id: String,
    pub event: TimelineEvent,
}

/// Emitted when the room list changes (join/leave/name change/etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRoomUpdate {
    pub rooms: Vec<RoomInfo>,
}

/// Emitted when typing indicators change in a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncTypingUpdate {
    pub room_id: String,
    pub user_ids: Vec<String>,
}

/// Emitted when a read receipt is received.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncReadReceipt {
    pub room_id: String,
    pub event_id: String,
    pub user_id: String,
}

/// Emitted when a user's presence changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPresenceUpdate {
    pub user_id: String,
    pub presence: String,
    pub status_msg: Option<String>,
}

/// Emitted when a verification request is received.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncVerificationRequest {
    pub user_id: String,
    pub device_id: String,
    pub flow_id: String,
}

/// Emitted when unread counts change for a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRoomUnreadCount {
    pub room_id: String,
    pub unread_count: u64,
    pub highlight_count: u64,
}

/// Emitted when a reaction is added to an event in a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncReactionUpdate {
    pub room_id: String,
    pub target_event_id: String,
    pub sender: String,
    pub key: String,
    pub reaction_event_id: String,
}

// ─── Handler Registration ─────────────────────────────────────────────────────

/// Register matrix-sdk event handlers that push sync events to the frontend.
///
/// This must be called after the client has logged in and before sync starts,
/// so the handlers are in place when the first sync response arrives.
pub fn setup_sync_event_handlers(client: &Client, app_handle: &tauri::AppHandle) {
    // Store the AppHandle as event handler context so closures can access it.
    client.add_event_handler_context(app_handle.clone());

    // ── New messages ──────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: SyncRoomMessageEvent, room: Room, Ctx(app): Ctx<tauri::AppHandle>| async move {
            // Only handle original (non-redacted) messages.
            if let SyncRoomMessageEvent::Original(original_ev) = ev {
                let room_id = room.room_id().to_string();
                if let Some(timeline_event) = convert_room_message_event(original_ev) {
                    // ── OS notification (if window not focused and config permits) ──
                    let should_send_os_notification = {
                        // Check notification config from managed state.
                        let emit_notification = if let Some(config_state) =
                            app.try_state::<Mutex<NotificationConfig>>()
                        {
                            if let Ok(config) = config_state.lock() {
                                crate::notifications::should_notify(&config, &room_id)
                            } else {
                                false
                            }
                        } else {
                            false
                        };

                        // Check if the sender is the current user — skip self-messages.
                        let is_own_message = app
                            .try_state::<crate::matrix::client::MatrixState>()
                            .and_then(|s| {
                                s.0.lock().ok().and_then(|g: std::sync::MutexGuard<Option<matrix_sdk::Client>>| g.as_ref().cloned())
                            })
                            .map(|client: matrix_sdk::Client| {
                                client
                                    .user_id()
                                    .map(|uid| uid.to_string() == timeline_event.sender)
                                    .unwrap_or(false)
                            })
                            .unwrap_or(false);

                        // Check if the window is focused.
                        let window_focused = app
                            .get_webview_window("main")
                            .and_then(|w: tauri::WebviewWindow| w.is_focused().ok())
                            .unwrap_or(false);

                        emit_notification && !is_own_message && !window_focused
                    };

                    if should_send_os_notification {
                        // Fetch config again for formatting.
                        if let Some(config_state) =
                            app.try_state::<Mutex<NotificationConfig>>()
                        {
                            if let Ok(config) = config_state.lock() {
                                let room_name = room
                                    .name()
                                    .unwrap_or_else(|| room_id.clone());
                                let (title, body) =
                                    crate::notifications::format_notification(
                                        &timeline_event.sender,
                                        &timeline_event.body,
                                        &room_name,
                                        &config,
                                    );
                                if let Err(e) = app
                                    .notification()
                                    .builder()
                                    .title(&title)
                                    .body(&body)
                                    .show()
                                {
                                    error!("Failed to send OS notification: {}", e);
                                }
                            }
                        }
                    }

                    let payload = SyncNewMessage {
                        room_id: room_id.clone(),
                        event: timeline_event,
                    };
                    if let Err(e) = app.emit(EVENT_NEW_MESSAGE, &payload) {
                        error!("Failed to emit {}: {}", EVENT_NEW_MESSAGE, e);
                    }

                    // Also emit updated unread counts for the room.
                    let unread = room.unread_notification_counts();
                    let unread_payload = SyncRoomUnreadCount {
                        room_id,
                        unread_count: unread.highlight_count,
                        highlight_count: unread.notification_count,
                    };
                    if let Err(e) = app.emit(EVENT_UNREAD_COUNT, &unread_payload) {
                        error!("Failed to emit {}: {}", EVENT_UNREAD_COUNT, e);
                    }
                }
            }
        },
    );

    // ── Typing indicators ─────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: SyncTypingEvent, room: Room, Ctx(app): Ctx<tauri::AppHandle>| async move {
            let room_id = room.room_id().to_string();
            let user_ids: Vec<String> =
                ev.content.user_ids.iter().map(|u| u.to_string()).collect();
            let payload = SyncTypingUpdate { room_id, user_ids };
            if let Err(e) = app.emit(EVENT_TYPING, &payload) {
                error!("Failed to emit {}: {}", EVENT_TYPING, e);
            }
        },
    );

    // ── Read receipts ─────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: SyncEphemeralRoomEvent<ReceiptEventContent>,
         room: Room,
         Ctx(app): Ctx<tauri::AppHandle>| async move {
            let room_id = room.room_id().to_string();

            // Walk the receipt map: event_id -> receipt_type -> user_id -> Receipt
            for (event_id, receipts_by_type) in ev.content.iter() {
                for (_receipt_type, user_receipts) in receipts_by_type.iter() {
                    for (user_id, _receipt) in user_receipts.iter() {
                        let payload = SyncReadReceipt {
                            room_id: room_id.clone(),
                            event_id: event_id.to_string(),
                            user_id: user_id.to_string(),
                        };
                        if let Err(e) = app.emit(EVENT_READ_RECEIPT, &payload) {
                            error!("Failed to emit {}: {}", EVENT_READ_RECEIPT, e);
                        }
                    }
                }
            }
        },
    );

    // ── Presence ──────────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: PresenceEvent, Ctx(app): Ctx<tauri::AppHandle>| async move {
            let payload = SyncPresenceUpdate {
                user_id: ev.sender.to_string(),
                presence: ev.content.presence.to_string(),
                status_msg: ev.content.status_msg.clone(),
            };
            if let Err(e) = app.emit(EVENT_PRESENCE, &payload) {
                error!("Failed to emit {}: {}", EVENT_PRESENCE, e);
            }
        },
    );

    // ── Verification requests (to-device) ─────────────────────────────────────
    //
    // Verification requests arrive as to-device events.  matrix-sdk wraps the
    // content in a generic `ToDeviceEvent<C>` container.
    client.add_event_handler(
        |ev: ToDeviceEvent<ToDeviceKeyVerificationRequestEventContent>,
         Ctx(app): Ctx<tauri::AppHandle>| async move {
            let payload = SyncVerificationRequest {
                user_id: ev.sender.to_string(),
                device_id: ev.content.from_device.to_string(),
                flow_id: ev.content.transaction_id.to_string(),
            };
            if let Err(e) = app.emit(EVENT_VERIFICATION_REQUEST, &payload) {
                error!("Failed to emit {}: {}", EVENT_VERIFICATION_REQUEST, e);
            }
        },
    );

    // ── Reactions ─────────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: OriginalSyncMessageLikeEvent<ReactionEventContent>,
         room: Room,
         Ctx(app): Ctx<tauri::AppHandle>| async move {
            let payload = SyncReactionUpdate {
                room_id: room.room_id().to_string(),
                target_event_id: ev.content.relates_to.event_id.to_string(),
                sender: ev.sender.to_string(),
                key: ev.content.relates_to.key.clone(),
                reaction_event_id: ev.event_id.to_string(),
            };
            if let Err(e) = app.emit(EVENT_REACTION, &payload) {
                error!("Failed to emit {}: {}", EVENT_REACTION, e);
            }
        },
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn convert_room_message_event(ev: OriginalSyncRoomMessageEvent) -> Option<TimelineEvent> {
    use matrix_sdk::ruma::events::room::{
        message::{MessageType, Relation},
        MediaSource,
    };

    let event_id = ev.event_id.to_string();
    let sender = ev.sender.to_string();
    let timestamp: u64 = ev.origin_server_ts.get().into();
    let content = &ev.content;

    let enc_info = |source: &MediaSource| -> Option<String> {
        if let MediaSource::Encrypted(file) = source {
            serde_json::to_string(file.as_ref()).ok()
        } else {
            None
        }
    };

    let (body, formatted_body, msg_type, media_url, media_mimetype, media_width, media_height, media_encryption_info) =
        match &content.msgtype {
            MessageType::Text(text) => (
                text.body.clone(),
                text.formatted.as_ref().map(|f| f.body.clone()),
                "m.text".to_string(),
                None,
                None,
                None,
                None,
                None,
            ),
            MessageType::Image(image) => {
                let url = match &image.source {
                    MediaSource::Plain(uri) => Some(uri.to_string()),
                    MediaSource::Encrypted(file) => Some(file.url.to_string()),
                };
                let enc = enc_info(&image.source);
                let (w, h, mime) = if let Some(info) = &image.info {
                    (
                        info.width.map(|v| v.into()),
                        info.height.map(|v| v.into()),
                        info.mimetype.clone(),
                    )
                } else {
                    (None, None, None)
                };
                (image.body.clone(), None, "m.image".to_string(), url, mime, w, h, enc)
            }
            MessageType::Video(video) => {
                let url = match &video.source {
                    MediaSource::Plain(uri) => Some(uri.to_string()),
                    MediaSource::Encrypted(file) => Some(file.url.to_string()),
                };
                let enc = enc_info(&video.source);
                let (w, h, mime) = if let Some(info) = &video.info {
                    (
                        info.width.map(|v| v.into()),
                        info.height.map(|v| v.into()),
                        info.mimetype.clone(),
                    )
                } else {
                    (None, None, None)
                };
                (video.body.clone(), None, "m.video".to_string(), url, mime, w, h, enc)
            }
            MessageType::Audio(audio) => {
                let url = match &audio.source {
                    MediaSource::Plain(uri) => Some(uri.to_string()),
                    MediaSource::Encrypted(file) => Some(file.url.to_string()),
                };
                let enc = enc_info(&audio.source);
                (audio.body.clone(), None, "m.audio".to_string(), url, None, None, None, enc)
            }
            MessageType::File(file) => {
                let url = match &file.source {
                    MediaSource::Plain(uri) => Some(uri.to_string()),
                    MediaSource::Encrypted(f) => Some(f.url.to_string()),
                };
                let enc = enc_info(&file.source);
                (file.body.clone(), None, "m.file".to_string(), url, None, None, None, enc)
            }
            MessageType::Emote(emote) => (
                emote.body.clone(),
                emote.formatted.as_ref().map(|f| f.body.clone()),
                "m.emote".to_string(),
                None,
                None,
                None,
                None,
                None,
            ),
            MessageType::Notice(notice) => (
                notice.body.clone(),
                notice.formatted.as_ref().map(|f| f.body.clone()),
                "m.notice".to_string(),
                None,
                None,
                None,
                None,
                None,
            ),
            _ => (
                "[unsupported message type]".to_string(),
                None,
                "m.unknown".to_string(),
                None,
                None,
                None,
                None,
                None,
            ),
        };

    let (is_edit, relates_to_event_id, in_reply_to, thread_root) = {
        let mut is_edit = false;
        let mut relates_to = None;
        let mut reply_to = None;
        let mut t_root = None;

        if let Some(relation) = &content.relates_to {
            match relation {
                Relation::Replacement(r) => {
                    is_edit = true;
                    relates_to = Some(r.event_id.to_string());
                }
                Relation::Reply { in_reply_to: r } => {
                    reply_to = Some(r.event_id.to_string());
                }
                Relation::Thread(thread) => {
                    t_root = Some(thread.event_id.to_string());
                    if let Some(r) = &thread.in_reply_to {
                        reply_to = Some(r.event_id.to_string());
                    }
                }
                _ => {}
            }
        }
        (is_edit, relates_to, reply_to, t_root)
    };

    Some(TimelineEvent {
        event_id,
        sender,
        body,
        formatted_body,
        timestamp,
        msg_type,
        is_edit,
        relates_to_event_id,
        in_reply_to,
        thread_root,
        media_url,
        media_mimetype,
        media_width,
        media_height,
        media_encryption_info,
        reactions: vec![],
    })
}

// ─── Async room-list helper ───────────────────────────────────────────────────

/// Collect current joined rooms into `RoomInfo` structs and emit a room update.
pub async fn emit_room_update(client: &Client, app_handle: &tauri::AppHandle) {
    match crate::matrix::rooms::get_rooms(client).await {
        Ok(rooms) => {
            let payload = SyncRoomUpdate { rooms };
            if let Err(e) = app_handle.emit(EVENT_ROOM_UPDATE, &payload) {
                error!("Failed to emit {}: {}", EVENT_ROOM_UPDATE, e);
            }
        }
        Err(e) => {
            warn!("emit_room_update: failed to fetch rooms: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    // ── SyncNewMessage ────────────────────────────────────────────────────────

    fn make_timeline_event() -> TimelineEvent {
        TimelineEvent {
            event_id: "$ev:example.com".to_string(),
            sender: "@alice:example.com".to_string(),
            body: "Hello".to_string(),
            formatted_body: None,
            timestamp: 1_700_000_000_000,
            msg_type: "m.text".to_string(),
            is_edit: false,
            relates_to_event_id: None,
            in_reply_to: None,
            thread_root: None,
            media_url: None,
            media_mimetype: None,
            media_width: None,
            media_height: None,
            media_encryption_info: None,
            reactions: vec![],
        }
    }

    #[test]
    fn test_sync_new_message_roundtrip() {
        let payload = SyncNewMessage {
            room_id: "!room:example.com".to_string(),
            event: make_timeline_event(),
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncNewMessage = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!room:example.com");
        assert_eq!(back.event.sender, "@alice:example.com");
    }

    // ── SyncRoomUpdate ────────────────────────────────────────────────────────

    #[test]
    fn test_sync_room_update_empty() {
        let payload = SyncRoomUpdate { rooms: vec![] };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncRoomUpdate = serde_json::from_str(&json).expect("deserialize");
        assert!(back.rooms.is_empty());
    }

    // ── SyncTypingUpdate ──────────────────────────────────────────────────────

    #[test]
    fn test_sync_typing_update_roundtrip() {
        let payload = SyncTypingUpdate {
            room_id: "!room:example.com".to_string(),
            user_ids: vec!["@alice:example.com".to_string(), "@bob:example.com".to_string()],
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncTypingUpdate = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!room:example.com");
        assert_eq!(back.user_ids.len(), 2);
        assert_eq!(back.user_ids[0], "@alice:example.com");
    }

    #[test]
    fn test_sync_typing_update_empty_users() {
        let payload = SyncTypingUpdate {
            room_id: "!room:example.com".to_string(),
            user_ids: vec![],
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncTypingUpdate = serde_json::from_str(&json).expect("deserialize");
        assert!(back.user_ids.is_empty());
    }

    // ── SyncReadReceipt ───────────────────────────────────────────────────────

    #[test]
    fn test_sync_read_receipt_roundtrip() {
        let payload = SyncReadReceipt {
            room_id: "!room:example.com".to_string(),
            event_id: "$event:example.com".to_string(),
            user_id: "@alice:example.com".to_string(),
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncReadReceipt = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!room:example.com");
        assert_eq!(back.event_id, "$event:example.com");
        assert_eq!(back.user_id, "@alice:example.com");
    }

    // ── SyncPresenceUpdate ────────────────────────────────────────────────────

    #[test]
    fn test_sync_presence_update_roundtrip() {
        let payload = SyncPresenceUpdate {
            user_id: "@alice:example.com".to_string(),
            presence: "online".to_string(),
            status_msg: Some("Working from home".to_string()),
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncPresenceUpdate = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.user_id, "@alice:example.com");
        assert_eq!(back.presence, "online");
        assert_eq!(back.status_msg.as_deref(), Some("Working from home"));
    }

    #[test]
    fn test_sync_presence_update_no_status_msg() {
        let payload = SyncPresenceUpdate {
            user_id: "@bob:example.com".to_string(),
            presence: "offline".to_string(),
            status_msg: None,
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncPresenceUpdate = serde_json::from_str(&json).expect("deserialize");
        assert!(back.status_msg.is_none());
    }

    // ── SyncVerificationRequest ───────────────────────────────────────────────

    #[test]
    fn test_sync_verification_request_roundtrip() {
        let payload = SyncVerificationRequest {
            user_id: "@alice:example.com".to_string(),
            device_id: "DEVICE123".to_string(),
            flow_id: "abc123flow".to_string(),
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncVerificationRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.user_id, "@alice:example.com");
        assert_eq!(back.device_id, "DEVICE123");
        assert_eq!(back.flow_id, "abc123flow");
    }

    // ── SyncRoomUnreadCount ───────────────────────────────────────────────────

    #[test]
    fn test_sync_room_unread_count_roundtrip() {
        let payload = SyncRoomUnreadCount {
            room_id: "!room:example.com".to_string(),
            unread_count: 5,
            highlight_count: 2,
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncRoomUnreadCount = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!room:example.com");
        assert_eq!(back.unread_count, 5);
        assert_eq!(back.highlight_count, 2);
    }

    #[test]
    fn test_sync_room_unread_count_zero() {
        let payload = SyncRoomUnreadCount {
            room_id: "!room:example.com".to_string(),
            unread_count: 0,
            highlight_count: 0,
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncRoomUnreadCount = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.unread_count, 0);
        assert_eq!(back.highlight_count, 0);
    }

    // ── Event name constants ──────────────────────────────────────────────────

    #[test]
    fn test_event_name_constants() {
        assert_eq!(EVENT_NEW_MESSAGE, "quark://sync/message");
        assert_eq!(EVENT_ROOM_UPDATE, "quark://sync/rooms");
        assert_eq!(EVENT_TYPING, "quark://sync/typing");
        assert_eq!(EVENT_READ_RECEIPT, "quark://sync/read_receipt");
        assert_eq!(EVENT_PRESENCE, "quark://sync/presence");
        assert_eq!(EVENT_VERIFICATION_REQUEST, "quark://sync/verification_request");
        assert_eq!(EVENT_UNREAD_COUNT, "quark://sync/unread_count");
        assert_eq!(EVENT_CONNECTED, "quark://sync/connected");
    }
}
