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
