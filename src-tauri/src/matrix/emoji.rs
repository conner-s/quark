use matrix_sdk::{
    ruma::{
        events::StateEventType,
        RoomId,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Semaphore;
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
    // If the pack has no explicit `usage` field, default to both emoticon and
    // sticker so that packs that omit usage (common in real-world deployments)
    // are not incorrectly excluded from either picker.
    let pack_usage: Vec<String> = pack_meta
        .and_then(|m| m.get("usage"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|u| u.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| vec!["emoticon".to_string(), "sticker".to_string()]);

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
///
/// Loads from three sources in priority order:
/// 1. `im.ponies.user_emotes` — the user's personal packs
/// 2. `im.ponies.emote_rooms` — globally subscribed room packs (community packs)
/// 3. `im.ponies.room_emotes` on the current room — all state keys, not just ""
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

    // 2. Globally subscribed room packs: im.ponies.emote_rooms
    //
    // Structure: { "rooms": { "!room:server": { "": {}, "pack-key": {} } } }
    // Each entry is a room whose im.ponies.room_emotes state events (at the
    // listed state keys) the user has subscribed to globally.
    match client
        .account()
        .fetch_account_data(
            matrix_sdk::ruma::events::GlobalAccountDataEventType::from("im.ponies.emote_rooms"),
        )
        .await
    {
        Ok(Some(raw)) => {
            if let Ok(value) = raw.deserialize_as::<Value>() {
                if let Some(rooms_map) = value.get("rooms").and_then(|r| r.as_object()) {
                    // Collect all (room, state_key, pack_id, subscribed_rid) work items
                    // up front so we can fetch them concurrently.
                    struct FetchItem {
                        room: matrix_sdk::Room,
                        state_key: String,
                        pack_id: String,
                        subscribed_rid: String,
                    }

                    let mut items: Vec<FetchItem> = Vec::new();
                    for (subscribed_rid, state_keys_val) in rooms_map {
                        let Ok(rid_parsed) = RoomId::parse(subscribed_rid) else { continue };
                        let Some(room) = client.get_room(&rid_parsed) else { continue };

                        let state_keys: Vec<String> = state_keys_val
                            .as_object()
                            .map(|obj| obj.keys().cloned().collect())
                            .unwrap_or_else(|| vec!["".to_string()]);

                        for state_key in state_keys {
                            let pack_id = if state_key.is_empty() {
                                format!("emote_rooms_{}", subscribed_rid)
                            } else {
                                format!("emote_rooms_{}_{}", subscribed_rid, state_key)
                            };
                            items.push(FetchItem {
                                room: room.clone(),
                                state_key,
                                pack_id,
                                subscribed_rid: subscribed_rid.clone(),
                            });
                        }
                    }

                    let semaphore = Arc::new(Semaphore::new(8));
                    let mut tasks = tokio::task::JoinSet::new();

                    for item in items {
                        let permit = semaphore.clone().acquire_owned().await.unwrap();
                        tasks.spawn(async move {
                            let _permit = permit;
                            let event_type = StateEventType::from("im.ponies.room_emotes");
                            match item.room.get_state_event(event_type, item.state_key.as_str()).await {
                                Ok(Some(raw_ev)) => {
                                    let raw_json: Option<Value> = match raw_ev {
                                        matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Sync(r) => {
                                            r.deserialize_as::<Value>().ok()
                                        }
                                        matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Stripped(r) => {
                                            r.deserialize_as::<Value>().ok()
                                        }
                                    };
                                    if let Some(v) = raw_json {
                                        let content = v.get("content").unwrap_or(&v).clone();
                                        return parse_ponies_pack(
                                            &item.pack_id, "room", Some(&item.subscribed_rid), &content,
                                        );
                                    }
                                }
                                Ok(None) => {}
                                Err(e) => {
                                    warn!(
                                        "Failed to fetch emote_rooms pack {}/{}: {}",
                                        item.subscribed_rid, item.state_key, e
                                    );
                                }
                            }
                            None
                        });
                    }

                    while let Some(res) = tasks.join_next().await {
                        if let Ok(Some(pack)) = res {
                            packs.push(pack);
                        }
                    }
                }
            }
        }
        Ok(None) => {}
        Err(e) => {
            warn!("Failed to fetch im.ponies.emote_rooms: {e}");
        }
    }

    // 3. Current room state: im.ponies.room_emotes — all state keys
    //
    // A room can have multiple packs under different state keys (e.g. "" for
    // the main pack, "blobpack" for a secondary one). Previously only "" was
    // fetched; now we use get_state_events() to retrieve all of them.
    if let Some(rid) = room_id {
        let room_id_parsed =
            RoomId::parse(rid).map_err(|e| format!("Invalid room ID: {e}"))?;

        if let Some(room) = client.get_room(&room_id_parsed) {
            let event_type = StateEventType::from("im.ponies.room_emotes");

            match room.get_state_events(event_type).await {
                Ok(raw_events) => {
                    for raw_ev in raw_events {
                        let raw_json: Option<Value> = match raw_ev {
                            matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Sync(r) => {
                                r.deserialize_as::<Value>().ok()
                            }
                            matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Stripped(r) => {
                                r.deserialize_as::<Value>().ok()
                            }
                        };
                        if let Some(v) = raw_json {
                            let state_key = v
                                .get("state_key")
                                .and_then(|s| s.as_str())
                                .unwrap_or("");
                            let content = v.get("content").unwrap_or(&v);
                            let pack_id = if state_key.is_empty() {
                                format!("room_{}", rid)
                            } else {
                                format!("room_{}_{}", rid, state_key)
                            };
                            if let Some(pack) =
                                parse_ponies_pack(&pack_id, "room", Some(rid), content)
                            {
                                packs.push(pack);
                            }
                        }
                    }
                }
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

/// Filter emojis from a pack to only those usable as emoticons.
pub fn emoticons(pack: &EmojiPack) -> Vec<&EmojiEntry> {
    pack.emojis
        .iter()
        .filter(|e| e.usage.iter().any(|u| u == "emoticon"))
        .collect()
}

/// Filter emojis from a pack to only those usable as stickers.
pub fn stickers(pack: &EmojiPack) -> Vec<&EmojiEntry> {
    pack.emojis
        .iter()
        .filter(|e| e.usage.iter().any(|u| u == "sticker"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    fn make_entry(shortcode: &str, url: &str, usage: Vec<&str>) -> EmojiEntry {
        EmojiEntry {
            shortcode: shortcode.to_string(),
            url: url.to_string(),
            body: None,
            usage: usage.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn make_pack(pack_id: &str, source: &str, emojis: Vec<EmojiEntry>) -> EmojiPack {
        EmojiPack {
            pack_id: pack_id.to_string(),
            display_name: Some("Test Pack".to_string()),
            avatar_url: None,
            source: source.to_string(),
            room_id: None,
            emojis,
        }
    }

    // --- Serialization roundtrip ---

    #[test]
    fn test_emoji_entry_serialization_roundtrip() {
        let entry = EmojiEntry {
            shortcode: "wave".to_string(),
            url: "mxc://example.com/wave".to_string(),
            body: Some("Waving hand".to_string()),
            usage: vec!["emoticon".to_string()],
        };
        let json = serde_json::to_string(&entry).expect("serialize");
        let back: EmojiEntry = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.shortcode, "wave");
        assert_eq!(back.url, "mxc://example.com/wave");
        assert_eq!(back.body.as_deref(), Some("Waving hand"));
        assert_eq!(back.usage, vec!["emoticon"]);
    }

    #[test]
    fn test_emoji_entry_no_body_serializes_null() {
        let entry = make_entry("tada", "mxc://example.com/tada", vec!["sticker"]);
        let json = serde_json::to_string(&entry).expect("serialize");
        assert!(json.contains("\"body\":null"));
    }

    #[test]
    fn test_emoji_pack_serialization_roundtrip() {
        let pack = EmojiPack {
            pack_id: "pack_001".to_string(),
            display_name: Some("Blob Pack".to_string()),
            avatar_url: Some("mxc://example.com/avatar".to_string()),
            source: "room".to_string(),
            room_id: Some("!abc:example.com".to_string()),
            emojis: vec![make_entry("blobhug", "mxc://example.com/blobhug", vec!["emoticon"])],
        };
        let json = serde_json::to_string(&pack).expect("serialize");
        let back: EmojiPack = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.pack_id, "pack_001");
        assert_eq!(back.display_name.as_deref(), Some("Blob Pack"));
        assert_eq!(back.source, "room");
        assert_eq!(back.emojis.len(), 1);
        assert_eq!(back.emojis[0].shortcode, "blobhug");
    }

    #[test]
    fn test_emoji_pack_optional_fields_can_be_none() {
        let pack = EmojiPack {
            pack_id: "minimal".to_string(),
            display_name: None,
            avatar_url: None,
            source: "user".to_string(),
            room_id: None,
            emojis: vec![],
        };
        let json = serde_json::to_string(&pack).expect("serialize");
        let back: EmojiPack = serde_json::from_str(&json).expect("deserialize");
        assert!(back.display_name.is_none());
        assert!(back.avatar_url.is_none());
        assert!(back.room_id.is_none());
        assert!(back.emojis.is_empty());
    }

    // --- Usage type filtering ---

    #[test]
    fn test_emoticons_filter() {
        let pack = make_pack("p", "room", vec![
            make_entry("wave", "mxc://a/wave", vec!["emoticon"]),
            make_entry("blob", "mxc://a/blob", vec!["sticker"]),
            make_entry("both", "mxc://a/both", vec!["emoticon", "sticker"]),
        ]);
        let result = emoticons(&pack);
        let shortcodes: Vec<&str> = result.iter().map(|e| e.shortcode.as_str()).collect();
        assert!(shortcodes.contains(&"wave"));
        assert!(shortcodes.contains(&"both"));
        assert!(!shortcodes.contains(&"blob"));
    }

    #[test]
    fn test_stickers_filter() {
        let pack = make_pack("p", "room", vec![
            make_entry("wave", "mxc://a/wave", vec!["emoticon"]),
            make_entry("blob", "mxc://a/blob", vec!["sticker"]),
            make_entry("both", "mxc://a/both", vec!["emoticon", "sticker"]),
        ]);
        let result = stickers(&pack);
        let shortcodes: Vec<&str> = result.iter().map(|e| e.shortcode.as_str()).collect();
        assert!(shortcodes.contains(&"blob"));
        assert!(shortcodes.contains(&"both"));
        assert!(!shortcodes.contains(&"wave"));
    }

    #[test]
    fn test_emoticon_only_pack_has_no_stickers() {
        let pack = make_pack("p", "user", vec![
            make_entry("a", "mxc://x/a", vec!["emoticon"]),
            make_entry("b", "mxc://x/b", vec!["emoticon"]),
        ]);
        assert!(stickers(&pack).is_empty());
        assert_eq!(emoticons(&pack).len(), 2);
    }

    #[test]
    fn test_sticker_only_pack_has_no_emoticons() {
        let pack = make_pack("p", "user", vec![
            make_entry("s1", "mxc://x/s1", vec!["sticker"]),
        ]);
        assert!(emoticons(&pack).is_empty());
        assert_eq!(stickers(&pack).len(), 1);
    }

    // --- resolve_shortcode ---

    #[test]
    fn test_resolve_shortcode_found() {
        let pack = make_pack("p", "room", vec![
            make_entry("wave", "mxc://example.com/wave", vec!["emoticon"]),
            make_entry("tada", "mxc://example.com/tada", vec!["sticker"]),
        ]);
        assert_eq!(
            resolve_shortcode(&[pack], "wave"),
            Some("mxc://example.com/wave".to_string())
        );
    }

    #[test]
    fn test_resolve_shortcode_not_found() {
        let pack = make_pack("p", "room", vec![
            make_entry("wave", "mxc://example.com/wave", vec!["emoticon"]),
        ]);
        assert_eq!(resolve_shortcode(&[pack], "nonexistent"), None);
    }

    #[test]
    fn test_resolve_shortcode_first_match_wins() {
        let pack1 = make_pack("p1", "room", vec![
            make_entry("wave", "mxc://example.com/wave1", vec!["emoticon"]),
        ]);
        let pack2 = make_pack("p2", "user", vec![
            make_entry("wave", "mxc://example.com/wave2", vec!["emoticon"]),
        ]);
        // First pack's URL should be returned
        assert_eq!(
            resolve_shortcode(&[pack1, pack2], "wave"),
            Some("mxc://example.com/wave1".to_string())
        );
    }

    #[test]
    fn test_resolve_shortcode_empty_packs() {
        assert_eq!(resolve_shortcode(&[], "wave"), None);
    }

    #[test]
    fn test_resolve_shortcode_searches_multiple_packs() {
        let pack1 = make_pack("p1", "room", vec![
            make_entry("smile", "mxc://example.com/smile", vec!["emoticon"]),
        ]);
        let pack2 = make_pack("p2", "user", vec![
            make_entry("cry", "mxc://example.com/cry", vec!["emoticon"]),
        ]);
        assert_eq!(
            resolve_shortcode(&[pack1, pack2], "cry"),
            Some("mxc://example.com/cry".to_string())
        );
    }
}
