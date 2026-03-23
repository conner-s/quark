pub mod commands;
pub mod config;
pub mod gif;
pub mod matrix;

use matrix::client::MatrixState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("quark=debug".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(MatrixState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::login,
            commands::logout,
            commands::restore_session,
            // Rooms
            commands::get_rooms,
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
            // Media
            commands::download_media,
            commands::upload_media,
            // Crypto
            commands::get_verification_status,
            commands::start_sas_verification,
            // Spaces
            commands::get_space_hierarchy,
            // Threads
            commands::get_thread_roots,
            commands::get_thread_timeline,
            // GIF
            commands::search_gifs,
            // Config
            commands::load_theme,
            commands::parse_quarkrc,
        ])
        .setup(|app| {
            let _app_handle = app.handle().clone();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
