use matrix_sdk::{
    config::SyncSettings,
    ruma::{
        api::client::filter::{FilterDefinition, RoomEventFilter, RoomFilter},
        presence::PresenceState,
        UInt,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

/// Tauri state holding the Matrix client.
pub struct MatrixState(pub Mutex<Option<Client>>);

/// Tauri state holding the sync loop handle so we can prevent duplicate loops,
/// and a flag to track whether event handlers have been registered on the client
/// (since `client.add_event_handler()` accumulates — calling it again would
/// produce duplicate callbacks for every sync event).
pub struct SyncState {
    pub handle: Mutex<Option<JoinHandle<()>>>,
    pub handlers_registered: Mutex<bool>,
}

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

/// Own user profile info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnProfile {
    pub user_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

/// Fetch the current user's own profile (display name + avatar URL).
pub async fn get_own_profile(client: &Client) -> Result<OwnProfile, String> {
    let user_id = client
        .user_id()
        .ok_or("Not logged in")?
        .to_string();

    let display_name = client
        .account()
        .get_display_name()
        .await
        .map_err(|e| format!("Failed to get display name: {e}"))?;

    let avatar_url = client
        .account()
        .get_avatar_url()
        .await
        .ok()
        .flatten()
        .map(|u| u.to_string());

    Ok(OwnProfile {
        user_id,
        display_name,
        avatar_url,
    })
}

/// Maximum backoff duration on sync errors (2 minutes).
const MAX_BACKOFF_SECS: u64 = 120;

/// Start a background sync task. Returns immediately; sync runs in background.
///
/// If a sync loop is already running (tracked via `SyncState`), it is aborted
/// before spawning a new one — this prevents duplicate loops that would flood
/// the homeserver with concurrent E2EE key uploads.
///
/// If an `app_handle` is provided, sync event handlers are registered before
/// the sync loop starts so the frontend receives push notifications for new
/// messages, typing indicators, and other sync events.
pub async fn start_sync(
    client: Client,
    app_handle: Option<tauri::AppHandle>,
    sync_state: &SyncState,
) {
    // Abort any existing sync loop before starting a new one.
    {
        let mut guard = sync_state.handle.lock().expect("SyncState lock poisoned");
        if let Some(prev) = guard.take() {
            warn!("Aborting previous sync loop before starting a new one");
            prev.abort();
        }
    }

    // Only register event handlers once per client lifetime — add_event_handler
    // accumulates, so calling it again would produce duplicate callbacks for
    // every sync event (duplicate messages, notifications, etc.).
    if let Some(ref handle) = app_handle {
        let mut registered = sync_state.handlers_registered.lock().expect("SyncState lock poisoned");
        if !*registered {
            info!("Registering sync event handlers");
            crate::events::setup_sync_event_handlers(&client, handle);
            *registered = true;
        } else {
            warn!("Skipping event handler registration — already registered on this client");
        }
    }

    let handle = tokio::spawn(async move {
        // Limit timeline events per room to avoid large initial-sync payloads.
        // Incremental syncs only send new events regardless, so this only
        // affects the first sync after login or a cache miss.
        let mut timeline_filter = RoomEventFilter::default();
        timeline_filter.limit = Some(UInt::from(20u32));

        let mut room_filter = RoomFilter::default();
        room_filter.timeline = timeline_filter;

        let mut filter = FilterDefinition::default();
        filter.room = room_filter;

        // Use Unavailable so Synapse does not write a presence update on every
        // sync poll — avoids lock contention on the presence table.
        let sync_settings = SyncSettings::default()
            .filter(filter.into())
            .set_presence(PresenceState::Unavailable);
        let mut was_connected = false;
        let mut backoff_secs: u64 = 1;

        loop {
            match client.sync(sync_settings.clone()).await {
                Ok(_) => {
                    // Reset backoff on successful sync.
                    backoff_secs = 1;

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

                    // Exponential backoff with jitter to avoid thundering-herd
                    // retries that can overwhelm the homeserver (e.g. causing
                    // Synapse's OTK upload worker lock backoff to overflow).
                    let jitter = rand::random::<u64>() % (backoff_secs.max(1));
                    let delay = backoff_secs + jitter;
                    info!("Retrying sync in {delay}s (backoff {backoff_secs}s + jitter {jitter}s)");
                    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                    backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
                }
            }
        }
    });

    // Store the handle so future calls can abort this loop.
    let mut guard = sync_state.handle.lock().expect("SyncState lock poisoned");
    *guard = Some(handle);
}
