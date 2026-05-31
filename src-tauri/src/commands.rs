use crate::{
    config::{
        app_config::AppConfig,
        quarkrc::ParsedRc,
    },
    gif::GifResult,
    matrix::{
        client::{MatrixState, OwnProfile, SessionInfo, SyncState},
        crypto::{CrossSigningInfo, SasInfo, VerificationStatus},
        emoji::EmojiPack,
        media::MediaDownload,
        reactions::ReactionGroup,
        rooms::{CreateRoomOptions, PinnedEventInfo, PublicRoomInfo, RoomInfo, RoomMemberInfo},
        spaces::SpaceChild,
        threads::ThreadRoot,
        timeline::{TimelineEvent, TimelinePage},
    },
    media_cache::CacheStats,
    notifications::NotificationConfig,
    CacheState,
};
use matrix_sdk::Client;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Helper: clone the client out of the state so it doesn't hold the lock across awaits.
fn get_client(state: &State<'_, MatrixState>) -> Result<Client, String> {
    let guard = state.0.lock().map_err(|_| "State lock poisoned")?;
    guard.as_ref().cloned().ok_or_else(|| "Not logged in".to_string())
}

/// Remove all matrix-sdk SQLite store files from the data directory.
/// Called on logout and before a fresh login to prevent crypto store conflicts
/// when switching accounts.
fn clear_store(data_dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "sqlite3" || e == "db") {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

// ─── Auth Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn login(
    state: State<'_, MatrixState>,
    sync_state: State<'_, SyncState>,
    app_handle: AppHandle,
    homeserver_url: String,
    username: String,
    password: String,
) -> Result<SessionInfo, String> {
    let data_path = app_handle.path().app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;

    // Clear any leftover store from a previous session to prevent crypto store
    // conflicts when logging in as a different account.
    clear_store(&data_path);

    let client = crate::matrix::client::build_client(&homeserver_url, data_path).await?;
    let session = crate::matrix::client::login_with_password(&client, &username, &password).await?;

    {
        let mut guard = state.0.lock().map_err(|_| "State lock poisoned")?;
        *guard = Some(client.clone());
    }

    crate::matrix::client::start_sync(client, Some(app_handle), &sync_state).await;
    Ok(session)
}

#[tauri::command]
pub async fn restore_session(
    state: State<'_, MatrixState>,
    sync_state: State<'_, SyncState>,
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

    crate::matrix::client::start_sync(client, Some(app_handle), &sync_state).await;
    Ok(())
}

/// Start the background sync loop and register push-event handlers.
///
/// The frontend should call this command after a successful login or session
/// restore if it needs to restart sync (e.g., after the app was suspended).
/// If a sync loop is already running it is aborted first — only one loop is
/// ever active at a time to avoid flooding the homeserver with duplicate
/// requests (which can trigger exponential backoff overflow in Synapse's
/// E2EE key upload worker).
#[tauri::command]
pub async fn start_sync(
    state: State<'_, MatrixState>,
    sync_state: State<'_, SyncState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::client::start_sync(client, Some(app_handle), &sync_state).await;
    Ok(())
}

#[tauri::command]
pub async fn logout(
    state: State<'_, MatrixState>,
    sync_state: State<'_, SyncState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Abort the sync loop before logging out to stop all background requests.
    {
        let mut guard = sync_state.handle.lock().map_err(|_| "SyncState lock poisoned")?;
        if let Some(handle) = guard.take() {
            handle.abort();
        }
    }
    // Reset handler registration flag so a fresh login re-registers handlers
    // on the new client instance.
    {
        let mut registered = sync_state.handlers_registered.lock().map_err(|_| "SyncState lock poisoned")?;
        *registered = false;
    }

    let client = {
        let mut guard = state.0.lock().map_err(|_| "State lock poisoned")?;
        guard.take()
    };

    if let Some(c) = client {
        // Best-effort server-side token revocation; don't fail if the network is down.
        let _ = c.matrix_auth().logout().await;
    }

    // Always clear the local SQLite store so the next login starts clean,
    // regardless of whether the server-side revocation succeeded.
    if let Ok(data_path) = app_handle.path().app_data_dir() {
        clear_store(&data_path);
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

#[tauri::command]
pub async fn mark_room_read(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::mark_room_read(&client, &room_id).await
}

/// Get pinned events for a room.
#[tauri::command]
pub async fn get_pinned_events(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<Vec<PinnedEventInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_pinned_events(&client, &room_id).await
}

/// Search the public room directory.
#[tauri::command]
pub async fn search_room_directory(
    state: State<'_, MatrixState>,
    filter: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<PublicRoomInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::search_room_directory(&client, filter, limit).await
}

// ─── Room Settings Commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn get_power_levels(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<crate::matrix::rooms::PowerLevels, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_power_levels(&client, &room_id).await
}

#[tauri::command]
pub async fn set_power_levels(
    state: State<'_, MatrixState>,
    room_id: String,
    levels: crate::matrix::rooms::PowerLevels,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_power_levels(&client, &room_id, levels).await
}

#[tauri::command]
pub async fn set_room_name(
    state: State<'_, MatrixState>,
    room_id: String,
    name: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_room_name(&client, &room_id, name).await
}

#[tauri::command]
pub async fn set_room_topic(
    state: State<'_, MatrixState>,
    room_id: String,
    topic: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_room_topic(&client, &room_id, topic).await
}

#[tauri::command]
pub async fn set_room_join_rule(
    state: State<'_, MatrixState>,
    room_id: String,
    rule: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_room_join_rule(&client, &room_id, &rule).await
}

#[tauri::command]
pub async fn set_room_history_visibility(
    state: State<'_, MatrixState>,
    room_id: String,
    visibility: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_room_history_visibility(&client, &room_id, &visibility).await
}

#[tauri::command]
pub async fn get_room_state_events(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<Vec<crate::matrix::rooms::RawStateEvent>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_room_state_events(&client, &room_id).await
}

#[tauri::command]
pub async fn get_raw_event(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_raw_event(&client, &room_id, &event_id).await
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
pub async fn get_event_context(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    context_size: Option<usize>,
) -> Result<crate::matrix::timeline::EventContextPage, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::get_event_context(&client, &room_id, &event_id, context_size.unwrap_or(25)).await
}

#[tauri::command]
pub async fn paginate_forward(
    state: State<'_, MatrixState>,
    room_id: String,
    after: String,
    limit: Option<usize>,
) -> Result<crate::matrix::timeline::TimelineForwardPage, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::paginate_forward(&client, &room_id, after, limit.unwrap_or(50)).await
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

#[tauri::command]
pub async fn get_message_revisions(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
) -> Result<Vec<crate::matrix::timeline::TimelineEvent>, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::get_message_revisions(&client, &room_id, &event_id).await
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
    encryption_info: Option<String>,
) -> Result<MediaDownload, String> {
    let client = get_client(&state)?;
    crate::matrix::media::download_media_with_cache(
        &client,
        &mxc_url,
        thumbnail,
        thumbnail_width,
        thumbnail_height,
        Some(&cache_state.0),
        encryption_info.as_deref(),
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

/// Download a video/audio file from the homeserver and write it to a temporary
/// file on disk, returning the absolute path. The caller (frontend) can then
/// pass the path to `plugin:shell|open` to open it in the system player.
///
/// A stable name derived from the mxc URL hash is used so repeated clicks
/// on the same message don't create duplicate temp files.
#[tauri::command]
pub async fn save_media_to_temp(
    state: State<'_, MatrixState>,
    cache_state: State<'_, CacheState>,
    mxc_url: String,
    encryption_info: Option<String>,
    filename: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;

    let dl = crate::matrix::media::download_media_with_cache(
        &client,
        &mxc_url,
        false,
        None,
        None,
        Some(&cache_state.0),
        encryption_info.as_deref(),
    )
    .await?;

    // Determine a suitable file extension from the MIME type.
    let ext = match dl.mime_type.as_str() {
        "video/mp4" | "video/x-m4v" => "mp4",
        "video/webm" => "webm",
        "video/ogg" => "ogv",
        "video/quicktime" => "mov",
        "video/x-matroska" => "mkv",
        "video/x-msvideo" => "avi",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/wav" => "wav",
        "audio/flac" => "flac",
        _ => "bin",
    };

    // Build a stable temp path: $TMPDIR/quark-<hash>.<ext>
    // (or use the original filename if provided, sanitised)
    let tmp_dir = std::env::temp_dir();
    let basename = filename
        .as_deref()
        .filter(|f| !f.is_empty())
        .map(|f| {
            // Strip directory components and non-safe chars.
            let safe: String = std::path::Path::new(f)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("video")
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
                .collect();
            safe
        })
        .unwrap_or_else(|| {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new();
            h.update(mxc_url.as_bytes());
            format!("quark-media-{:x}.{}", h.finalize(), ext)
        });

    let dest = tmp_dir.join(&basename);

    // Decode base64 and write to the temp file (overwrite if already present).
    let bytes = crate::matrix::media::decode_base64(&dl.data_base64)?;
    std::fs::write(&dest, &bytes)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;

    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Temp path is not valid UTF-8".to_string())
}

/// Download a media file from the homeserver and write it to a caller-supplied
/// path on disk. The frontend collects the destination via the in-app save
/// modal before invoking this command. Used by the file affordance.
///
/// Tilde (`~`) at the start of the path is expanded to the user's home
/// directory, and missing parent directories are created on demand — so the
/// frontend can pass e.g. `~/Downloads/photo.jpg` without pre-checking.
#[tauri::command]
pub async fn save_media_to_path(
    state: State<'_, MatrixState>,
    cache_state: State<'_, CacheState>,
    mxc_url: String,
    encryption_info: Option<String>,
    dest_path: String,
) -> Result<String, String> {
    let client = get_client(&state)?;

    let dl = crate::matrix::media::download_media_with_cache(
        &client,
        &mxc_url,
        false,
        None,
        None,
        Some(&cache_state.0),
        encryption_info.as_deref(),
    )
    .await?;

    let bytes = crate::matrix::media::decode_base64(&dl.data_base64)?;
    let expanded = expand_tilde(&dest_path);

    if let Some(parent) = expanded.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
        }
    }

    std::fs::write(&expanded, &bytes)
        .map_err(|e| format!("Failed to write file: {e}"))?;

    expanded.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Saved path is not valid UTF-8".to_string())
}

/// Resolve the user's default download directory (XDG `XDG_DOWNLOAD_DIR`,
/// `~/Downloads` on most Linux desktops, `~/Downloads` on macOS, etc.).
/// Falls back to the home directory if no downloads dir is configured.
/// Returns an absolute path as a UTF-8 string.
#[tauri::command]
pub fn get_default_save_dir() -> Result<String, String> {
    let user_dirs = directories::UserDirs::new()
        .ok_or_else(|| "Could not resolve user directories".to_string())?;

    let path = user_dirs
        .download_dir()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| user_dirs.home_dir().to_path_buf());

    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Download dir path is not valid UTF-8".to_string())
}

/// Expand a leading `~` to the user's home directory.
fn expand_tilde(path: &str) -> std::path::PathBuf {
    let trimmed = path.trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = directories::UserDirs::new().map(|d| d.home_dir().to_path_buf()) {
            return home.join(rest);
        }
    }
    if trimmed == "~" {
        if let Some(home) = directories::UserDirs::new().map(|d| d.home_dir().to_path_buf()) {
            return home;
        }
    }
    std::path::PathBuf::from(trimmed)
}

/// Download a video/audio file to a temp path and open it in the system's
/// default media player. Uses xdg-open (Linux), open (macOS), or start
/// (Windows) directly, bypassing the shell-plugin URL scope restrictions.
#[tauri::command]
pub async fn open_media_externally(
    state: State<'_, MatrixState>,
    cache_state: State<'_, CacheState>,
    mxc_url: String,
    encryption_info: Option<String>,
    filename: Option<String>,
) -> Result<(), String> {
    // Re-use the download+write logic from save_media_to_temp.
    // We inline the call rather than calling the command directly because
    // Tauri commands can't invoke other commands; both share the same State.
    let path = {
        let client = get_client(&state)?;
        let dl = crate::matrix::media::download_media_with_cache(
            &client,
            &mxc_url,
            false,
            None,
            None,
            Some(&cache_state.0),
            encryption_info.as_deref(),
        )
        .await?;

        let ext = match dl.mime_type.as_str() {
            "video/mp4" | "video/x-m4v" => "mp4",
            "video/webm" => "webm",
            "video/ogg" => "ogv",
            "video/quicktime" => "mov",
            "video/x-matroska" => "mkv",
            "video/x-msvideo" => "avi",
            "audio/mpeg" => "mp3",
            "audio/ogg" => "ogg",
            "audio/wav" => "wav",
            "audio/flac" => "flac",
            _ => "bin",
        };

        let tmp_dir = std::env::temp_dir();
        let basename = filename
            .as_deref()
            .filter(|f| !f.is_empty())
            .map(|f| {
                let safe: String = std::path::Path::new(f)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("video")
                    .chars()
                    .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
                    .collect();
                safe
            })
            .unwrap_or_else(|| {
                use sha2::{Digest, Sha256};
                let mut h = Sha256::new();
                h.update(mxc_url.as_bytes());
                format!("quark-media-{:x}.{}", h.finalize(), ext)
            });

        let dest = tmp_dir.join(&basename);
        let bytes = crate::matrix::media::decode_base64(&dl.data_base64)?;
        std::fs::write(&dest, &bytes)
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        dest
    };

    // Open with the platform default handler.
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("xdg-open failed: {e}"))?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("open failed: {e}"))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("explorer failed: {e}"))?;

    Ok(())
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

/// Upload file data (base64-encoded) and send it as an m.file event.
/// Used for the file picker attach flow.
#[tauri::command]
pub async fn send_file(
    state: State<'_, MatrixState>,
    room_id: String,
    data_base64: String,
    mime_type: String,
    filename: String,
    file_size: Option<u64>,
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

    crate::matrix::timeline::send_file(
        &client,
        &room_id,
        &filename,
        &mxc_url,
        &mime_type,
        file_size,
    )
    .await
}

/// Upload video data (base64-encoded) and send it as an m.video event.
/// Used for the file picker attach flow when a video file is chosen, so it
/// renders as a playable embed rather than a generic file attachment.
#[tauri::command]
pub async fn send_video(
    state: State<'_, MatrixState>,
    room_id: String,
    data_base64: String,
    mime_type: String,
    filename: String,
    width: Option<u64>,
    height: Option<u64>,
    duration_ms: Option<u64>,
    file_size: Option<u64>,
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

    crate::matrix::timeline::send_video(
        &client,
        &room_id,
        &filename,
        &mxc_url,
        &mime_type,
        width,
        height,
        duration_ms,
        file_size,
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

// ─── URL Preview Commands ─────────────────────────────────────────────────────

/// OpenGraph-like metadata returned by the homeserver's URL preview API.
#[derive(Debug, serde::Serialize)]
pub struct UrlPreview {
    pub title: Option<String>,
    pub description: Option<String>,
    /// mxc:// URL for the preview image (resolve via download_media).
    pub image_url: Option<String>,
    pub site_name: Option<String>,
}

/// Fetch URL preview metadata from the homeserver (MSC or /_matrix/media/v3/preview_url).
/// Falls back to a direct HTTP GET + OG-tag extraction if the homeserver API fails.
/// Returns None if neither source yields usable metadata.
#[tauri::command]
pub async fn get_url_preview(
    state: State<'_, MatrixState>,
    url: String,
) -> Result<Option<UrlPreview>, String> {
    let client = get_client(&state)?;

    // ── 1. Try the Matrix homeserver URL-preview API ──────────────────────
    #[allow(deprecated)]
    let hs_result = {
        use matrix_sdk::ruma::api::client::media::get_media_preview::v3::Request as PreviewRequest;
        #[allow(deprecated)]
        let request = PreviewRequest::new(url.clone());
        #[allow(deprecated)]
        client.send(request, None).await
    };

    if let Ok(response) = hs_result {
        if let Some(data) = response.data {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(data.get()) {
                let title = value.get("og:title").and_then(|v| v.as_str()).map(str::to_string);
                let description = value.get("og:description").and_then(|v| v.as_str()).map(str::to_string);
                let image_url = value.get("og:image").and_then(|v| v.as_str()).map(str::to_string);
                let site_name = value.get("og:site_name").and_then(|v| v.as_str()).map(str::to_string);

                if title.is_some() || description.is_some() || image_url.is_some() {
                    return Ok(Some(UrlPreview { title, description, image_url, site_name }));
                }
            }
        }
    }

    // ── 2. Direct HTTP fallback: fetch the page and extract OG tags ───────
    let http = reqwest::Client::builder()
        // Use a realistic browser UA; some sites (YouTube, Twitter proxies) gate content on it
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = http.get(&url)
        // Mimic a real browser request so CDN/bot-detection layers serve full HTML
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.5")
        // Request uncompressed content; reqwest doesn't have gzip enabled by default
        .header("Accept-Encoding", "identity")
        .header("Cache-Control", "no-cache")
        .header("Upgrade-Insecure-Requests", "1")
        .send().await
        .map_err(|e| format!("URL fetch failed: {e}"))?;

    // Only parse HTML responses
    let content_type = resp.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    if !content_type.contains("text/html") {
        return Ok(None);
    }

    // Read up to 128 KB — OG tags live in <head> which is usually within 32 KB,
    // but some JS-heavy sites push it further down.
    let bytes = resp.bytes().await
        .map_err(|e| format!("URL read failed: {e}"))?;
    let html = String::from_utf8_lossy(&bytes[..bytes.len().min(131_072)]).into_owned();

    let title = extract_og_tag(&html, "og:title")
        .or_else(|| extract_html_title(&html));
    let description = extract_og_tag(&html, "og:description");
    let image_url = extract_og_tag(&html, "og:image");
    let site_name = extract_og_tag(&html, "og:site_name");

    if title.is_none() && description.is_none() && image_url.is_none() {
        return Ok(None);
    }

    Ok(Some(UrlPreview { title, description, image_url, site_name }))
}

/// Extract a `<meta property="og:…" content="…">` value from HTML.
///
/// Handles:
/// - Both attribute orderings (property before/after content)
/// - Both double-quote and single-quote attribute delimiters
/// - ASCII-case-insensitive matching
fn extract_og_tag(html: &str, property: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let prop_lc = property.to_ascii_lowercase();

    // Build both quote variants of the property needle once.
    let dq_prop = format!("property=\"{}\"", prop_lc);
    let sq_prop = format!("property='{}'", prop_lc);

    let mut search_from = 0;
    loop {
        // Find the earliest occurrence of either quote style.
        let found = [dq_prop.as_str(), sq_prop.as_str()]
            .iter()
            .filter_map(|n| lower[search_from..].find(n).map(|i| i + search_from))
            .min();
        let prop_pos = found?;

        // Walk back to the opening <meta of this tag.
        let tag_start = lower[..prop_pos].rfind("<meta")?;
        // Walk forward to the closing > of this tag.
        let tag_end = lower[prop_pos..].find('>').map(|i| i + prop_pos + 1)
            .unwrap_or(lower.len());

        // Extract the content attribute value (both quote styles).
        let tag_lower = &lower[tag_start..tag_end];
        if let Some(val) = extract_attr(html, tag_lower, tag_start, "content") {
            if !val.is_empty() {
                return Some(decode_html_entities(&val));
            }
        }

        search_from = prop_pos + 1;
    }
}

/// Extract an attribute value from a tag, supporting both `attr="val"` and `attr='val'`.
/// `tag_lower` is the lowercased slice; `tag_start` is its byte offset in the original `html`.
fn extract_attr(html: &str, tag_lower: &str, tag_start: usize, attr: &str) -> Option<String> {
    for (open, close) in [("=\"", '"'), ("='", '\'')] {
        let needle = format!("{}{}", attr, open);
        if let Some(rel_start) = tag_lower.find(&needle) {
            let val_start = tag_start + rel_start + needle.len();
            if let Some(val_len) = html[val_start..].find(close) {
                return Some(html[val_start..val_start + val_len].to_string());
            }
        }
    }
    None
}

/// Extract `<title>` text as a last-resort title source.
fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title>")? + 7;
    let end = lower[start..].find("</title>").map(|i| i + start)?;
    let raw = html[start..end].trim();
    if raw.is_empty() { None } else { Some(decode_html_entities(raw)) }
}

/// Decode the most common HTML entities found in OG attribute values.
fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
     .replace("&lt;", "<")
     .replace("&gt;", ">")
     .replace("&quot;", "\"")
     .replace("&#39;", "'")
     .replace("&apos;", "'")
     .replace("&nbsp;", " ")
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

#[tauri::command]
pub async fn set_display_name(
    state: State<'_, MatrixState>,
    name: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::client::set_display_name(&client, name).await
}

#[tauri::command]
pub async fn invite_user(
    state: State<'_, MatrixState>,
    room_id: String,
    user_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::invite_user(&client, &room_id, &user_id).await
}

#[tauri::command]
pub async fn kick_user(
    state: State<'_, MatrixState>,
    room_id: String,
    user_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::kick_user(&client, &room_id, &user_id, reason.as_deref()).await
}

#[tauri::command]
pub async fn ban_user(
    state: State<'_, MatrixState>,
    room_id: String,
    user_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::ban_user(&client, &room_id, &user_id, reason.as_deref()).await
}

#[tauri::command]
pub async fn unban_user(
    state: State<'_, MatrixState>,
    room_id: String,
    user_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::unban_user(&client, &room_id, &user_id).await
}

#[tauri::command]
pub async fn set_presence_status(
    state: State<'_, MatrixState>,
    status_msg: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::{
        api::client::presence::set_presence::v3::Request as SetPresenceRequest,
        presence::PresenceState,
    };
    let client = get_client(&state)?;
    let user_id = client
        .user_id()
        .ok_or_else(|| "Not logged in".to_string())?
        .to_owned();
    let mut req = SetPresenceRequest::new(user_id, PresenceState::Online);
    req.status_msg = if status_msg.is_empty() { None } else { Some(status_msg) };
    client
        .send(req, None)
        .await
        .map_err(|e| format!("Failed to set presence: {e}"))?;
    Ok(())
}

/// Presence state for a user, returned by `get_presence_status`.
#[derive(Debug, Serialize, Deserialize)]
pub struct PresenceInfo {
    pub user_id: String,
    pub presence: String,
    pub status_msg: Option<String>,
}

#[tauri::command]
pub async fn get_presence_status(
    state: State<'_, MatrixState>,
    user_id: String,
) -> Result<PresenceInfo, String> {
    use matrix_sdk::ruma::{
        api::client::presence::get_presence::v3::Request as GetPresenceRequest,
        OwnedUserId,
    };
    let client = get_client(&state)?;
    let uid: OwnedUserId = user_id
        .parse()
        .map_err(|e| format!("Invalid user ID: {e}"))?;
    let req = GetPresenceRequest::new(uid);
    let resp = client
        .send(req, None)
        .await
        .map_err(|e| format!("Failed to fetch presence: {e}"))?;
    Ok(PresenceInfo {
        user_id,
        presence: resp.presence.to_string(),
        status_msg: resp.status_msg,
    })
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

#[tauri::command]
pub async fn send_thread_reply(
    state: State<'_, MatrixState>,
    room_id: String,
    thread_root_event_id: String,
    body: String,
    formatted_body: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::threads::send_thread_reply(
        &client,
        &room_id,
        &thread_root_event_id,
        &body,
        formatted_body.as_deref(),
    )
    .await
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
        "klipy" => {
            let client = crate::gif::klipy::KlipyClient::new(api_key);
            client.search(&query, limit, rating_str).await
        }
        other => Err(format!("Unknown GIF provider: '{}'", other)),
    }
}

/// Parse the pixel dimensions from the GIF header (logical screen descriptor).
///
/// A GIF starts with the 6-byte signature "GIF87a"/"GIF89a" followed by the
/// logical screen width and height as little-endian u16s. GIF providers (and
/// remote clients) frequently omit dimensions, leaving the frontend to reserve
/// no layout space and jump as the image decodes — so we read them straight
/// from the bytes we already downloaded. Returns None if the data isn't a GIF
/// or the dimensions are zero.
fn gif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 10 || &bytes[0..3] != b"GIF" {
        return None;
    }
    let w = u16::from_le_bytes([bytes[6], bytes[7]]) as u32;
    let h = u16::from_le_bytes([bytes[8], bytes[9]]) as u32;
    if w == 0 || h == 0 {
        None
    } else {
        Some((w, h))
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

    // Prefer dimensions probed from the actual bytes — providers often pass 0×0
    // (e.g. when no HD rendition metadata is available), which would leave the
    // recipient's client with no layout space to reserve. Fall back to the
    // caller's values only when they're non-zero, else send None. Computed
    // before the upload moves `bytes`.
    let (w, h) = match gif_dimensions(&bytes) {
        Some((w, h)) => (Some(w as u64), Some(h as u64)),
        None if width > 0 && height > 0 => (Some(width as u64), Some(height as u64)),
        None => (None, None),
    };

    // Upload to the homeserver and get an mxc:// URL.
    let mxc_url = crate::matrix::media::upload_media(
        &client,
        bytes,
        "image/gif",
        Some(&format!("{title}.gif")),
    )
    .await?;

    // Send as m.image event.
    crate::matrix::timeline::send_image(&client, &room_id, &title, &mxc_url, "image/gif", w, h)
        .await
}

#[cfg(test)]
mod tests {
    use super::gif_dimensions;

    /// Minimal GIF header: "GIF89a" + logical screen width/height as LE u16.
    fn gif_header(w: u16, h: u16) -> Vec<u8> {
        let mut b = b"GIF89a".to_vec();
        b.extend_from_slice(&w.to_le_bytes());
        b.extend_from_slice(&h.to_le_bytes());
        b.extend_from_slice(&[0u8; 4]); // packed fields etc. — unused by the parser
        b
    }

    #[test]
    fn reads_dimensions_from_header() {
        assert_eq!(gif_dimensions(&gif_header(480, 270)), Some((480, 270)));
        assert_eq!(gif_dimensions(&gif_header(1, 1)), Some((1, 1)));
    }

    #[test]
    fn rejects_non_gif_or_zero_or_truncated() {
        assert_eq!(gif_dimensions(b"PNG\x89 not a gif here"), None);
        assert_eq!(gif_dimensions(&gif_header(0, 200)), None);
        assert_eq!(gif_dimensions(&gif_header(200, 0)), None);
        assert_eq!(gif_dimensions(b"GIF"), None); // too short
        assert_eq!(gif_dimensions(&[]), None);
    }
}

// ─── App Config Commands ──────────────────────────────────────────────────────

/// Return the current application configuration.
#[tauri::command]
pub async fn get_app_config(
    config_state: State<'_, Mutex<AppConfig>>,
) -> Result<AppConfig, String> {
    let guard = config_state.lock().map_err(|_| "App config lock poisoned")?;
    Ok(guard.clone())
}

/// Persist updated application configuration to disk and update in-memory state.
/// Also syncs the media cache size limit when `media.cache_size_mb` changes.
#[tauri::command]
pub async fn set_app_config(
    config_state: State<'_, Mutex<AppConfig>>,
    cache_state: State<'_, CacheState>,
    paths: State<'_, crate::Paths>,
    config: AppConfig,
) -> Result<(), String> {
    let path = crate::config::app_config::config_path_in(&paths.config_dir);
    crate::config::app_config::save_app_config_to(&path, &config)?;
    let new_cache_mb = config.media.cache_size_mb;
    let mut guard = config_state.lock().map_err(|_| "App config lock poisoned")?;
    *guard = config;
    drop(guard);
    // Sync MediaCache size limit in case it changed.
    let _ = cache_state.0.set_max_size_mb(new_cache_mb);
    Ok(())
}

// ─── Config Commands ──────────────────────────────────────────────────────────

/// Load a theme file and return it as a JSON value.
///
/// The TOML is parsed leniently — only valid TOML syntax is required; missing
/// theme fields are fine because the TypeScript `applyTheme` already handles
/// partial data (all fields optional).  Strict per-field color validation
/// (validate_theme) is NOT run here: bad values just fall back to CSS defaults
/// on the frontend, which is better UX than blocking with an error.
#[tauri::command]
pub async fn load_theme(theme_path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&theme_path);
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read theme file '{}': {e}", path.display()))?;
    let toml_val: toml::Value = toml::from_str(&content)
        .map_err(|e| format!("Failed to parse theme TOML: {e}"))?;
    serde_json::to_value(&toml_val)
        .map_err(|e| format!("Failed to convert theme to JSON: {e}"))
}

/// A custom theme entry returned by `list_custom_themes`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomThemeEntry {
    /// Display name from the [meta] section of the TOML file.
    pub name: String,
    /// Absolute path to the .toml file on disk.
    pub path: String,
}

/// Lenient TOML shape used only for extracting a display name from a theme
/// file without requiring every field to be present.
#[derive(Deserialize)]
struct PartialThemeMeta {
    name: Option<String>,
}
#[derive(Deserialize)]
struct PartialTheme {
    meta: Option<PartialThemeMeta>,
}

/// Scan `<config_dir>/themes/` for *.toml files and return their names and
/// paths.  Every .toml file is included regardless of whether it is a complete
/// valid theme — display name falls back to the filename stem when the [meta]
/// table is absent.  Full validation happens later when the user clicks Apply.
#[tauri::command]
pub async fn list_custom_themes(
    paths: State<'_, crate::Paths>,
) -> Result<Vec<CustomThemeEntry>, String> {
    let themes_dir = paths.config_dir.join("themes");

    if !themes_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    let read = std::fs::read_dir(&themes_dir)
        .map_err(|e| format!("Failed to read themes directory: {e}"))?;

    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }

        // Try a lenient parse just to get the display name; fall back to the
        // filename stem so even incomplete themes appear in the list.
        let display_name = std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| toml::from_str::<PartialTheme>(&content).ok())
            .and_then(|t| t.meta)
            .and_then(|m| m.name)
            .unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        entries.push(CustomThemeEntry {
            name: display_name,
            path: path.to_string_lossy().into_owned(),
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub async fn parse_quarkrc(content: String) -> Result<ParsedRc, String> {
    Ok(crate::config::quarkrc::parse_quarkrc(&content))
}

/// Load and parse the user's quarkrc from the resolved config dir.
/// Returns an empty ParsedRc if the file does not exist.
#[tauri::command]
pub async fn load_quarkrc(paths: State<'_, crate::Paths>) -> Result<ParsedRc, String> {
    let rc_path = paths.config_dir.join("quarkrc");

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

/// Replace the current notification configuration and persist it to disk.
#[tauri::command]
pub async fn set_notification_config(
    config_state: State<'_, Mutex<NotificationConfig>>,
    paths: State<'_, crate::Paths>,
    config: NotificationConfig,
) -> Result<(), String> {
    crate::notifications::save_notification_config_to(&paths.config_dir, &config)?;
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

// ─── Shell Commands ──────────────────────────────────────────────────────────

/// Open an http(s) URL in the system browser.
///
/// Wraps `tauri-plugin-shell`'s `Shell::open` because the plugin's mobile JS
/// surface (`plugin:shell|open`) is broken on iOS and Android: the Swift /
/// Kotlin plugins call `parseArgs(String)` expecting a raw JSON string, but
/// `@tauri-apps/plugin-shell` (and the equivalent raw `invoke`) sends
/// `{ path, with }`, which fails to decode. Going through the Rust API
/// serializes the URL as a raw string, which the mobile plugins accept.
#[tauri::command]
pub async fn open_external_url(app_handle: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    #[allow(deprecated)]
    app_handle.shell().open(url, None).map_err(|e| e.to_string())
}
