// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
	// Temporary fix for gdk window issue on KDE. An explicit GDK_BACKEND wins,
	// so `GDK_BACKEND=wayland` runs natively instead of through Xwayland.
	if cfg!(target_os = "linux") && std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WAYLAND_DISPLAY", "");
    }
    quark_lib::run();
}
