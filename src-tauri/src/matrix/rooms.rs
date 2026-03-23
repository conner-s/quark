use matrix_sdk::{
    ruma::{
        api::client::room::create_room::v3::Request as CreateRoomRequest,
        RoomId,
    },
    Client,
};
use serde::{Deserialize, Serialize};
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
}

/// Get info for all joined rooms.
pub async fn get_rooms(client: &Client) -> Result<Vec<RoomInfo>, String> {
    let rooms = client.joined_rooms();
    let mut result = Vec::with_capacity(rooms.len());

    for room in rooms {
        let name = room.name();
        let topic = room.topic();
        let avatar_url = room.avatar_url().map(|url| url.to_string());
        let is_direct = room.is_direct().await.unwrap_or(false);
        let is_encrypted = room.is_encrypted().await.unwrap_or(false);
        let member_count = room.joined_members_count();

        let unread = room.unread_notification_counts();
        let notification_count = unread.notification_count;
        let unread_count = unread.highlight_count;

        result.push(RoomInfo {
            room_id: room.room_id().to_string(),
            name,
            topic,
            avatar_url,
            unread_count,
            notification_count,
            is_direct,
            is_encrypted,
            member_count,
        });
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
