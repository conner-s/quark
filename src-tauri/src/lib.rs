pub mod commands;
pub mod config;
pub mod events;
pub mod gif;
pub mod matrix;
pub mod media_cache;
pub mod notifications;

use matrix::client::{MatrixState, SyncState};
use media_cache::MediaCache;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Tauri managed state for the media cache.
pub struct CacheState(pub Arc<MediaCache>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("quark=debug".parse().unwrap()),
        )
        .try_init();

    // Load persisted configs from disk (fall back to defaults if absent).
    let app_config = config::app_config::load_app_config();
    let notification_config = notifications::load_notification_config();

    // Initialise the media cache using the persisted size limit.
    let cache_size_mb = app_config.media.cache_size_mb;
    let cache = MediaCache::new(cache_size_mb)
        .unwrap_or_else(|e| {
            tracing::warn!("Failed to initialise media cache: {e}. Using temp dir fallback.");
            let tmp = std::env::temp_dir().join("quark_media_cache");
            MediaCache::with_dir(tmp, cache_size_mb).expect("Could not create fallback cache")
        });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(MatrixState(Mutex::new(None)))
        .manage(SyncState {
            handle: Mutex::new(None),
            handlers_registered: Mutex::new(false),
        })
        .manage(CacheState(Arc::new(cache)))
        .manage(Mutex::new(app_config))
        .manage(Mutex::new(notification_config))
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::login,
            commands::logout,
            commands::restore_session,
            commands::start_sync,
            // Rooms
            commands::get_rooms,
            commands::get_room_members,
            commands::join_room,
            commands::leave_room,
            commands::create_room,
            commands::mark_room_read,
            commands::get_pinned_events,
            commands::search_room_directory,
            // Room settings
            commands::get_power_levels,
            commands::set_power_levels,
            commands::set_room_name,
            commands::set_room_topic,
            commands::set_room_join_rule,
            commands::set_room_history_visibility,
            // Debug viewer
            commands::get_room_state_events,
            commands::get_raw_event,
            // Timeline
            commands::get_timeline,
            commands::get_event_context,
            commands::get_message_revisions,
            commands::send_message,
            commands::edit_message,
            commands::redact_message,
            // Reactions
            commands::send_reaction,
            commands::get_reactions,
            // Emoji
            commands::get_emoji_packs,
            // Stickers
            commands::get_sticker_packs,
            commands::send_sticker,
            // URL Preview
            commands::get_url_preview,
            // Media
            commands::download_media,
            commands::save_media_to_temp,
            commands::open_media_externally,
            commands::upload_media,
            commands::send_pasted_image,
            commands::send_file,
            commands::get_cache_stats,
            commands::clear_media_cache,
            commands::set_cache_size_limit,
            // Crypto
            commands::get_verification_status,
            commands::get_cross_signing_status,
            commands::bootstrap_cross_signing,
            commands::get_user_devices,
            commands::start_sas_verification,
            commands::accept_verification_request,
            commands::accept_sas_verification,
            commands::confirm_sas_verification,
            commands::cancel_sas_verification,
            commands::get_sas_info,
            // Spaces
            commands::get_space_hierarchy,
            commands::get_user_spaces,
            // Profile
            commands::get_own_profile,
            commands::set_display_name,
            commands::set_presence_status,
            // Member management
            commands::invite_user,
            commands::kick_user,
            commands::ban_user,
            commands::unban_user,
            // Threads
            commands::get_thread_roots,
            commands::get_thread_timeline,
            commands::send_thread_reply,
            // GIF
            commands::search_gifs,
            commands::send_gif,
            // App Config
            commands::get_app_config,
            commands::set_app_config,
            // Config
            commands::load_theme,
            commands::parse_quarkrc,
            commands::load_quarkrc,
            // Notifications
            commands::get_notification_config,
            commands::set_notification_config,
            commands::mute_room,
            commands::unmute_room,
            commands::test_notification,
        ])
        .setup(|app| {
            eprintln!("[quark] setup callback running...");
            let _window = app.get_webview_window("main")
                .expect("no main window found");
            eprintln!("[quark] main window acquired");
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("[quark] FATAL: {e}");
            std::process::exit(1);
        });
}
