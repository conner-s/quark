//! Room-list tabs and room tags.
//!
//! The tabs on the space strip — the built-in Home, All Rooms, Direct Messages
//! and Group Rooms, plus any the user defines — are stored as one global
//! account-data event, so the same set follows the account to every device.
//! The backend treats its content as opaque JSON: the frontend owns the schema
//! (`src/app/room_views.ts`) and parses it defensively, the same split the
//! emoji-pack events use.
//!
//! Tabs can filter and group by room tags (`m.tag` room account data), so this
//! is also where tags are written.

use matrix_sdk::ruma::events::tag::{TagInfo, TagName, Tags};
use matrix_sdk::ruma::events::{AnyGlobalAccountDataEventContent, GlobalAccountDataEventType};
use matrix_sdk::ruma::serde::Raw;
use matrix_sdk::ruma::RoomId;
use matrix_sdk::Client;
use serde_json::Value;

/// Global account-data event holding the tab definitions.
pub const VIEWS_EVENT: &str = "tel.quark.room_views";

/// The spec's limit on a tag name.
const MAX_TAG_BYTES: usize = 255;

/// The stored tab definitions, as sync last delivered them; `Null` if the
/// account has none yet. Store only, no request: this runs on every room-list
/// refresh, and sync keeps the store current.
pub async fn get_room_views(client: &Client) -> Value {
    client
        .account()
        .account_data_raw(GlobalAccountDataEventType::from(VIEWS_EVENT))
        .await
        .ok()
        .flatten()
        .and_then(|raw| raw.deserialize_as::<Value>().ok())
        .unwrap_or(Value::Null)
}

/// Replace the stored tab definitions. The content must be a JSON object.
pub async fn set_room_views(client: &Client, content: &Value) -> Result<(), String> {
    if !content.is_object() {
        return Err("Tab definitions must be a JSON object".into());
    }
    let raw: Raw<AnyGlobalAccountDataEventContent> = Raw::new(content)
        .map_err(|e| format!("Couldn't encode tabs: {e}"))?
        .cast();
    client
        .account()
        .set_account_data_raw(GlobalAccountDataEventType::from(VIEWS_EVENT), raw)
        .await
        .map_err(|e| format!("Couldn't save tabs: {e}"))?;
    Ok(())
}

/// A room's tag names, sorted, for `RoomInfo::tags`.
pub fn tag_names(tags: Option<Tags>) -> Vec<String> {
    let mut names: Vec<String> = tags
        .map(|t| t.keys().map(|k| k.as_ref().to_owned()).collect())
        .unwrap_or_default();
    names.sort();
    names
}

/// Check a tag name before sending it.
pub fn validate_tag(tag: &str) -> Result<(), String> {
    if tag.trim().is_empty() {
        return Err("A tag needs a name".into());
    }
    if tag.len() > MAX_TAG_BYTES {
        return Err(format!("A tag name can be at most {MAX_TAG_BYTES} bytes"));
    }
    Ok(())
}

/// Add or remove one tag on a joined room.
///
/// Favourite and low priority exclude each other, as every client treats them:
/// setting one clears the other.
pub async fn set_room_tag(client: &Client, room_id: &str, tag: &str, on: bool) -> Result<(), String> {
    validate_tag(tag)?;
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| "You are not in this room".to_string())?;
    let name = TagName::from(tag.to_owned());
    let result = match (&name, on) {
        (TagName::Favorite, _) => room.set_is_favourite(on, None).await,
        (TagName::LowPriority, _) => room.set_is_low_priority(on, None).await,
        (_, true) => room.set_tag(name, TagInfo::new()).await.map(|_| ()),
        (_, false) => room.remove_tag(name).await.map(|_| ()),
    };
    result.map_err(|e| format!("Couldn't update the room's tags: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_names_are_sorted_and_absent_tags_are_none() {
        assert!(tag_names(None).is_empty());
        let mut tags = Tags::new();
        tags.insert(TagName::from("u.work"), TagInfo::new());
        tags.insert(TagName::Favorite, TagInfo::new());
        tags.insert(TagName::from("com.example.x"), TagInfo::new());
        assert_eq!(tag_names(Some(tags)), vec!["com.example.x", "m.favourite", "u.work"]);
    }

    #[test]
    fn tag_names_are_validated() {
        assert!(validate_tag("u.work").is_ok());
        assert!(validate_tag("").is_err());
        assert!(validate_tag("   ").is_err());
        assert!(validate_tag(&"x".repeat(256)).is_err());
        assert!(validate_tag(&"x".repeat(255)).is_ok());
    }
}
