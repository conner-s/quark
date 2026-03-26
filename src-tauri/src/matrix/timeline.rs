use matrix_sdk::{
    room::MessagesOptions,
    ruma::{
        events::{
            relation::InReplyTo,
            room::message::{
                MessageType, OriginalSyncRoomMessageEvent, Relation,
                RoomMessageEventContent, TextMessageEventContent,
            },
            AnySyncMessageLikeEvent, AnySyncTimelineEvent, SyncMessageLikeEvent,
        },
        EventId, OwnedEventId, RoomId, TransactionId, UInt,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::info;

use crate::matrix::reactions::ReactionGroup;

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
    /// Aggregated reactions from the same fetch batch.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reactions: Vec<ReactionGroup>,
}

/// A page of timeline events plus a token for loading the previous (older) page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelinePage {
    pub events: Vec<TimelineEvent>,
    /// Pagination token: pass as `before` to `get_timeline` to load older messages.
    /// `None` means the beginning of the room history has been reached.
    pub prev_batch: Option<String>,
}

/// Fetch recent timeline events for a room.
/// Also aggregates any reaction events found in the same batch and attaches
/// them to their target messages so the frontend can display them immediately.
pub async fn get_timeline(
    client: &Client,
    room_id: &str,
    limit: usize,
    before: Option<String>,
) -> Result<TimelinePage, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut opts = MessagesOptions::backward();
    opts.limit = UInt::try_from(limit as u64).unwrap_or(UInt::from(50u32));
    opts.from = before;

    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch timeline: {e}"))?;
    let prev_batch = messages.end.clone();

    let own_user_id = client.user_id().map(|u| u.to_string()).unwrap_or_default();

    let mut events: Vec<TimelineEvent> = Vec::new();
    // target_event_id -> Vec<(key, sender_id, reaction_event_id)>
    let mut reaction_raw: HashMap<String, Vec<(String, String, String)>> = HashMap::new();

    for timeline_event in messages.chunk {
        if let Ok(deserialized) = timeline_event.raw().deserialize() {
            match deserialized {
                AnySyncTimelineEvent::MessageLike(
                    AnySyncMessageLikeEvent::RoomMessage(SyncMessageLikeEvent::Original(ev)),
                ) => {
                    events.push(convert_sync_room_message(ev));
                }
                AnySyncTimelineEvent::MessageLike(
                    AnySyncMessageLikeEvent::Reaction(SyncMessageLikeEvent::Original(ev)),
                ) => {
                    let target = ev.content.relates_to.event_id.to_string();
                    let key = ev.content.relates_to.key.clone();
                    let sender = ev.sender.to_string();
                    let rev_id = ev.event_id.to_string();
                    reaction_raw.entry(target).or_default().push((key, sender, rev_id));
                }
                _ => {}
            }
        }
    }

    // Aggregate and attach reactions to their target messages
    for ev in &mut events {
        if let Some(rxns) = reaction_raw.get(&ev.event_id) {
            let mut agg: HashMap<String, (u64, Vec<String>, bool, Option<String>)> =
                HashMap::new();
            for (key, sender, rev_id) in rxns {
                let e = agg.entry(key.clone()).or_insert((0, Vec::new(), false, None));
                e.0 += 1;
                e.1.push(sender.clone());
                if sender == &own_user_id {
                    e.2 = true;
                    e.3 = Some(rev_id.clone());
                }
            }
            ev.reactions = agg
                .into_iter()
                .map(|(key, (count, senders, own_reaction, own_event_id))| ReactionGroup {
                    key,
                    count,
                    senders,
                    own_reaction,
                    own_event_id,
                })
                .collect();
        }
    }

    // Reverse so oldest messages come first
    events.reverse();
    Ok(TimelinePage { events, prev_batch })
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
        reactions: vec![],
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

/// Send a plain text message to a room, optionally as a reply.
pub async fn send_message(
    client: &Client,
    room_id: &str,
    body: &str,
    formatted_body: Option<&str>,
    in_reply_to: Option<&str>,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut content = if let Some(formatted) = formatted_body {
        RoomMessageEventContent::text_html(body, formatted)
    } else {
        RoomMessageEventContent::text_plain(body)
    };

    if let Some(reply_event_id) = in_reply_to {
        let owned_id = OwnedEventId::try_from(reply_event_id)
            .map_err(|e| format!("Invalid reply event ID: {e}"))?;
        content.relates_to = Some(Relation::Reply {
            in_reply_to: InReplyTo::new(owned_id),
        });
    }

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

/// Send an image (m.image) event to a room.
pub async fn send_image(
    client: &Client,
    room_id: &str,
    body: &str,
    mxc_url: &str,
    mime_type: &str,
    width: Option<u64>,
    height: Option<u64>,
) -> Result<String, String> {
    use matrix_sdk::ruma::{
        events::room::{
            message::ImageMessageEventContent,
            ImageInfo, MediaSource,
        },
        MxcUri,
    };

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mxc_uri = <&MxcUri>::try_from(mxc_url).map_err(|e| format!("Invalid mxc URI: {e}"))?;
    let source = MediaSource::Plain(mxc_uri.to_owned());

    let mut img_info = ImageInfo::default();
    img_info.mimetype = Some(mime_type.to_string());
    img_info.width = width.and_then(|w| UInt::try_from(w).ok());
    img_info.height = height.and_then(|h| UInt::try_from(h).ok());

    let mut img_content = ImageMessageEventContent::new(body.to_string(), source);
    img_content.info = Some(Box::new(img_info));

    let msg_content = RoomMessageEventContent::new(MessageType::Image(img_content));

    let response = room
        .send(msg_content)
        .await
        .map_err(|e| format!("Failed to send image: {e}"))?;

    let event_id = response.event_id.to_string();
    info!(event_id = %event_id, "Image sent");
    Ok(event_id)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    fn make_text_event(event_id: &str, sender: &str, body: &str) -> TimelineEvent {
        TimelineEvent {
            event_id: event_id.to_string(),
            sender: sender.to_string(),
            body: body.to_string(),
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
            reactions: vec![],
        }
    }

    // --- TimelineEvent serialization ---

    #[test]
    fn test_timeline_event_text_roundtrip() {
        let ev = make_text_event("$ev1:example.com", "@alice:example.com", "Hello, world!");
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.event_id, "$ev1:example.com");
        assert_eq!(back.sender, "@alice:example.com");
        assert_eq!(back.body, "Hello, world!");
        assert_eq!(back.msg_type, "m.text");
        assert_eq!(back.timestamp, 1_700_000_000_000);
        assert!(!back.is_edit);
        assert!(back.formatted_body.is_none());
        assert!(back.media_url.is_none());
    }

    #[test]
    fn test_timeline_event_with_formatted_body() {
        let ev = TimelineEvent {
            formatted_body: Some("<b>Hello</b>".to_string()),
            ..make_text_event("$ev2:example.com", "@bob:example.com", "Hello")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.formatted_body.as_deref(), Some("<b>Hello</b>"));
    }

    #[test]
    fn test_timeline_event_image_message() {
        let ev = TimelineEvent {
            msg_type: "m.image".to_string(),
            body: "photo.png".to_string(),
            media_url: Some("mxc://example.com/photo".to_string()),
            media_mimetype: Some("image/png".to_string()),
            media_width: Some(1920),
            media_height: Some(1080),
            ..make_text_event("$ev3:example.com", "@alice:example.com", "photo.png")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.msg_type, "m.image");
        assert_eq!(back.media_url.as_deref(), Some("mxc://example.com/photo"));
        assert_eq!(back.media_mimetype.as_deref(), Some("image/png"));
        assert_eq!(back.media_width, Some(1920));
        assert_eq!(back.media_height, Some(1080));
    }

    #[test]
    fn test_timeline_event_edit_flag() {
        let ev = TimelineEvent {
            is_edit: true,
            relates_to_event_id: Some("$original:example.com".to_string()),
            ..make_text_event("$edit:example.com", "@alice:example.com", "* edited")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert!(back.is_edit);
        assert_eq!(back.relates_to_event_id.as_deref(), Some("$original:example.com"));
    }

    #[test]
    fn test_timeline_event_reply() {
        let ev = TimelineEvent {
            in_reply_to: Some("$parent:example.com".to_string()),
            ..make_text_event("$reply:example.com", "@bob:example.com", "Me too!")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.in_reply_to.as_deref(), Some("$parent:example.com"));
        assert!(back.thread_root.is_none());
    }

    #[test]
    fn test_timeline_event_thread() {
        let ev = TimelineEvent {
            thread_root: Some("$thread:example.com".to_string()),
            in_reply_to: Some("$prev:example.com".to_string()),
            ..make_text_event("$threaded:example.com", "@carol:example.com", "Thread reply")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.thread_root.as_deref(), Some("$thread:example.com"));
        assert_eq!(back.in_reply_to.as_deref(), Some("$prev:example.com"));
    }

    #[test]
    fn test_timeline_event_json_has_expected_keys() {
        let ev = make_text_event("$ev:example.com", "@alice:example.com", "hi");
        let json = serde_json::to_string(&ev).expect("serialize");
        let val: serde_json::Value = serde_json::from_str(&json).expect("parse json");
        for key in &[
            "event_id", "sender", "body", "formatted_body", "timestamp",
            "msg_type", "is_edit", "relates_to_event_id", "in_reply_to",
            "thread_root", "media_url", "media_mimetype", "media_width", "media_height",
        ] {
            assert!(val.get(key).is_some(), "Missing key: {}", key);
        }
    }

    #[test]
    fn test_timeline_event_zero_timestamp() {
        let ev = TimelineEvent {
            timestamp: 0,
            ..make_text_event("$ev:example.com", "@alice:example.com", "old message")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.timestamp, 0);
    }
}
