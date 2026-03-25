use matrix_sdk::{
    config::SyncSettings,
    ruma::api::client::filter::FilterDefinition,
    Client,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;
use tracing::{error, info};

/// Tauri state holding the Matrix client.
pub struct MatrixState(pub Mutex<Option<Client>>);

/// Serializable session info for persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub user_id: String,
    pub device_id: String,
    pub access_token: String,
    pub homeserver_url: String,
}

/// Build a Matrix client with SQLite store at the given data directory.
pub async fn build_client(homeserver_url: &str, data_dir: PathBuf) -> Result<Client, String> {
    let homeserver = homeserver_url
        .parse::<url::Url>()
        .map_err(|e| format!("Invalid homeserver URL: {e}"))?;

    let client = Client::builder()
        .homeserver_url(homeserver)
        .sqlite_store(&data_dir, None)
        .build()
        .await
        .map_err(|e| format!("Failed to build Matrix client: {e}"))?;

    Ok(client)
}

/// Perform a password login and return session info.
pub async fn login_with_password(
    client: &Client,
    username: &str,
    password: &str,
) -> Result<SessionInfo, String> {
    let response = client
        .matrix_auth()
        .login_username(username, password)
        .initial_device_display_name("Quark")
        .send()
        .await
        .map_err(|e| format!("Login failed: {e}"))?;

    let session = SessionInfo {
        user_id: response.user_id.to_string(),
        device_id: response.device_id.to_string(),
        access_token: response.access_token.clone(),
        homeserver_url: client.homeserver().to_string(),
    };

    info!(user_id = %session.user_id, "Logged in successfully");
    Ok(session)
}

/// Restore a previous session from saved credentials.
pub async fn restore_session_from_info(
    client: &Client,
    session: &SessionInfo,
) -> Result<(), String> {
    use matrix_sdk::matrix_auth::MatrixSession;
    use matrix_sdk::ruma::{OwnedDeviceId, OwnedUserId, UserId};

    let user_id: OwnedUserId = UserId::parse(&session.user_id)
        .map_err(|e| format!("Invalid user_id: {e}"))?;
    let device_id: OwnedDeviceId = session.device_id.as_str().into();

    let matrix_session = MatrixSession {
        meta: matrix_sdk::SessionMeta {
            user_id,
            device_id,
        },
        tokens: matrix_sdk::matrix_auth::MatrixSessionTokens {
            access_token: session.access_token.clone(),
            refresh_token: None,
        },
    };

    client
        .restore_session(matrix_session)
        .await
        .map_err(|e| format!("Failed to restore session: {e}"))?;

    info!(user_id = %session.user_id, "Session restored successfully");
    Ok(())
}

/// Start a background sync task. Returns immediately; sync runs in background.
///
/// If an `app_handle` is provided, sync event handlers are registered before
/// the sync loop starts so the frontend receives push notifications for new
/// messages, typing indicators, and other sync events.
pub async fn start_sync(client: Client, app_handle: Option<tauri::AppHandle>) {
    if let Some(ref handle) = app_handle {
        crate::events::setup_sync_event_handlers(&client, handle);
    }

    tokio::spawn(async move {
        let filter = FilterDefinition::default();
        let sync_settings = SyncSettings::default().filter(filter.into());
        let mut was_connected = false;

        loop {
            match client.sync(sync_settings.clone()).await {
                Ok(_) => {
                    info!("Sync completed");
                    if !was_connected {
                        was_connected = true;
                        if let Some(ref handle) = app_handle {
                            let _ = handle.emit(crate::events::EVENT_CONNECTED, true);
                        }
                    }
                }
                Err(e) => {
                    error!("Sync error: {e}");
                    if was_connected {
                        was_connected = false;
                        if let Some(ref handle) = app_handle {
                            let _ = handle.emit(crate::events::EVENT_CONNECTED, false);
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            }
        }
    });
}
