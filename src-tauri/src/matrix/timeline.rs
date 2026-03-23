use matrix_sdk::{
    room::MessagesOptions,
    ruma::{
        events::{
            room::message::{
                MessageType, OriginalSyncRoomMessageEvent, Relation,
                RoomMessageEventContent, TextMessageEventContent,
            },
            AnySyncMessageLikeEvent, AnySyncTimelineEvent, SyncMessageLikeEvent,
        },
        EventId, RoomId, TransactionId, UInt,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use tracing::info;

/// Serializable timeline event for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEvent {
    pub event_id: String,
    pub sender: String,
    pub body: String,
    pub formatted_body: Option<String>,
    pub timestamp: u64,
    pub msg_type: String,
    pub is_edit: bool,
    pub relates_to_event_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub thread_root: Option<String>,
    /// URL for media messages (images, videos, files, stickers).
    pub media_url: Option<String>,
    pub media_mimetype: Option<String>,
    pub media_width: Option<u64>,
    pub media_height: Option<u64>,
}

/// Fetch recent timeline events for a room.
pub async fn get_timeline(
    client: &Client,
    room_id: &str,
    limit: usize,
) -> Result<Vec<TimelineEvent>, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut opts = MessagesOptions::backward();
    opts.limit = UInt::try_from(limit as u64).unwrap_or(UInt::from(50u32));

    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch timeline: {e}"))?;

    let mut events = Vec::new();

    for timeline_event in messages.chunk {
        if let Ok(deserialized) = timeline_event.raw().deserialize() {
            if let Some(ev) = convert_sync_timeline_event(deserialized) {
                events.push(ev);
            }
        }
    }

    // Reverse so oldest messages come first
    events.reverse();
    Ok(events)
}

fn convert_sync_timeline_event(event: AnySyncTimelineEvent) -> Option<TimelineEvent> {
    match event {
        AnySyncTimelineEvent::MessageLike(msg_event) => convert_sync_message_event(msg_event),
        _ => None,
    }
}

fn convert_sync_message_event(event: AnySyncMessageLikeEvent) -> Option<TimelineEvent> {
    match event {
        AnySyncMessageLikeEvent::RoomMessage(SyncMessageLikeEvent::Original(ev)) => {
            Some(convert_sync_room_message(ev))
        }
        _ => None,
    }
}

fn convert_sync_room_message(ev: OriginalSyncRoomMessageEvent) -> TimelineEvent {
    let timestamp = ev.origin_server_ts.get().into();
    let sender = ev.sender.to_string();
    let event_id = ev.event_id.to_string();

    let (body, formatted_body, msg_type, media_url, media_mimetype, media_width, media_height) =
        extract_message_content(&ev.content);

    let (is_edit, relates_to_event_id, in_reply_to, thread_root) =
        extract_relations(&ev.content);

    TimelineEvent {
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
    }
}

fn extract_message_content(
    content: &RoomMessageEventContent,
) -> (
    String,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    Option<u64>,
    Option<u64>,
) {
    match &content.msgtype {
        MessageType::Text(text) => (
            text.body.clone(),
            text.formatted.as_ref().map(|f| f.body.clone()),
            "m.text".to_string(),
            None,
            None,
            None,
            None,
        ),
        MessageType::Image(image) => {
            use matrix_sdk::ruma::events::room::MediaSource;
            let url = match &image.source {
                MediaSource::Plain(uri) => Some(uri.to_string()),
                MediaSource::Encrypted(file) => Some(file.url.to_string()),
            };
            let (w, h, mime) = if let Some(info) = &image.info {
                (
                    info.width.map(|v| v.into()),
                    info.height.map(|v| v.into()),
                    info.mimetype.clone(),
                )
            } else {
                (None, None, None)
            };
            (image.body.clone(), None, "m.image".to_string(), url, mime, w, h)
        }
        MessageType::Video(video) => {
            use matrix_sdk::ruma::events::room::MediaSource;
            let url = match &video.source {
                MediaSource::Plain(uri) => Some(uri.to_string()),
                MediaSource::Encrypted(file) => Some(file.url.to_string()),
            };
            let (w, h, mime) = if let Some(info) = &video.info {
                (
                    info.width.map(|v| v.into()),
                    info.height.map(|v| v.into()),
                    info.mimetype.clone(),
                )
            } else {
                (None, None, None)
            };
            (video.body.clone(), None, "m.video".to_string(), url, mime, w, h)
        }
        MessageType::Audio(audio) => {
            use matrix_sdk::ruma::events::room::MediaSource;
            let url = match &audio.source {
                MediaSource::Plain(uri) => Some(uri.to_string()),
                MediaSource::Encrypted(file) => Some(file.url.to_string()),
            };
            (audio.body.clone(), None, "m.audio".to_string(), url, None, None, None)
        }
        MessageType::File(file) => {
            use matrix_sdk::ruma::events::room::MediaSource;
            let url = match &file.source {
                MediaSource::Plain(uri) => Some(uri.to_string()),
                MediaSource::Encrypted(f) => Some(f.url.to_string()),
            };
            (file.body.clone(), None, "m.file".to_string(), url, None, None, None)
        }
        MessageType::Emote(emote) => (
            emote.body.clone(),
            emote.formatted.as_ref().map(|f| f.body.clone()),
            "m.emote".to_string(),
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
        ),
        _ => (
            "[unsupported message type]".to_string(),
            None,
            "m.unknown".to_string(),
            None,
            None,
            None,
            None,
        ),
    }
}

fn extract_relations(
    content: &RoomMessageEventContent,
) -> (bool, Option<String>, Option<String>, Option<String>) {
    let mut is_edit = false;
    let mut relates_to_event_id = None;
    let mut in_reply_to = None;
    let mut thread_root = None;

    if let Some(relation) = &content.relates_to {
        match relation {
            Relation::Replacement(replacement) => {
                is_edit = true;
                relates_to_event_id = Some(replacement.event_id.to_string());
            }
            Relation::Reply { in_reply_to: r } => {
                in_reply_to = Some(r.event_id.to_string());
            }
            Relation::Thread(thread) => {
                thread_root = Some(thread.event_id.to_string());
                if let Some(r) = &thread.in_reply_to {
                    in_reply_to = Some(r.event_id.to_string());
                }
            }
            _ => {}
        }
    }

    (is_edit, relates_to_event_id, in_reply_to, thread_root)
}

/// Send a plain text message to a room.
pub async fn send_message(
    client: &Client,
    room_id: &str,
    body: &str,
    formatted_body: Option<&str>,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let content = if let Some(formatted) = formatted_body {
        RoomMessageEventContent::text_html(body, formatted)
    } else {
        RoomMessageEventContent::text_plain(body)
    };

    let response = room
        .send(content)
        .await
        .map_err(|e| format!("Failed to send message: {e}"))?;

    let event_id = response.event_id.to_string();
    info!(event_id = %event_id, "Message sent");
    Ok(event_id)
}

/// Edit an existing message.
pub async fn edit_message(
    client: &Client,
    room_id: &str,
    event_id: &str,
    new_body: &str,
    new_formatted_body: Option<&str>,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let event_id = EventId::parse(event_id).map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let new_content = if let Some(formatted) = new_formatted_body {
        RoomMessageEventContent::text_html(new_body, formatted)
    } else {
        RoomMessageEventContent::text_plain(new_body)
    };

    use matrix_sdk::ruma::events::room::message::ReplacementMetadata;
    let metadata = ReplacementMetadata::new(event_id.clone(), None);
    let edit_content =
        RoomMessageEventContent::new(MessageType::Text(TextMessageEventContent::plain(
            format!("* {}", new_body),
        )))
        .make_replacement(metadata, None);

    let response = room
        .send(edit_content)
        .await
        .map_err(|e| format!("Failed to edit message: {e}"))?;

    let response_event_id = response.event_id.to_string();
    info!(original = %event_id, edit_event = %response_event_id, "Message edited");
    Ok(response_event_id)
}

/// Redact (delete) a message.
pub async fn redact_message(
    client: &Client,
    room_id: &str,
    event_id: &str,
    reason: Option<&str>,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let event_id = EventId::parse(event_id).map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let txn_id = TransactionId::new();
    let response = room
        .redact(&event_id, reason, Some(txn_id))
        .await
        .map_err(|e| format!("Failed to redact message: {e}"))?;

    let redact_event_id = response.event_id.to_string();
    info!(original = %event_id, redaction = %redact_event_id, "Message redacted");
    Ok(redact_event_id)
}
