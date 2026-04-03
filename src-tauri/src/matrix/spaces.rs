use matrix_sdk::{
    ruma::{
        events::StateEventType,
        RoomId,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Semaphore;
use tracing::warn;

/// A child room/space in a space hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceChild {
    pub room_id: String,
    pub name: Option<String>,
    pub topic: Option<String>,
    pub avatar_url: Option<String>,
    pub is_space: bool,
    pub member_count: Option<u64>,
    /// The `order` field from the m.space.child event.
    pub order: Option<String>,
    pub canonical_alias: Option<String>,
}

/// Resolve the direct children of a space room.
pub async fn get_space_hierarchy(
    client: &Client,
    space_room_id: &str,
    max_depth: Option<u8>,
) -> Result<Vec<SpaceChild>, String> {
    let room_id =
        RoomId::parse(space_room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    use matrix_sdk::ruma::api::client::space::get_hierarchy::v1::Request as HierarchyRequest;

    let mut request = HierarchyRequest::new(room_id.clone());
    request.max_depth = max_depth.map(|d| d.into());
    request.limit = Some(matrix_sdk::ruma::UInt::from(100u32));
    request.suggested_only = false;

    let response = client
        .send(request, None)
        .await
        .map_err(|e| format!("Failed to get space hierarchy: {e}"))?;

    let children: Vec<SpaceChild> = response
        .rooms
        .iter()
        .skip(1) // First room is the space itself
        .map(|room_summary| {
            let is_space = room_summary
                .room_type
                .as_ref()
                .map(|t| t == &matrix_sdk::ruma::room::RoomType::Space)
                .unwrap_or(false);

            SpaceChild {
                room_id: room_summary.room_id.to_string(),
                name: room_summary.name.clone().map(String::from),
                topic: room_summary.topic.clone(),
                avatar_url: room_summary.avatar_url.as_ref().map(|u| u.to_string()),
                is_space,
                member_count: Some(room_summary.num_joined_members.into()),
                order: None,
                canonical_alias: room_summary.canonical_alias.as_ref().map(|a| a.to_string()),
            }
        })
        .collect();

    // Enrich with order fields from the parent room's m.space.child state events
    let enriched = enrich_with_order(client, &room_id, children).await;

    Ok(enriched)
}

/// Read m.space.child state events from the parent to get ordering info.
async fn enrich_with_order(
    client: &Client,
    parent_id: &RoomId,
    children: Vec<SpaceChild>,
) -> Vec<SpaceChild> {
    let room = match client.get_room(parent_id) {
        Some(r) => r,
        None => return children,
    };

    let event_type = StateEventType::from("m.space.child");
    let semaphore = Arc::new(Semaphore::new(8));
    let mut tasks = tokio::task::JoinSet::new();

    for mut child in children {
        let room = room.clone();
        let event_type = event_type.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();

        tasks.spawn(async move {
            let _permit = permit;
            let child_room_id_str = child.room_id.clone();

            match room.get_state_event(event_type, child_room_id_str.as_str()).await {
                Ok(Some(raw)) => {
                    use serde_json::Value;
                    let raw_json: Option<Value> = match raw {
                        matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Sync(r) => {
                            r.deserialize_as::<Value>().ok()
                        }
                        matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Stripped(r) => {
                            r.deserialize_as::<Value>().ok()
                        }
                    };
                    if let Some(value) = raw_json {
                        let content = value.get("content").unwrap_or(&value);
                        if let Some(order) = content
                            .get("order")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                        {
                            child.order = Some(order);
                        }
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    warn!("Failed to get m.space.child for {}: {}", child.room_id, e);
                }
            }
            child
        });
    }

    let mut enriched = Vec::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(child) = res {
            enriched.push(child);
        }
    }

    // Sort by order field (lexicographic), then by room name
    enriched.sort_by(|a, b| match (&a.order, &b.order) {
        (Some(oa), Some(ob)) => oa.cmp(ob),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => {
            let name_a = a.name.as_deref().unwrap_or("");
            let name_b = b.name.as_deref().unwrap_or("");
            name_a.cmp(name_b)
        }
    });

    enriched
}

/// List all space rooms the user has joined.
pub async fn get_user_spaces(client: &Client) -> Result<Vec<SpaceChild>, String> {
    use matrix_sdk::ruma::room::RoomType;

    let rooms = client.joined_rooms();
    let spaces: Vec<SpaceChild> = rooms
        .iter()
        .filter(|room| {
            room.room_type()
                .map(|t| t == RoomType::Space)
                .unwrap_or(false)
        })
        .map(|room| SpaceChild {
            room_id: room.room_id().to_string(),
            name: room.name(),
            topic: room.topic(),
            avatar_url: room.avatar_url().map(|u| u.to_string()),
            is_space: true,
            member_count: Some(room.joined_members_count()),
            order: None,
            canonical_alias: room.canonical_alias().map(|a| a.to_string()),
        })
        .collect();

    Ok(spaces)
}
