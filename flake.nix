{
  description = "Quark — a terminal-aesthetic Matrix client (Tauri v2)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs { inherit system overlays; };

        # Rust toolchain — stable + wasm target for Tauri bundler
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
        };

        # Tauri v2 Linux system dependencies
        tauriDeps = with pkgs; [
          webkitgtk_4_1
          gtk3
          glib
          glib-networking
          libayatana-appindicator
          librsvg
          openssl
          pkg-config
          patchelf
          sqlite

          # X11 / clipboard / notifications
          xdotool
          xorg.libxcb
          libnotify
          dbus
        ];

        nativeBuildInputs = with pkgs; [
          rustToolchain
          nodejs_22
          nodePackages.pnpm
          cargo-tauri
          pkg-config
        ];

        buildInputs = tauriDeps;
      in
      {
        devShells.default = pkgs.mkShell {
          inherit nativeBuildInputs buildInputs;

          # Required so pkg-config and dynamic linker can find system libs
          shellHook = ''
            export PKG_CONFIG_PATH="${pkgs.lib.makeSearchPathOutput "dev" "lib/pkgconfig" buildInputs}:$PKG_CONFIG_PATH"
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath buildInputs}:$LD_LIBRARY_PATH"
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
            export WEBKIT_DISABLE_COMPOSITING_MODE=1
          '';
        };
      }
    );
}
