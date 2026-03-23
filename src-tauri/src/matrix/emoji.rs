use matrix_sdk::{
    ruma::{
        events::StateEventType,
        RoomId,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::warn;

/// A single emoji entry within a pack.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmojiEntry {
    /// The shortcode (key in the pack images map).
    pub shortcode: String,
    /// The mxc:// URL of the emoji image.
    pub url: String,
    /// Body/description of the emoji.
    pub body: Option<String>,
    /// Usage: ["emoticon"], ["sticker"], or ["emoticon", "sticker"]
    pub usage: Vec<String>,
}

/// An emoji pack (from im.ponies.room_emotes or im.ponies.user_emotes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmojiPack {
    pub pack_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    /// Source: "room" or "user"
    pub source: String,
    /// The room_id if source == "room"
    pub room_id: Option<String>,
    pub emojis: Vec<EmojiEntry>,
}

/// Parse raw state event content for im.ponies.room_emotes or im.ponies.user_emotes.
fn parse_ponies_pack(
    pack_id: &str,
    source: &str,
    room_id: Option<&str>,
    value: &Value,
) -> Option<EmojiPack> {
    let pack_meta = value.get("pack");
    let display_name = pack_meta
        .and_then(|m| m.get("display_name"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let avatar_url = pack_meta
        .and_then(|m| m.get("avatar_url"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let pack_usage: Vec<String> = pack_meta
        .and_then(|m| m.get("usage"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|u| u.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| vec!["emoticon".to_string()]);

    let images = value.get("images")?.as_object()?;

    let mut emojis = Vec::new();

    for (shortcode, img_data) in images {
        let url = img_data
            .get("url")
            .and_then(|v| v.as_str())
            .map(String::from)?;

        let body = img_data
            .get("body")
            .and_then(|v| v.as_str())
            .map(String::from);

        let usage: Vec<String> = img_data
            .get("usage")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|u| u.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_else(|| pack_usage.clone());

        emojis.push(EmojiEntry {
            shortcode: shortcode.clone(),
            url,
            body,
            usage,
        });
    }

    Some(EmojiPack {
        pack_id: pack_id.to_string(),
        display_name,
        avatar_url,
        source: source.to_string(),
        room_id: room_id.map(String::from),
        emojis,
    })
}

/// Load all emoji packs visible to the user.
pub async fn get_emoji_packs(
    client: &Client,
    room_id: Option<&str>,
) -> Result<Vec<EmojiPack>, String> {
    let mut packs = Vec::new();

    // 1. User account data: im.ponies.user_emotes
    match client
        .account()
        .fetch_account_data(
            matrix_sdk::ruma::events::GlobalAccountDataEventType::from("im.ponies.user_emotes"),
        )
        .await
    {
        Ok(Some(raw)) => {
            if let Ok(value) = raw.deserialize_as::<Value>() {
                // User emotes can contain multiple packs under "packs" key
                if let Some(packs_map) = value.get("packs").and_then(|p| p.as_object()) {
                    for (pack_id, pack_data) in packs_map {
                        if let Some(pack) =
                            parse_ponies_pack(pack_id, "user", None, pack_data)
                        {
                            packs.push(pack);
                        }
                    }
                } else {
                    // Top-level might be a single pack
                    if let Some(pack) = parse_ponies_pack("user_default", "user", None, &value) {
                        packs.push(pack);
                    }
                }
            }
        }
        Ok(None) => {}
        Err(e) => {
            warn!("Failed to fetch user emotes: {e}");
        }
    }

    // 2. Room state events: im.ponies.room_emotes
    if let Some(rid) = room_id {
        let room_id_parsed =
            RoomId::parse(rid).map_err(|e| format!("Invalid room ID: {e}"))?;

        if let Some(room) = client.get_room(&room_id_parsed) {
            let event_type = StateEventType::from("im.ponies.room_emotes");

            match room.get_state_event(event_type, "").await {
                Ok(Some(raw)) => {
                    // Extract JSON from the inner Raw<_> depending on the variant
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
                        if let Some(pack) = parse_ponies_pack(
                            &format!("room_{}", rid),
                            "room",
                            Some(rid),
                            content,
                        ) {
                            packs.push(pack);
                        }
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    warn!("Failed to fetch room emotes for {}: {}", rid, e);
                }
            }
        }
    }

    Ok(packs)
}

/// Resolve a shortcode to its mxc:// URL from the given packs.
pub fn resolve_shortcode(packs: &[EmojiPack], shortcode: &str) -> Option<String> {
    for pack in packs {
        for emoji in &pack.emojis {
            if emoji.shortcode == shortcode {
                return Some(emoji.url.clone());
            }
        }
    }
    None
}
