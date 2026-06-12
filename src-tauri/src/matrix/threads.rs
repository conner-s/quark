use crate::matrix::timeline::TimelineEvent;
use matrix_sdk::{
    room::MessagesOptions,
    ruma::{
        events::{
            room::message::{MessageType, Relation, RoomMessageEventContent},
            AnySyncMessageLikeEvent, AnySyncTimelineEvent, SyncMessageLikeEvent,
        },
        EventId, RoomId, UInt,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use tracing::info;

/// A thread root message with reply count.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadRoot {
    pub event_id: String,
    pub sender: String,
    pub body: String,
    pub timestamp: u64,
    pub reply_count: u64,
    pub latest_reply_timestamp: Option<u64>,
}

/// Get all thread roots in a room (messages that have thread replies).
pub async fn get_thread_roots(
    client: &Client,
    room_id: &str,
) -> Result<Vec<ThreadRoot>, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut opts = MessagesOptions::backward();
    opts.limit = UInt::from(100u32);

    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch messages: {e}"))?;

    // Collect all thread replies and group by root event ID
    use std::collections::HashMap;
    let mut thread_map: HashMap<String, (u64, u64)> = HashMap::new(); // root_id -> (count, latest_ts)

    for timeline_event in &messages.chunk {
        if let Ok(deserialized) = timeline_event.raw().deserialize() {
            if let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(
                SyncMessageLikeEvent::Original(ev),
            )) = deserialized
            {
                if let Some(Relation::Thread(thread)) = &ev.content.relates_to {
                    let root_id = thread.event_id.to_string();
                    let ts: u64 = ev.origin_server_ts.get().into();
                    let entry = thread_map.entry(root_id).or_insert((0, 0));
                    entry.0 += 1;
                    if ts > entry.1 {
                        entry.1 = ts;
                    }
                }
            }
        }
    }

    // Now build ThreadRoot by finding the root events
    let mut roots = Vec::new();

    for timeline_event in &messages.chunk {
        if let Ok(deserialized) = timeline_event.raw().deserialize() {
            if let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(
                SyncMessageLikeEvent::Original(ev),
            )) = deserialized
            {
                let event_id_str = ev.event_id.to_string();
                if let Some((reply_count, latest_ts)) = thread_map.get(&event_id_str) {
                    let body = match &ev.content.msgtype {
                        MessageType::Text(t) => t.body.clone(),
                        _ => "[non-text message]".to_string(),
                    };
                    roots.push(ThreadRoot {
                        event_id: event_id_str,
                        sender: ev.sender.to_string(),
                        body,
                        timestamp: ev.origin_server_ts.get().into(),
                        reply_count: *reply_count,
                        latest_reply_timestamp: Some(*latest_ts),
                    });
                }
            }
        }
    }

    // Sort by timestamp descending (newest thread activity first)
    roots.sort_by(|a, b| {
        b.latest_reply_timestamp
            .cmp(&a.latest_reply_timestamp)
    });

    Ok(roots)
}

/// Get the full timeline of a thread (root + replies).
pub async fn get_thread_timeline(
    client: &Client,
    room_id: &str,
    thread_root_event_id: &str,
) -> Result<Vec<TimelineEvent>, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let root_id = EventId::parse(thread_root_event_id)
        .map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut opts = MessagesOptions::backward();
    opts.limit = UInt::from(100u32);

    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch thread timeline: {e}"))?;

    let mut thread_events = Vec::new();

    for timeline_event in messages.chunk {
        if let Ok(deserialized) = timeline_event.raw().deserialize() {
            if let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(
                SyncMessageLikeEvent::Original(ev),
            )) = deserialized
            {
                let event_id_str = ev.event_id.to_string();
                let is_root = event_id_str == thread_root_event_id;

                let is_thread_reply = matches!(
                    &ev.content.relates_to,
                    Some(Relation::Thread(t)) if t.event_id == root_id
                );

                if is_root || is_thread_reply {
                    let body = match &ev.content.msgtype {
                        MessageType::Text(t) => t.body.clone(),
                        MessageType::Image(i) => i.body.clone(),
                        _ => "[unsupported]".to_string(),
                    };

                    let formatted_body = match &ev.content.msgtype {
                        MessageType::Text(t) => {
                            t.formatted.as_ref().map(|f| crate::matrix::html::sanitize(&f.body))
                        }
                        _ => None,
                    };

                    let thread_root = if is_thread_reply {
                        Some(thread_root_event_id.to_string())
                    } else {
                        None
                    };

                    thread_events.push(TimelineEvent {
                        event_id: event_id_str,
                        sender: ev.sender.to_string(),
                        body,
                        formatted_body,
                        timestamp: ev.origin_server_ts.get().into(),
                        msg_type: "m.text".to_string(),
                        is_edit: false,
                        relates_to_event_id: None,
                        in_reply_to: None,
                        thread_root,
                        media_url: None,
                        media_mimetype: None,
                        media_width: None,
                        media_height: None,
                        caption: None,
                        media_encryption_info: None,
                        media_thumbnail_url: None,
                        media_thumbnail_encryption_info: None,
                        reactions: vec![],
                    });
                }
            }
        }
    }

    // Sort by timestamp ascending
    thread_events.sort_by_key(|e| e.timestamp);

    Ok(thread_events)
}

/// Send a reply in a thread.
pub async fn send_thread_reply(
    client: &Client,
    room_id: &str,
    thread_root_event_id: &str,
    body: &str,
    formatted_body: Option<&str>,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let root_id = EventId::parse(thread_root_event_id)
        .map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let content = if let Some(formatted) = formatted_body {
        RoomMessageEventContent::text_html(body, formatted)
    } else {
        RoomMessageEventContent::text_plain(body)
    };

    use matrix_sdk::ruma::events::relation::Thread as ThreadRelation;
    // Add thread relation to the content
    let mut thread_content = content;
    thread_content.relates_to = Some(Relation::Thread(ThreadRelation::plain(
        root_id.clone(),
        root_id.clone(),
    )));

    let response = room
        .send(thread_content)
        .await
        .map_err(|e| format!("Failed to send thread reply: {e}"))?;

    let event_id = response.event_id.to_string();
    info!(event_id = %event_id, thread_root = %thread_root_event_id, "Thread reply sent");
    Ok(event_id)
}
