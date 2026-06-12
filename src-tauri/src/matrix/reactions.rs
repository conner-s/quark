use matrix_sdk::{
    room::MessagesOptions,
    ruma::{
        events::{
            reaction::ReactionEventContent,
            relation::Annotation,
            AnySyncMessageLikeEvent, AnySyncTimelineEvent, SyncMessageLikeEvent,
        },
        EventId, RoomId, TransactionId, UInt,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::info;

/// Aggregated reaction info for a single key (emoji/shortcode).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReactionGroup {
    /// The reaction key — a Unicode emoji or `:shortcode:`.
    pub key: String,
    /// Total count of this reaction.
    pub count: u64,
    /// List of user IDs who reacted.
    pub senders: Vec<String>,
    /// Whether the local user has reacted with this key.
    #[serde(rename = "own")]
    pub own_reaction: bool,
    /// Event ID of the local user's reaction (for toggling/removing).
    pub own_event_id: Option<String>,
}

/// Send a reaction to an event. Returns the new reaction event ID.
pub async fn send_reaction(
    client: &Client,
    room_id: &str,
    event_id: &str,
    key: &str,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let event_id = EventId::parse(event_id).map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let annotation = Annotation::new(event_id.clone(), key.to_owned());
    let content = ReactionEventContent::new(annotation);

    let response = room
        .send(content)
        .await
        .map_err(|e| format!("Failed to send reaction: {e}"))?;

    let reaction_event_id = response.event_id.to_string();
    info!(target = %event_id, reaction = %key, event = %reaction_event_id, "Reaction sent");
    Ok(reaction_event_id)
}

/// Remove a reaction by redacting the reaction event.
pub async fn remove_reaction(
    client: &Client,
    room_id: &str,
    reaction_event_id: &str,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let event_id =
        EventId::parse(reaction_event_id).map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let txn_id = TransactionId::new();
    let response = room
        .redact(&event_id, None, Some(txn_id))
        .await
        .map_err(|e| format!("Failed to remove reaction: {e}"))?;

    Ok(response.event_id.to_string())
}

/// Get aggregated reactions for all events in a room's recent timeline.
pub async fn get_reactions(
    client: &Client,
    room_id: &str,
    target_event_id: &str,
) -> Result<Vec<ReactionGroup>, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let own_user_id = client.user_id().map(|id| id.to_string());

    let mut opts = MessagesOptions::backward();
    opts.limit = UInt::from(100u32);

    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch timeline for reactions: {e}"))?;

    // Aggregate reactions: key -> (count, senders, own_event_id)
    let mut aggregation: HashMap<String, (u64, Vec<String>, Option<String>)> = HashMap::new();

    for timeline_event in messages.chunk {
        if let Ok(deserialized) = timeline_event.raw().deserialize() {
            if let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::Reaction(
                SyncMessageLikeEvent::Original(reaction_ev),
            )) = deserialized
            {
                let annotation = &reaction_ev.content.relates_to;
                if annotation.event_id.as_str() == target_event_id {
                    let key = annotation.key.clone();
                    let sender = reaction_ev.sender.to_string();
                    let reaction_event_id = reaction_ev.event_id.to_string();

                    let entry = aggregation.entry(key).or_insert((0, Vec::new(), None));
                    entry.0 += 1;
                    entry.1.push(sender.clone());
                    if own_user_id.as_deref() == Some(sender.as_str()) {
                        entry.2 = Some(reaction_event_id);
                    }
                }
            }
        }
    }

    let own_user_id_str = own_user_id.as_deref().unwrap_or("");

    let groups: Vec<ReactionGroup> = aggregation
        .into_iter()
        .map(|(key, (count, senders, own_event_id))| {
            let own_reaction = senders.iter().any(|s| s == own_user_id_str);
            ReactionGroup {
                key,
                count,
                senders,
                own_reaction,
                own_event_id,
            }
        })
        .collect();

    Ok(groups)
}
