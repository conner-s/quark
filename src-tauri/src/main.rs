// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
	// Temporary fix for gdk window issue on KDE
	if cfg!(target_os = "linux") {
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WAYLAND_DISPLAY", "");
    }
    quark_lib::run();
}
