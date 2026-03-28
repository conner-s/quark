pub mod commands;
pub mod config;
pub mod events;
pub mod gif;
pub mod matrix;
pub mod media_cache;
pub mod notifications;

use matrix::client::MatrixState;
use media_cache::MediaCache;
use notifications::NotificationConfig;
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

    // Default to a 200 MB cache. The user can change it at runtime via the
    // set_cache_size_limit command.
    let cache = MediaCache::new(200)
        .unwrap_or_else(|e| {
            tracing::warn!("Failed to initialise media cache: {e}. Using temp dir fallback.");
            let tmp = std::env::temp_dir().join("quark_media_cache");
            MediaCache::with_dir(tmp, 200).expect("Could not create fallback cache")
        });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(MatrixState(Mutex::new(None)))
        .manage(CacheState(Arc::new(cache)))
        .manage(Mutex::new(NotificationConfig::default()))
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
            // Timeline
            commands::get_timeline,
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
            // Media
            commands::download_media,
            commands::upload_media,
            commands::send_pasted_image,
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
            // Threads
            commands::get_thread_roots,
            commands::get_thread_timeline,
            // GIF
            commands::search_gifs,
            commands::send_gif,
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
