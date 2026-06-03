pub mod commands;
pub mod config;
pub mod events;
pub mod gif;
pub mod matrix;
pub mod media_cache;
pub mod media_server;
pub mod notifications;

use matrix::client::{MatrixState, PaginationLock, SearchState, SyncState, TimelineTokens};
use media_cache::MediaCache;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Tauri managed state for the media cache.
pub struct CacheState(pub Arc<MediaCache>);

/// Tauri managed state for the loopback media-streaming server used by inline
/// video. `None` if the server failed to bind; callers then fall back to the
/// external player.
pub struct MediaServerState(pub Option<Arc<media_server::MediaServer>>);

/// Resolved on-disk locations. Populated in `.setup()` so the values come from
/// Tauri's per-platform path resolver — important on Android where the
/// `directories` crate doesn't return a writable path.
pub struct Paths {
    pub config_dir: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK video-playback workarounds for Linux/Mesa. Must be set before
    // WebKit/GTK initialises, while the process is still single-threaded — so
    // this is the first thing we do. Harmless on non-Linux targets (cfg guard).
    #[cfg(target_os = "linux")]
    {
        // The DMA-BUF renderer presents <video> frames incorrectly on many
        // setups (frames lag behind audio, then render solid green); disabling
        // it makes WebKit fall back to a renderer that displays video correctly.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        // Hardware video decoders (VA-API / NVDEC) in WebKit's GStreamer pipeline
        // corrupt frames on seek/replay; derank them to NONE so the reliable
        // software decoders (avdec_*, from gst-libav) handle playback instead.
        std::env::set_var(
            "GST_PLUGIN_FEATURE_RANK",
            "vah264dec:NONE,vah265dec:NONE,vavp8dec:NONE,vavp9dec:NONE,vaav1dec:NONE,vaapih264dec:NONE,vaapih265dec:NONE,vaapivp8dec:NONE,vaapivp9dec:NONE,nvh264dec:NONE,nvh265dec:NONE,nvvp8dec:NONE,nvvp9dec:NONE,nvav1dec:NONE",
        );
    }

    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("quark=debug".parse().unwrap()),
        )
        .try_init();

    // Record the moment of app launch so the message event handler can
    // suppress OS notifications for messages that predate startup (catch-up
    // sync would otherwise fire a notification for every unread message).
    events::init_startup_time();

    // Configs and the media cache are populated inside `.setup()` once the
    // AppHandle's path resolver is available (needed for Android, where
    // `directories::ProjectDirs` returns None). Until then the managed state
    // holds defaults; the setup callback swaps in the persisted values.
    let initial_cache = MediaCache::with_dir(
        std::env::temp_dir().join("quark_media_cache"),
        config::app_config::AppConfig::default().media.cache_size_mb,
    )
    .expect("Could not create initial media cache");

    // Loopback HTTP server that streams decrypted media to inline <video> with
    // Range support (seekable, low memory), serving the temp dir that
    // `write_media_to_temp` writes to. Only Linux/WebKitGTK needs it — other
    // platforms stream video via the asset protocol — so we don't bind an unused
    // socket elsewhere. If it can't bind, video falls back to the external player.
    let media_server = if cfg!(target_os = "linux") {
        media_server::MediaServer::start(std::env::temp_dir())
            .map_err(|e| tracing::warn!("media server failed to start: {e}"))
            .ok()
    } else {
        None
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(MatrixState(Mutex::new(None)))
        .manage(SyncState {
            handle: Mutex::new(None),
            handlers_registered: Mutex::new(false),
        })
        .manage(SearchState::default())
        .manage(PaginationLock::default())
        .manage(TimelineTokens::default())
        .manage(CacheState(Arc::new(initial_cache)))
        .manage(MediaServerState(media_server))
        .manage(Mutex::new(config::app_config::AppConfig::default()))
        .manage(Mutex::new(notifications::NotificationConfig::default()))
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
            commands::get_room_receipts,
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
            commands::paginate_forward,
            commands::open_room_timeline,
            commands::load_older_timeline,
            commands::search_room_cache,
            commands::search_room_messages,
            commands::cancel_room_search,
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
            commands::serve_media,
            commands::save_media_to_path,
            commands::get_default_save_dir,
            commands::get_platform,
            commands::open_media_externally,
            commands::upload_media,
            commands::send_pasted_image,
            commands::send_file,
            commands::send_video,
            commands::get_cache_stats,
            commands::clear_media_cache,
            commands::set_cache_size_limit,
            commands::get_event_cache_size,
            commands::clear_event_cache,
            commands::get_event_cache_diagnostics,
            commands::get_room_cache_diagnostics,
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
            commands::get_presence_status,
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
            commands::list_custom_themes,
            commands::parse_quarkrc,
            commands::load_quarkrc,
            // Notifications
            commands::get_notification_config,
            commands::set_notification_config,
            commands::mute_room,
            commands::unmute_room,
            commands::test_notification,
            // Shell
            commands::open_external_url,
        ])
        .setup(|app| {
            eprintln!("[quark] setup callback running...");

            // Resolve the platform's writable config dir.
            //
            // Desktop: keep using `directories::ProjectDirs` so the path
            // matches what every prior release used (~/.config/quark on
            // Linux, ~/Library/Application Support/quark on macOS,
            // %APPDATA%/quark on Windows). Switching to Tauri's resolver
            // on desktop would silently move every user's settings.
            //
            // Mobile (iOS/Android): the `directories` crate doesn't return
            // a usable path, so fall through to Tauri's per-platform
            // resolver. On Android that's /data/data/<id>/files; on iOS
            // it's the app sandbox's Library/Application Support.
            let config_dir = {
                #[cfg(any(target_os = "android", target_os = "ios"))]
                {
                    app.path()
                        .app_config_dir()
                        .unwrap_or_else(|_| std::env::temp_dir().join("quark"))
                }
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    directories::ProjectDirs::from("", "", "quark")
                        .map(|d| d.config_dir().to_path_buf())
                        .unwrap_or_else(|| std::env::temp_dir().join("quark"))
                }
            };
            tracing::info!("Config directory: {}", config_dir.display());

            // Now that we know the directory, load persisted configs and
            // replace the placeholder default values we stashed in managed
            // state at builder time.
            let loaded_app =
                config::app_config::load_app_config_from(&config::app_config::config_path_in(&config_dir));
            let loaded_notif = notifications::load_notification_config_from(&config_dir);
            if let Some(cfg_state) = app.try_state::<Mutex<config::app_config::AppConfig>>() {
                if let Ok(mut g) = cfg_state.lock() { *g = loaded_app.clone(); }
            }
            if let Some(notif_state) = app.try_state::<Mutex<notifications::NotificationConfig>>() {
                if let Ok(mut g) = notif_state.lock() { *g = loaded_notif; }
            }

            // Swap the media cache to the persistent data dir. Same desktop-
            // vs-mobile split as the config dir above so desktop users keep
            // their existing cache location (`<data>/quark/media_cache`).
            let cache_dir_opt: Option<std::path::PathBuf> = {
                #[cfg(any(target_os = "android", target_os = "ios"))]
                { app.path().app_data_dir().ok().map(|d| d.join("media_cache")) }
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    directories::ProjectDirs::from("", "", "quark")
                        .map(|d| d.data_dir().join("media_cache"))
                }
            };
            if let Some(cache_dir) = cache_dir_opt {
                let cache_size_mb = loaded_app.media.cache_size_mb;
                if let Ok(real_cache) = MediaCache::with_dir(cache_dir, cache_size_mb) {
                    // CacheState's field is an Arc, not Mutex<Arc>, so we have
                    // to swap by re-managing — Tauri allows re-managing the
                    // same type and the new value wins.
                    app.manage(CacheState(Arc::new(real_cache)));
                }
            }

            app.manage(Paths { config_dir });

            // Allow the asset protocol to read the temp dir, where decrypted
            // media is written for inline <video> streaming (the frontend turns
            // these paths into asset URLs via `convertFileSrc`). The static
            // `assetProtocol.scope` in tauri.conf.json covers `$TEMP`; this also
            // registers the resolved $TMPDIR in case it differs from Tauri's
            // `$TEMP` expansion. recursive=false → the dir's direct files only.
            if let Err(e) = app
                .asset_protocol_scope()
                .allow_directory(std::env::temp_dir(), false)
            {
                tracing::warn!("Failed to allow temp dir in asset scope: {e}");
            }

            let window = app.get_webview_window("main")
                .expect("no main window found");
            eprintln!("[quark] main window acquired");
            #[cfg(desktop)]
            if let Some(icon) = app.default_window_icon() {
                let _ = window.set_icon(icon.clone());
            }
            let _ = window;
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("[quark] FATAL: {e}");
            std::process::exit(1);
        });
}
