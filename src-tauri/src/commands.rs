use crate::{
    config::{
        quarkrc::ParsedRc,
        theme::Theme,
    },
    gif::GifResult,
    matrix::{
        client::{MatrixState, OwnProfile, SessionInfo},
        crypto::{CrossSigningInfo, SasInfo, VerificationStatus},
        emoji::EmojiPack,
        media::MediaDownload,
        reactions::ReactionGroup,
        rooms::{CreateRoomOptions, RoomInfo, RoomMemberInfo},
        spaces::SpaceChild,
        threads::ThreadRoot,
        timeline::{TimelineEvent, TimelinePage},
    },
    media_cache::CacheStats,
    notifications::NotificationConfig,
    CacheState,
};
use matrix_sdk::Client;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Helper: clone the client out of the state so it doesn't hold the lock across awaits.
fn get_client(state: &State<'_, MatrixState>) -> Result<Client, String> {
    let guard = state.0.lock().map_err(|_| "State lock poisoned")?;
    guard.as_ref().cloned().ok_or_else(|| "Not logged in".to_string())
}

// ─── Auth Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn login(
    state: State<'_, MatrixState>,
    app_handle: AppHandle,
    homeserver_url: String,
    username: String,
    password: String,
) -> Result<SessionInfo, String> {
    let data_path = app_handle.path().app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;

    let client = crate::matrix::client::build_client(&homeserver_url, data_path).await?;
    let session = crate::matrix::client::login_with_password(&client, &username, &password).await?;

    {
        let mut guard = state.0.lock().map_err(|_| "State lock poisoned")?;
        *guard = Some(client.clone());
    }

    crate::matrix::client::start_sync(client, Some(app_handle)).await;
    Ok(session)
}

#[tauri::command]
pub async fn restore_session(
    state: State<'_, MatrixState>,
    app_handle: AppHandle,
    homeserver_url: String,
    session: SessionInfo,
) -> Result<(), String> {
    let data_path = app_handle.path().app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    let client = crate::matrix::client::build_client(&homeserver_url, data_path).await?;
    crate::matrix::client::restore_session_from_info(&client, &session).await?;

    {
        let mut guard = state.0.lock().map_err(|_| "State lock poisoned")?;
        *guard = Some(client.clone());
    }

    crate::matrix::client::start_sync(client, Some(app_handle)).await;
    Ok(())
}

/// Start the background sync loop and register push-event handlers.
///
/// The frontend should call this command after a successful login or session
/// restore if it needs to restart sync (e.g., after the app was suspended).
/// It is safe to call even if sync is already running — the existing sync
/// task will eventually reconnect on its own; calling this spawns a new one.
#[tauri::command]
pub async fn start_sync(
    state: State<'_, MatrixState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::client::start_sync(client, Some(app_handle)).await;
    Ok(())
}

#[tauri::command]
pub async fn logout(state: State<'_, MatrixState>) -> Result<(), String> {
    let client = {
        let mut guard = state.0.lock().map_err(|_| "State lock poisoned")?;
        guard.take()
    };

    if let Some(c) = client {
        c.matrix_auth()
            .logout()
            .await
            .map_err(|e| format!("Logout failed: {e}"))?;
    }

    Ok(())
}

// ─── Room Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_rooms(state: State<'_, MatrixState>) -> Result<Vec<RoomInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_rooms(&client).await
}

#[tauri::command]
pub async fn get_room_members(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<Vec<RoomMemberInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_room_members(&client, &room_id).await
}

#[tauri::command]
pub async fn join_room(
    state: State<'_, MatrixState>,
    room_id_or_alias: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::join_room(&client, &room_id_or_alias).await
}

#[tauri::command]
pub async fn leave_room(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::leave_room(&client, &room_id).await
}

#[tauri::command]
pub async fn create_room(
    state: State<'_, MatrixState>,
    options: CreateRoomOptions,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::create_room(&client, options).await
}

// ─── Timeline Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_timeline(
    state: State<'_, MatrixState>,
    room_id: String,
    limit: Option<usize>,
    before: Option<String>,
) -> Result<TimelinePage, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::get_timeline(&client, &room_id, limit.unwrap_or(50), before).await
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, MatrixState>,
    room_id: String,
    body: String,
    formatted_body: Option<String>,
    in_reply_to: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::send_message(&client, &room_id, &body, formatted_body.as_deref(), in_reply_to.as_deref()).await
}

#[tauri::command]
pub async fn edit_message(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    new_body: String,
    new_formatted_body: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::edit_message(&client, &room_id, &event_id, &new_body, new_formatted_body.as_deref()).await
}

#[tauri::command]
pub async fn redact_message(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    reason: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::redact_message(&client, &room_id, &event_id, reason.as_deref()).await
}

// ─── Reaction Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_reaction(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    key: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::reactions::send_reaction(&client, &room_id, &event_id, &key).await
}

#[tauri::command]
pub async fn get_reactions(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
) -> Result<Vec<ReactionGroup>, String> {
    let client = get_client(&state)?;
    crate::matrix::reactions::get_reactions(&client, &room_id, &event_id).await
}

// ─── Emoji Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_emoji_packs(
    state: State<'_, MatrixState>,
    room_id: Option<String>,
) -> Result<Vec<EmojiPack>, String> {
    let client = get_client(&state)?;
    crate::matrix::emoji::get_emoji_packs(&client, room_id.as_deref()).await
}

// ─── Sticker Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_sticker_packs(
    state: State<'_, MatrixState>,
    room_id: Option<String>,
) -> Result<Vec<EmojiPack>, String> {
    let client = get_client(&state)?;
    crate::matrix::stickers::get_sticker_packs(&client, room_id.as_deref()).await
}

// ─── Media Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_media(
    state: State<'_, MatrixState>,
    cache_state: State<'_, CacheState>,
    mxc_url: String,
    thumbnail: bool,
    thumbnail_width: Option<u32>,
    thumbnail_height: Option<u32>,
) -> Result<MediaDownload, String> {
    let client = get_client(&state)?;
    crate::matrix::media::download_media_with_cache(
        &client,
        &mxc_url,
        thumbnail,
        thumbnail_width,
        thumbnail_height,
        Some(&cache_state.0),
    )
    .await
}

#[tauri::command]
pub async fn upload_media(
    state: State<'_, MatrixState>,
    file_path: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::media::upload_file(&client, &file_path).await
}

/// Upload image data (base64-encoded) and send it as an m.image event.
/// Used for clipboard paste of images from the frontend.
#[tauri::command]
pub async fn send_pasted_image(
    state: State<'_, MatrixState>,
    room_id: String,
    data_base64: String,
    mime_type: String,
    filename: String,
) -> Result<String, String> {
    let client = get_client(&state)?;

    let data = crate::matrix::media::decode_base64(&data_base64)?;

    let mxc_url = crate::matrix::media::upload_media(
        &client,
        data,
        &mime_type,
        Some(&filename),
    )
    .await?;

    crate::matrix::timeline::send_image(
        &client,
        &room_id,
        &filename,
        &mxc_url,
        &mime_type,
        None,
        None,
    )
    .await
}

#[tauri::command]
pub async fn send_sticker(
    state: State<'_, MatrixState>,
    room_id: String,
    shortcode: String,
    url: String,
    body: Option<String>,
    pack_id: String,
    pack_name: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    let sticker = crate::matrix::stickers::StickerInfo {
        shortcode,
        url,
        body,
        pack_id,
        pack_name,
    };
    crate::matrix::stickers::send_sticker(&client, &room_id, &sticker).await
}

// ─── Crypto Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_verification_status(
    state: State<'_, MatrixState>,
) -> Result<VerificationStatus, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::get_own_verification_status(&client).await
}

#[tauri::command]
pub async fn start_sas_verification(
    state: State<'_, MatrixState>,
    user_id: String,
    device_id: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::start_sas_verification(&client, &user_id, &device_id).await
}

#[tauri::command]
pub async fn accept_verification_request(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::accept_verification_request(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn accept_sas_verification(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::accept_sas_verification(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn confirm_sas_verification(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::confirm_sas_verification(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn cancel_sas_verification(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::cancel_sas_verification(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn get_sas_info(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<Option<SasInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::get_sas_info(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn get_cross_signing_status(
    state: State<'_, MatrixState>,
) -> Result<CrossSigningInfo, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::get_cross_signing_status(&client).await
}

#[tauri::command]
pub async fn bootstrap_cross_signing(
    state: State<'_, MatrixState>,
    password: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::bootstrap_cross_signing(&client, password).await
}

#[tauri::command]
pub async fn get_user_devices(
    state: State<'_, MatrixState>,
    user_id: String,
) -> Result<Vec<VerificationStatus>, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::get_user_verification_statuses(&client, &user_id).await
}

// ─── Spaces Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_space_hierarchy(
    state: State<'_, MatrixState>,
    space_room_id: String,
    max_depth: Option<u8>,
) -> Result<Vec<SpaceChild>, String> {
    let client = get_client(&state)?;
    crate::matrix::spaces::get_space_hierarchy(&client, &space_room_id, max_depth).await
}

#[tauri::command]
pub async fn get_user_spaces(
    state: State<'_, MatrixState>,
) -> Result<Vec<SpaceChild>, String> {
    let client = get_client(&state)?;
    crate::matrix::spaces::get_user_spaces(&client).await
}

// ─── Profile Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_own_profile(
    state: State<'_, MatrixState>,
) -> Result<OwnProfile, String> {
    let client = get_client(&state)?;
    crate::matrix::client::get_own_profile(&client).await
}

// ─── Thread Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_thread_roots(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<Vec<ThreadRoot>, String> {
    let client = get_client(&state)?;
    crate::matrix::threads::get_thread_roots(&client, &room_id).await
}

#[tauri::command]
pub async fn get_thread_timeline(
    state: State<'_, MatrixState>,
    room_id: String,
    thread_root_event_id: String,
) -> Result<Vec<TimelineEvent>, String> {
    let client = get_client(&state)?;
    crate::matrix::threads::get_thread_timeline(&client, &room_id, &thread_root_event_id).await
}

// ─── GIF Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn search_gifs(
    query: String,
    provider: String,
    api_key: String,
    limit: Option<u32>,
    rating: Option<String>,
) -> Result<Vec<GifResult>, String> {
    use crate::gif::GifProvider;

    let limit = limit.unwrap_or(20);
    let rating_str = rating.as_deref().unwrap_or("pg");

    match provider.as_str() {
        "tenor" => {
            let client = crate::gif::tenor::TenorClient::new(api_key);
            client.search(&query, limit, rating_str).await
        }
        "giphy" => {
            let client = crate::gif::giphy::GiphyClient::new(api_key);
            client.search(&query, limit, rating_str).await
        }
        other => Err(format!("Unknown GIF provider: '{}'", other)),
    }
}

/// Download a GIF from an external URL, upload it to the homeserver, and send
/// it as an `m.image` event. This avoids leaking external URLs to recipients.
#[tauri::command]
pub async fn send_gif(
    state: State<'_, MatrixState>,
    room_id: String,
    gif_url: String,
    title: String,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let client = get_client(&state)?;

    // Download GIF bytes from the external URL.
    let http = reqwest::Client::new();
    let response = http
        .get(&gif_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download GIF: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("GIF download failed: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read GIF bytes: {e}"))?
        .to_vec();

    // Upload to the homeserver and get an mxc:// URL.
    let mxc_url = crate::matrix::media::upload_media(
        &client,
        bytes,
        "image/gif",
        Some(&format!("{title}.gif")),
    )
    .await?;

    // Send as m.image event.
    crate::matrix::timeline::send_image(
        &client,
        &room_id,
        &title,
        &mxc_url,
        "image/gif",
        Some(width as u64),
        Some(height as u64),
    )
    .await
}

// ─── Config Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn load_theme(theme_path: String) -> Result<Theme, String> {
    let path = Path::new(&theme_path);
    let theme = crate::config::theme::load_theme_file(path)?;
    let errors = crate::config::theme::validate_theme(&theme);
    if !errors.is_empty() {
        let messages: Vec<String> = errors
            .iter()
            .map(|e| format!("{}: {}", e.field, e.message))
            .collect();
        return Err(format!("Theme validation failed:\n{}", messages.join("\n")));
    }
    Ok(theme)
}

#[tauri::command]
pub async fn parse_quarkrc(content: String) -> Result<ParsedRc, String> {
    Ok(crate::config::quarkrc::parse_quarkrc(&content))
}

/// Load and parse the user's quarkrc from the XDG config dir (~/.config/quark/quarkrc).
/// Returns an empty ParsedRc if the file does not exist.
#[tauri::command]
pub async fn load_quarkrc() -> Result<ParsedRc, String> {
    let dirs = directories::ProjectDirs::from("", "", "quark")
        .ok_or_else(|| "Could not determine config directory".to_string())?;
    let rc_path = dirs.config_dir().join("quarkrc");

    if !rc_path.exists() {
        return Ok(ParsedRc { directives: vec![], errors: vec![] });
    }

    let content = std::fs::read_to_string(&rc_path)
        .map_err(|e| format!("Failed to read quarkrc: {}", e))?;

    Ok(crate::config::quarkrc::parse_quarkrc(&content))
}

// ─── Cache Management Commands ────────────────────────────────────────────────

/// Return aggregate statistics about the on-disk media cache.
#[tauri::command]
pub async fn get_cache_stats(
    cache_state: State<'_, CacheState>,
) -> Result<CacheStats, String> {
    Ok(cache_state.0.stats())
}

/// Wipe all entries from the media cache.
#[tauri::command]
pub async fn clear_media_cache(
    cache_state: State<'_, CacheState>,
) -> Result<(), String> {
    cache_state.0.clear()
}

/// Update the maximum cache size. Evicts LRU entries if the current size exceeds the new limit.
#[tauri::command]
pub async fn set_cache_size_limit(
    cache_state: State<'_, CacheState>,
    size_mb: u64,
) -> Result<(), String> {
    cache_state.0.set_max_size_mb(size_mb)
}

// ─── Notification Commands ────────────────────────────────────────────────────

/// Return the current notification configuration.
#[tauri::command]
pub async fn get_notification_config(
    config_state: State<'_, Mutex<NotificationConfig>>,
) -> Result<NotificationConfig, String> {
    let guard = config_state.lock().map_err(|_| "Notification config lock poisoned")?;
    Ok(guard.clone())
}

/// Replace the current notification configuration.
#[tauri::command]
pub async fn set_notification_config(
    config_state: State<'_, Mutex<NotificationConfig>>,
    config: NotificationConfig,
) -> Result<(), String> {
    let mut guard = config_state.lock().map_err(|_| "Notification config lock poisoned")?;
    *guard = config;
    Ok(())
}

/// Add a room to the mute list so notifications from it are suppressed.
#[tauri::command]
pub async fn mute_room(
    config_state: State<'_, Mutex<NotificationConfig>>,
    room_id: String,
) -> Result<(), String> {
    let mut guard = config_state.lock().map_err(|_| "Notification config lock poisoned")?;
    if !guard.mute_rooms.contains(&room_id) {
        guard.mute_rooms.push(room_id);
    }
    Ok(())
}

/// Remove a room from the mute list.
#[tauri::command]
pub async fn unmute_room(
    config_state: State<'_, Mutex<NotificationConfig>>,
    room_id: String,
) -> Result<(), String> {
    let mut guard = config_state.lock().map_err(|_| "Notification config lock poisoned")?;
    guard.mute_rooms.retain(|r| r != &room_id);
    Ok(())
}

/// Send a test OS notification to verify the system is working.
#[tauri::command]
pub async fn test_notification(app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app_handle
        .notification()
        .builder()
        .title("Quark")
        .body("Notifications are working!")
        .show()
        .map_err(|e| format!("Failed to send test notification: {e}"))
}
