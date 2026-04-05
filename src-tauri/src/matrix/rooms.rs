use matrix_sdk::{
    room::RoomMemberRole,
    ruma::{
        api::client::room::create_room::v3::Request as CreateRoomRequest,
        events::receipt::ReceiptThread,
        RoomId,
    },
    Client, RoomMemberships,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Semaphore;
use tracing::info;

/// Serializable room info for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomInfo {
    pub room_id: String,
    pub name: Option<String>,
    pub topic: Option<String>,
    pub avatar_url: Option<String>,
    pub unread_count: u64,
    pub notification_count: u64,
    pub is_direct: bool,
    pub is_encrypted: bool,
    pub member_count: u64,
    /// Timestamp (ms since Unix epoch) of the most recent event in the room.
    /// Used to sort DMs by recency. May be None if the room has no local events.
    pub last_activity_ts: Option<u64>,
}

/// Get info for all joined rooms.
pub async fn get_rooms(client: &Client) -> Result<Vec<RoomInfo>, String> {
    let rooms = client.joined_rooms();
    let semaphore = Arc::new(Semaphore::new(8));
    let mut tasks = tokio::task::JoinSet::new();

    for room in rooms {
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        tasks.spawn(async move {
            let _permit = permit;
            let name = room.compute_display_name().await.ok().map(|n| n.to_string());
            let topic = room.topic();
            let avatar_url = room.avatar_url().map(|url| url.to_string());
            let is_direct = room.is_direct().await.unwrap_or(false);
            let is_encrypted = room.is_encrypted().await.unwrap_or(false);
            let member_count = room.joined_members_count();

            let unread = room.unread_notification_counts();
            let notification_count = unread.notification_count;
            let unread_count = unread.highlight_count;

            // Fetch the timestamp of the most recent event from the local store.
            // MessagesOptions::backward() with limit 1 reads from the sqlite cache
            // without a network round-trip when events are already present.
            let last_activity_ts = {
                let mut opts = matrix_sdk::room::MessagesOptions::backward();
                opts.limit = matrix_sdk::ruma::UInt::from(1u32);
                room.messages(opts)
                    .await
                    .ok()
                    .and_then(|page| page.chunk.into_iter().next())
                    .and_then(|ev| ev.raw().deserialize().ok())
                    .map(|deserialized| deserialized.origin_server_ts().get().into())
            };

            RoomInfo {
                room_id: room.room_id().to_string(),
                name,
                topic,
                avatar_url,
                unread_count,
                notification_count,
                is_direct,
                is_encrypted,
                member_count,
                last_activity_ts,
            }
        });
    }

    let mut result = Vec::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(info) = res {
            result.push(info);
        }
    }

    Ok(result)
}

/// Join a room by its ID or alias.
pub async fn join_room(client: &Client, room_id_or_alias: &str) -> Result<String, String> {
    use matrix_sdk::ruma::RoomOrAliasId;

    let id = <&RoomOrAliasId>::try_from(room_id_or_alias)
        .map_err(|e| format!("Invalid room ID or alias: {e}"))?;

    let room = client
        .join_room_by_id_or_alias(id, &[])
        .await
        .map_err(|e| format!("Failed to join room: {e}"))?;

    let room_id = room.room_id().to_string();
    info!(room_id = %room_id, "Joined room");
    Ok(room_id)
}

/// Leave a room by its ID.
pub async fn leave_room(client: &Client, room_id: &str) -> Result<(), String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    room.leave()
        .await
        .map_err(|e| format!("Failed to leave room: {e}"))?;

    info!(room_id = %room_id, "Left room");
    Ok(())
}

/// Serializable room member for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomMemberInfo {
    pub user_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    /// "admin" | "mod" | "member"
    pub power_level: String,
    /// "online" | "unavailable" | "offline" | null
    pub presence: Option<String>,
}

/// Get members of a room.
pub async fn get_room_members(client: &Client, room_id: &str) -> Result<Vec<RoomMemberInfo>, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    let members = room
        .members(RoomMemberships::JOIN)
        .await
        .map_err(|e| format!("Failed to fetch members: {e}"))?;

    Ok(members
        .iter()
        .map(|m| {
            let power_level = match m.suggested_role_for_power_level() {
                RoomMemberRole::Administrator => "admin",
                RoomMemberRole::Moderator => "mod",
                RoomMemberRole::User => "member",
            };
            RoomMemberInfo {
                user_id: m.user_id().to_string(),
                display_name: m.display_name().map(str::to_string),
                avatar_url: m.avatar_url().map(|u| u.to_string()),
                power_level: power_level.to_string(),
                presence: None,
            }
        })
        .collect())
}

/// Mark a room as fully read by sending a read receipt for the latest event.
pub async fn mark_room_read(client: &Client, room_id: &str) -> Result<(), String> {
    use matrix_sdk::ruma::api::client::receipt::create_receipt::v3::ReceiptType;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    // Fetch the latest event ID from the timeline to anchor the receipt
    let opts = matrix_sdk::room::MessagesOptions::backward();
    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch messages for read receipt: {e}"))?;

    if let Some(event) = messages.chunk.first() {
        let event_id = event.kind.event_id().ok_or("Latest event has no ID")?;
        // Send public read receipt (visible to other users)
        room.send_single_receipt(ReceiptType::Read, ReceiptThread::Unthreaded, event_id.to_owned())
            .await
            .map_err(|e| format!("Failed to send read receipt: {e}"))?;
        // Also send private read receipt (not shared with other users, for privacy)
        room.send_single_receipt(ReceiptType::ReadPrivate, ReceiptThread::Unthreaded, event_id.to_owned())
            .await
            .map_err(|e| format!("Failed to send private read receipt: {e}"))?;
    }

    Ok(())
}

/// Options for creating a new room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoomOptions {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub alias: Option<String>,
    pub is_public: bool,
    pub is_direct: bool,
    pub invite: Vec<String>,
    pub enable_encryption: bool,
}

/// Create a new room.
#[allow(dead_code)]
pub async fn create_room(
    client: &Client,
    options: CreateRoomOptions,
) -> Result<String, String> {
    use matrix_sdk::ruma::{
        api::client::room::create_room::v3::RoomPreset,
        RoomAliasId,
    };

    let mut request = CreateRoomRequest::new();

    if let Some(ref name) = options.name {
        request.name = Some(name.as_str().into());
    }

    if let Some(ref topic) = options.topic {
        request.topic = Some(topic.clone());
    }

    if let Some(ref alias) = options.alias {
        let alias_id = RoomAliasId::parse(alias)
            .map_err(|e| format!("Invalid room alias: {e}"))?;
        request.room_alias_name = Some(alias_id.alias().to_owned());
    }

    request.preset = Some(if options.is_public {
        RoomPreset::PublicChat
    } else if options.is_direct {
        RoomPreset::TrustedPrivateChat
    } else {
        RoomPreset::PrivateChat
    });

    request.is_direct = options.is_direct;

    // Add invites
    let invite_ids: Vec<_> = options
        .invite
        .iter()
        .filter_map(|id| matrix_sdk::ruma::UserId::parse(id).ok())
        .collect();
    request.invite = invite_ids;

    let response = client
        .create_room(request)
        .await
        .map_err(|e| format!("Failed to create room: {e}"))?;

    let room_id = response.room_id().to_string();

    // Enable encryption if requested
    if options.enable_encryption {
        if let Some(room) = client.get_room(response.room_id()) {
            room.enable_encryption()
                .await
                .map_err(|e| format!("Failed to enable encryption: {e}"))?;
        }
    }

    info!(room_id = %room_id, "Created room");
    Ok(room_id)
}

/// A single pinned event's content, resolved from the room timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinnedEventInfo {
    pub event_id: String,
    pub sender: String,
    pub body: String,
    pub formatted_body: Option<String>,
    pub timestamp: u64,
}

/// Fetch the pinned events for a room.
pub async fn get_pinned_events(client: &Client, room_id: &str) -> Result<Vec<PinnedEventInfo>, String> {
    use matrix_sdk::ruma::events::StateEventType;
    use matrix_sdk::ruma::EventId;
    use serde_json::Value;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    // Read m.room.pinned_events state event
    let raw_opt = room
        .get_state_event(StateEventType::from("m.room.pinned_events"), "")
        .await
        .map_err(|e| format!("Failed to fetch pinned events state: {e}"))?;

    let raw = match raw_opt {
        Some(r) => r,
        None => return Ok(vec![]),
    };

    let json: Value = {
        use matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState;
        match raw {
            RawAnySyncOrStrippedState::Sync(r) => r.deserialize_as::<Value>().unwrap_or(Value::Null),
            RawAnySyncOrStrippedState::Stripped(r) => r.deserialize_as::<Value>().unwrap_or(Value::Null),
        }
    };

    let pinned_ids: Vec<String> = json
        .get("content")
        .and_then(|c| c.get("pinned"))
        .and_then(|p| p.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    // Fetch each pinned event directly by ID (one request per event) instead of
    // scanning a large message batch for each pin. Cap at 20 and limit concurrency
    // to 5 simultaneous fetches to avoid flooding the server.
    let semaphore = Arc::new(Semaphore::new(5));
    let mut tasks = tokio::task::JoinSet::new();

    for event_id_str in pinned_ids.into_iter().take(20) {
        let Ok(event_id) = EventId::parse(&event_id_str) else { continue };
        let room = room.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();

        tasks.spawn(async move {
            let _permit = permit;
            let Ok(timeline_event) = room.event(&event_id, None).await else {
                return None;
            };
            let Ok(json_val) = timeline_event.raw().deserialize_as::<Value>() else {
                return None;
            };
            let sender = json_val.get("sender").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let ts = json_val.get("origin_server_ts").and_then(|t| t.as_u64()).unwrap_or(0);
            let content = json_val.get("content").unwrap_or(&Value::Null);
            let body = content.get("body").and_then(|b| b.as_str()).unwrap_or("").to_string();
            let formatted_body = content.get("formatted_body").and_then(|b| b.as_str()).map(str::to_string);
            Some(PinnedEventInfo {
                event_id: event_id_str,
                sender,
                body,
                formatted_body,
                timestamp: ts,
            })
        });
    }

    let mut result = Vec::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(Some(info)) = res {
            result.push(info);
        }
    }
    result.sort_by_key(|e| e.timestamp);

    Ok(result)
}

/// Serializable public room for the room directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicRoomInfo {
    pub room_id: String,
    pub name: Option<String>,
    pub topic: Option<String>,
    pub alias: Option<String>,
    pub avatar_url: Option<String>,
    pub member_count: Option<u64>,
}

/// Search the public room directory.
pub async fn search_room_directory(
    client: &Client,
    filter: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<PublicRoomInfo>, String> {
    use matrix_sdk::ruma::api::client::directory::get_public_rooms_filtered::v3::Request as PubRoomsRequest;
    use matrix_sdk::ruma::directory::Filter;
    use matrix_sdk::ruma::UInt;

    let mut request = PubRoomsRequest::new();

    if let Some(limit_val) = limit {
        request.limit = Some(UInt::from(limit_val));
    }

    if let Some(filter_text) = filter {
        let mut f = Filter::new();
        f.generic_search_term = Some(filter_text);
        request.filter = f;
    }

    let response = client
        .public_rooms_filtered(request)
        .await
        .map_err(|e| format!("Room directory search failed: {e}"))?;

    Ok(response
        .chunk
        .into_iter()
        .map(|room| PublicRoomInfo {
            room_id: room.room_id.to_string(),
            name: room.name,
            topic: room.topic,
            alias: room.canonical_alias.map(|a| a.to_string()),
            avatar_url: room.avatar_url.map(|u| u.to_string()),
            member_count: Some(room.num_joined_members.into()),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    fn make_room_info(
        room_id: &str,
        name: Option<&str>,
        is_direct: bool,
        is_encrypted: bool,
    ) -> RoomInfo {
        RoomInfo {
            room_id: room_id.to_string(),
            name: name.map(str::to_string),
            topic: None,
            avatar_url: None,
            unread_count: 0,
            notification_count: 0,
            is_direct,
            is_encrypted,
            member_count: 2,
            last_activity_ts: None,
        }
    }

    // --- RoomInfo serialization ---

    #[test]
    fn test_room_info_serialization_roundtrip() {
        let info = RoomInfo {
            room_id: "!abc:example.com".to_string(),
            name: Some("General".to_string()),
            topic: Some("Welcome!".to_string()),
            avatar_url: Some("mxc://example.com/avatar".to_string()),
            unread_count: 5,
            notification_count: 2,
            is_direct: false,
            is_encrypted: true,
            member_count: 42,
            last_activity_ts: Some(1_700_000_000_000),
        };
        let json = serde_json::to_string(&info).expect("serialize");
        let back: RoomInfo = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!abc:example.com");
        assert_eq!(back.name.as_deref(), Some("General"));
        assert_eq!(back.topic.as_deref(), Some("Welcome!"));
        assert_eq!(back.unread_count, 5);
        assert_eq!(back.notification_count, 2);
        assert!(back.is_encrypted);
        assert!(!back.is_direct);
        assert_eq!(back.member_count, 42);
        assert_eq!(back.last_activity_ts, Some(1_700_000_000_000));
    }

    #[test]
    fn test_room_info_optional_fields_can_be_none() {
        let info = make_room_info("!xyz:example.com", None, false, false);
        let json = serde_json::to_string(&info).expect("serialize");
        let back: RoomInfo = serde_json::from_str(&json).expect("deserialize");
        assert!(back.name.is_none());
        assert!(back.topic.is_none());
        assert!(back.avatar_url.is_none());
    }

    #[test]
    fn test_room_info_zero_counts() {
        let info = make_room_info("!zero:example.com", Some("Empty"), false, false);
        let json = serde_json::to_string(&info).expect("serialize");
        let back: RoomInfo = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.unread_count, 0);
        assert_eq!(back.notification_count, 0);
    }

    #[test]
    fn test_room_info_direct_and_encrypted_flags() {
        let info = make_room_info("!dm:example.com", Some("Alice"), true, true);
        let json = serde_json::to_string(&info).expect("serialize");
        let back: RoomInfo = serde_json::from_str(&json).expect("deserialize");
        assert!(back.is_direct);
        assert!(back.is_encrypted);
    }

    #[test]
    fn test_room_info_json_has_expected_keys() {
        let info = make_room_info("!test:example.com", Some("Test"), false, false);
        let json = serde_json::to_string(&info).expect("serialize");
        let val: serde_json::Value = serde_json::from_str(&json).expect("parse json");
        assert!(val.get("room_id").is_some());
        assert!(val.get("name").is_some());
        assert!(val.get("unread_count").is_some());
        assert!(val.get("notification_count").is_some());
        assert!(val.get("is_direct").is_some());
        assert!(val.get("is_encrypted").is_some());
        assert!(val.get("member_count").is_some());
        assert!(val.get("last_activity_ts").is_some());
    }

    // --- CreateRoomOptions serialization ---

    #[test]
    fn test_create_room_options_roundtrip() {
        let opts = CreateRoomOptions {
            name: Some("My Room".to_string()),
            topic: Some("A topic".to_string()),
            alias: Some("#myroom:example.com".to_string()),
            is_public: true,
            is_direct: false,
            invite: vec!["@alice:example.com".to_string()],
            enable_encryption: true,
        };
        let json = serde_json::to_string(&opts).expect("serialize");
        let back: CreateRoomOptions = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.name.as_deref(), Some("My Room"));
        assert!(back.is_public);
        assert!(back.enable_encryption);
        assert_eq!(back.invite.len(), 1);
        assert_eq!(back.invite[0], "@alice:example.com");
    }

    #[test]
    fn test_create_room_options_empty_invite_list() {
        let opts = CreateRoomOptions {
            name: None,
            topic: None,
            alias: None,
            is_public: false,
            is_direct: true,
            invite: vec![],
            enable_encryption: false,
        };
        let json = serde_json::to_string(&opts).expect("serialize");
        let back: CreateRoomOptions = serde_json::from_str(&json).expect("deserialize");
        assert!(back.invite.is_empty());
        assert!(back.is_direct);
        assert!(!back.enable_encryption);
    }
}
