//! The Web Inspector ("developer tools"), and whether this build can turn it on.
//!
//! Tauri turns the inspector on in every debug build. A release build has it
//! only when built with this crate's `devtools` feature (which enables Tauri's),
//! and then `[debug] devtools` in config.toml decides at runtime whether it is
//! offered. That is off by default, so a build made with the feature for
//! debugging behaves like any other until someone opts in.
//!
//! The runtime switch is WebKitGTK's `enable-developer-extras`, which is what
//! puts "Inspect Element" in the webview's own right-click menu, so it only
//! exists on Linux. Elsewhere a feature build always has the inspector, like a
//! debug build.

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// What this build can do with the inspector.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DevtoolsSupport {
    /// Always on: a debug build, or a feature build where it can't be switched.
    Always,
    /// On while `[debug] devtools` is.
    Toggle,
    /// Not built in.
    None,
}

pub const SUPPORT: DevtoolsSupport = if cfg!(debug_assertions) {
    DevtoolsSupport::Always
} else if cfg!(all(feature = "devtools", target_os = "linux")) {
    DevtoolsSupport::Toggle
} else if cfg!(feature = "devtools") {
    DevtoolsSupport::Always
} else {
    DevtoolsSupport::None
};

/// Whether the inspector may be opened, given the `[debug] devtools` setting.
pub fn enabled(setting: bool) -> bool {
    match SUPPORT {
        DevtoolsSupport::Always => true,
        DevtoolsSupport::Toggle => setting,
        DevtoolsSupport::None => false,
    }
}

/// Make every webview match the setting: offer the inspector or not, and
/// close it if it was open and is now off. Only a toggleable build changes.
pub fn apply<R: Runtime>(app: &AppHandle<R>, setting: bool) {
    if SUPPORT != DevtoolsSupport::Toggle {
        return;
    }
    for window in app.webview_windows().values() {
        #[cfg(target_os = "linux")]
        {
            let _ = window.with_webview(move |webview| {
                use webkit2gtk::{SettingsExt, WebViewExt};
                if let Some(settings) = webview.inner().settings() {
                    settings.set_enable_developer_extras(setting);
                }
            });
        }
        #[cfg(any(debug_assertions, feature = "devtools"))]
        if !setting {
            window.close_devtools();
        }
        #[cfg(not(any(target_os = "linux", debug_assertions, feature = "devtools")))]
        let _ = window;
    }
}

/// Open the inspector on the main window, or say why it can't be.
pub fn open<R: Runtime>(app: &AppHandle<R>, setting: bool) -> Result<(), String> {
    match SUPPORT {
        DevtoolsSupport::None => Err(
            "This build has no developer tools. Build it with the `devtools` feature (Nix: withDevtools = true)."
                .into(),
        ),
        DevtoolsSupport::Toggle if !setting => {
            Err("Developer tools are off. Turn them on in Settings → General → Debug.".into())
        }
        _ => open_main(app),
    }
}

#[cfg(any(debug_assertions, feature = "devtools"))]
fn open_main<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app.webview_windows().into_values().next().ok_or("No window to inspect")?;
    window.open_devtools();
    Ok(())
}

#[cfg(not(any(debug_assertions, feature = "devtools")))]
fn open_main<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    Err("This build has no developer tools.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_test_build_always_has_the_inspector() {
        // `cargo test` builds with debug assertions, which is a debug build.
        assert_eq!(SUPPORT, DevtoolsSupport::Always);
        assert!(enabled(false));
    }

    #[test]
    fn support_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&DevtoolsSupport::Toggle).unwrap(), "\"toggle\"");
    }
}
