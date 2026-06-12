---
name: run-app
description: Build and launch the Quark Tauri desktop app (Rust backend + WebKitGTK window) so a change can be exercised live, or run the frontend-only mock build. Use whenever the user says "run the app", "launch it", "build a test app", "let me see this in action", or wants to manually verify a backend/IPC/UI change against a real logged-in Matrix session.
---

# run-app

Quark is a Tauri v2 desktop app: a Rust backend (matrix-sdk) behind a WebKitGTK
window driven by vanilla-TS DOM. This skill builds and launches it (or the
frontend-only mock build) so a change can be driven by hand.

> **Caveat — how to run these commands.** Every `pnpm`/`cargo` command below is
> written **bare**, assuming the Rust toolchain and Tauri system libs (webkitgtk,
> gstreamer, libnotify, …) are on `PATH` — the normal case on a provisioned dev box.
> Machines that lack them can use the repo's nix flake (`flake.nix`): enter the shell
> with `nix develop` and run the bare command inside it, or one-shot it by prefixing
> `nix develop --command …`. Nix is **not** required and not every dev machine has it.
> If a bare command dies with `command not found`, that's the cue to add the prefix —
> it isn't a real failure. Quick check: `command -v cargo` → bare works; otherwise fall
> back to nix if `command -v nix` and a `flake.nix` are present.

## Two ways to run — pick by what you changed

| Goal | Command | Backend | Speed |
|------|---------|---------|-------|
| Exercise Rust / IPC / Matrix logic (search, cache, crypto, timeline) | `pnpm tauri dev` | **real** matrix-sdk, real session | Rust compile: ~30s incremental, several min cold |
| Exercise frontend-only UI (DOM, vim, theming) | `pnpm dev` | **mock** IPC (`src/ipc/mock.ts`), Vite on port 1450 | instant |

The mock path returns canned data, so it **cannot** verify a backend fix (e.g. the
search `until_ts` filter lives in Rust — mock search won't hit it). For anything
touching `src-tauri/`, use `pnpm tauri dev`.

## Launch recipe (full app)

Prereqs: `node_modules` must exist (`pnpm install` if not), and a display must be
available — Tauri opens a real window, so the launching shell needs `DISPLAY` and/or
`WAYLAND_DISPLAY` set; the window appears on the user's session.

1. **Launch in the background**, logging to a file (the build is long; never block on it):

   ```bash
   pnpm tauri dev > /tmp/quark-tauri-dev.log 2>&1
   ```

   (Run with the agent's `run_in_background: true`, not a trailing `&`.)

2. **Wait for the ready signal** with an until-loop (foreground `sleep` is blocked;
   use a background Bash until-loop or Monitor). The log is healthy when it reaches:

   ```
       Finished `dev` profile [unoptimized + debuginfo] target(s)
        Running `target/debug/quark`
   [quark] main window acquired
   INFO quark_lib::matrix::client: Session restored successfully user_id=@…
   ```

   Watch for both success and failure so silence never masks a crash:

   ```bash
   until grep -qE "main window acquired|error\[|^error:|panicked|cannot find" /tmp/quark-tauri-dev.log; do sleep 2; done
   tail -20 /tmp/quark-tauri-dev.log
   ```

3. The window is now live on the user's display. If a session is already configured the
   backend restores it on startup (`Session restored successfully`), giving you synced
   rooms and a populated SQLite event cache — so date-range search, the media cache,
   E2EE, etc. can be tested for real. Hand off to the user to drive, or screenshot to
   confirm the frame rendered (don't assume — a blank frame means it failed to paint).

4. **Stop it** by stopping the background task (TaskStop) or killing the process group.

## Benign startup noise — do NOT treat as failure

On a GTK/WebKitGTK desktop (and especially NixOS) these print on every launch and are
harmless:

- `Gtk-Message: Failed to load module "appmenu-gtk-module"` / `…-gtk-module.so: undefined symbol`
- `Gtk-WARNING … GModule (… im-fcitx5.so) initialization check failed: GLib version too old`
- `Loading IM context type 'fcitx5' failed`
- the long tail of `warning: function … is never used` from `cargo` (dead-code lints)

Real failures look like `error[E…]` / `error:` from rustc, a Rust `panicked at`, a
missing-library link error, or the process exiting before `main window acquired`.

## Notes

- Hot-reload: `pnpm tauri dev` rebuilds Rust on `src-tauri/` changes and hot-swaps the
  frontend on `src/` changes — leave it running while iterating.
- This skill only launches; for the automated test suite use `cargo test` and `pnpm test`
  (subject to the same bare-vs-nix caveat above).
