//! Background-sync foreground-service bridge (Android).
//!
//! On Android, a tiny app-local Tauri plugin registers the Kotlin
//! `SyncServicePlugin` (gen/android), which starts/stops
//! `SyncForegroundService` — the service keeps this process (and the tokio
//! sync loop in it) alive while the app is backgrounded. Everywhere else the
//! feature reports `supported: false` and the commands are no-ops.
//!
//! The user-facing surface is plain app commands (commands.rs) rather than a
//! JS plugin API, so no capability/permission wiring is needed.

use serde::{Deserialize, Serialize};

/// Snapshot for the Settings UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundSyncState {
    /// Whether this platform has the foreground service at all (Android).
    pub supported: bool,
    /// The persisted config value (notifications.toml `background_sync`).
    pub enabled: bool,
    /// Whether the service is actually alive right now.
    pub running: bool,
    /// Whether the app is exempt from battery optimization.
    pub battery_exempt: bool,
}

#[cfg(target_os = "android")]
mod android {
    use tauri::{
        plugin::{Builder, PluginHandle, TauriPlugin},
        AppHandle, Manager, Runtime, Wry,
    };

    /// Managed handle to the Kotlin plugin.
    pub struct SyncServiceHandle(PluginHandle<Wry>);

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct KotlinStatus {
        pub running: bool,
        pub battery_exempt: bool,
    }

    /// Private plugin whose only job is registering the Kotlin class and
    /// stashing its handle in managed state.
    pub fn init() -> TauriPlugin<Wry> {
        Builder::<Wry>::new("quark-sync")
            .setup(|app, api| {
                let handle = api.register_android_plugin("tel.quark.app", "SyncServicePlugin")?;
                app.manage(SyncServiceHandle(handle));
                Ok(())
            })
            .build()
    }

    fn handle<R: Runtime>(app: &AppHandle<R>) -> Option<&SyncServiceHandle> {
        // Managed by the plugin setup above; absent only if registration failed.
        app.try_state::<SyncServiceHandle>().map(|s| s.inner())
    }

    pub fn start(app: &AppHandle<Wry>) -> Result<(), String> {
        handle(app)
            .ok_or("sync service plugin not registered")?
            .0
            .run_mobile_plugin::<()>("start", ())
            .map_err(|e| e.to_string())
    }

    pub fn stop(app: &AppHandle<Wry>) -> Result<(), String> {
        handle(app)
            .ok_or("sync service plugin not registered")?
            .0
            .run_mobile_plugin::<()>("stop", ())
            .map_err(|e| e.to_string())
    }

    pub fn status(app: &AppHandle<Wry>) -> Option<KotlinStatus> {
        handle(app)?
            .0
            .run_mobile_plugin::<KotlinStatus>("status", ())
            .ok()
    }

    pub fn request_battery_exemption(app: &AppHandle<Wry>) -> Result<(), String> {
        handle(app)
            .ok_or("sync service plugin not registered")?
            .0
            .run_mobile_plugin::<()>("requestBatteryExemption", ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "android")]
pub use android::init;

/// Start or stop the foreground service to match `enabled`. No-op off Android.
pub fn apply(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        if enabled {
            android::start(app)
        } else {
            android::stop(app)
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, enabled);
        Ok(())
    }
}

/// Current state snapshot (`enabled` is filled in by the command from config).
pub fn state(app: &tauri::AppHandle, enabled: bool) -> BackgroundSyncState {
    #[cfg(target_os = "android")]
    {
        let status = android::status(app);
        BackgroundSyncState {
            supported: true,
            enabled,
            running: status.as_ref().map(|s| s.running).unwrap_or(false),
            battery_exempt: status.as_ref().map(|s| s.battery_exempt).unwrap_or(false),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        BackgroundSyncState {
            supported: false,
            enabled,
            running: false,
            battery_exempt: false,
        }
    }
}

/// Surface the battery-optimization exemption prompt. No-op off Android.
pub fn request_battery_exemption(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android::request_battery_exemption(app)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}
