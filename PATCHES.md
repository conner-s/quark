# Carried Patches

Patches maintained on `integration` that are **not** going upstream. Each entry states
*why*, so it can be confidently deleted once the reason expires.

Everything else on `integration` is upstream-bound and lives on its own PR branch — see
[CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md) for the layout and the sync loop.

Last reconciled against `upstream/main` on **2026-10-20** (`dd221a6`, v0.21.0 — tagged at `9f4243f`).

## Carried

| SHA | Files | What | Why not upstreamable | Added |
| --- | --- | --- | --- | --- |
| `0d260f8` | `design/`, `.design-sync/`, `scripts/extract-ds-slice.mjs`, `scripts/validate-ds-bundle.mjs` | Hand-authored design-system bundle consumed by claude.ai/design | Tooling for one contributor's design workflow. No upstream consumer, and it would obligate upstream to keep the slices in sync with `src/style/base.css` on every CSS change. | 2026-07-31 |
| `82f7e47` | `design/components/Overlays/ContextMenu/`, `design/README.md`, `design/styles.css` | ContextMenu card + slice for the design bundle | Same reason as `0d260f8` — it is a component card inside that bundle. Split out of `25b9a15`; the `DESIGN.md` + `src/` half is now `feat/context-menu-registry`. The card predates the registry port; the shell it shows is unchanged, but its CSS slice should be re-extracted from `base.css` on the next design sync. | 2026-07-31 |
| `3cbc5d8` | `src-tauri/deny.toml` | cargo-deny config: bans the hijacked arrayref/internment/append-only-vec releases and the attacker's typosquats, denies yanked crates, unknown git sources and non-crates.io registries | The `[bans].deny` list is generated from `~/Projects/rust-tooling/denylist.txt`, a machine-local source shared with a pre-commit hook and a Claude Code guard. Nothing upstream runs `cargo deny`. Was committed straight onto `integration` with no PR branch; recorded here 2026-10-02. If upstream ever wants it, the generic half (`yanked`, `unknown-git`, `allow-registry`) stands alone without the local denylist. Re-checked 2026-10-20: `cargo-deny check bans sources` passes on upstream's Tauri 2.12 lockfile, including the path-patched vendored `swift-rs`. | 2026-08-31 |
| `fff2379` | `nix/package.nix` (one `env.CARGO_PROFILE_RELEASE_LTO` line) | Nix package builds with thin LTO instead of `Cargo.toml`'s fat LTO. Fat LTO spends 333s of a 531s release build linking the binary on one core; thin brings the full build to 177s (measured 2026-10-02, 24 cores). The binary grows from 55 to 63 MB. Source branch: `carry/nix-thin-lto`. | Trades binary size for build time, which only makes sense for a flake installed on our own machines. Upstream's flake output is for everyone, and `Cargo.toml` keeps fat LTO for the installers and the Android `.so`. `nix/package.nix` is upstream-owned, so a sync can conflict on the hunk next to `OPENSSL_NO_VENDOR`. | 2026-10-02 |
| `bb5a31c` | `.claude/skills/fork-sync/` | `fork-sync` skill: previews the sync by replaying `integration` and every branch onto the new upstream in memory, re-tests each row's premise in this file, reports a verdict and recommendation per block, then rebuilds from a scripted rebase todo. Source branch: `carry/fork-sync-skill`. Moved below the fork docs in the 2026-10-20 rebuild. | It automates *this* file's sync loop and reads this file's columns, so it is meaningless upstream for the same reason as the fork docs. | 2026-10-20 |
| *(tip of `integration`)* | `PATCHES.md`, `CONTRIBUTING-FORK.md` | This file and the fork workflow guide | They document *our relationship to upstream*, which is meaningless in the upstream repository. Deliberately listed without a SHA: the commit is near the tip of `integration` and its SHA changes on every rebase. | 2026-08-10 |
| *(tip of `integration`)* | `CLAUDE.md` | Fork-layout section, plus fork notes on the branching, versioning and macOS-build instructions | Same reason — it describes the fork's branch topology. **Kept as its own commit** because unlike the two files above, `CLAUDE.md` is upstream-owned and upstream edits it. Isolating it means resolving one small commit rather than untangling it from the fork-only docs. | 2026-08-11 |

## Retired carried patches

| Was | What | Why it is gone |
| --- | --- | --- |
| `a601bb4` | Version `0.18.0` across all six version-carrying files | **Dropped 2026-08-20.** Upstream reached `0.18.0` itself, so the bump was a no-op. This was the patch that conflicted on every single sync; retiring it removes that friction entirely. Do **not** re-add a fork version bump — take upstream's number until upstream's line and ours actually diverge. |

## Upstream work riding on `integration`

Not carried patches — these are on `integration` only so local builds have them before
they land in `upstream/main`. Each has its own branch and should be dropped from
`integration` once merged upstream.

| Block | Branch | Boundary SHA | Rebase onto `dd221a6` | Status |
| --- | --- | --- | --- | --- |
| mold linker in the devShell | `feat/nix-mold-linker` | `d422bcf` | clean | PR not yet opened. Both devShells evaluate (x86_64-linux, aarch64-darwin); `RUSTFLAGS=-C link-arg=-fuse-ld=mold` inside `nix develop`. Re-checked 2026-10-20: upstream's new root `.cargo/config.toml` carries only an `[env]` entry for swift-rs, no rustflags or linker. |
| Read-receipt placement fix | `fix/read-receipt-placement` | `bc3486c` | clean | PR not yet opened. Re-checked 2026-10-20: upstream's `_settleTailAppend`, `appendMessages` and `prependMessages` still never call `_renderReceipts` (upstream's only `Timeline.ts` change was image-click plumbing); with upstream's `Timeline.ts` 4 of the branch's tests fail. No version bump yet (patch, `0.21.1`). |
| pnpm settings → `pnpm-workspace.yaml` | `fix/pnpm-minimum-release-age` | `8aa58f0` | clean | PR not yet opened. **Rationale corrected 2026-10-20:** the old premise — that `pnpm@10.32.1` ignores `pnpm.onlyBuiltDependencies` in `package.json` — was wrong. 10.32.1's `getOptionsFromRootManifest` still reads `manifest.pnpm`; the quoted WARN comes from newer pnpm, and `pnpm config list` only reports the workspace yaml, which is what made the field look inert. The value is `minimumReleaseAge` (7 days) plus readiness for the pnpm that drops the field; commit message and yaml comment reworded to say so. Still holds on upstream's lockfile: `pnpm install --frozen-lockfile` passes (@tauri-apps 2.12.1 is ~20 days old), and `pnpmDeps` builds against upstream's new hash with the yaml in the fileset. |
| Converged context menus, ported onto the action registry (4 commits) | `feat/context-menu-registry` | `d79c0bc` | conflict in `keyboard.ts` imports (rerere replays it) | PR not yet opened. **Replaces `feat/context-menu`**, which upstream's registry rewrite (`f848c9b`) made unrebaseable: both added `src/app/context_menus.ts`. The port keeps the old shell (`ContextMenu.ts`, CSS) nearly verbatim and moves the content into `registry.ts`: a `compose` surface, `MENU_SECTIONS`, and `whenUnavailable` / `chip` / `hint` on `MenuSpec`. Accelerators now parse hints with the keymap's own chord helpers, since hints are live keymap sequences. Paste was rebuilt on upstream's attachment tray: the branch adds `Input.pasteFromClipboard` on top of upstream's `_handlePaste`/`attachFiles`. The third commit (`ef846e3`, 2026-10-02) starts the Paste row's clipboard reads inside the click, the same WebKit gesture fault as the AbortError row. The fourth (`d79c0bc`, 2026-10-20) absorbs upstream's `save-image-photos`/`save-image-file` actions (`ae4d16e`): they arrived in group 2, which `MENU_SECTIONS` labels "clipboard", so they now get their own `save` section (group 4) and the event rows move to group 5; DESIGN.md's table gains the row. That mislabel merged silently — a clean replay would have shipped it. `tsc` + 1354 tests pass on the branch alone. No version bump on the branch yet (minor: `0.22.0`). The old branch is pinned by `archive/feat-context-menu-pre-registry`. |
| GPU rendering on Linux (2 commits) | `fix/linux-gpu-rendering` | `c981df7` | clean (`lib.rs` shared) | PR not yet opened. Upstream set `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `GDK_BACKEND=x11` unconditionally, so on AMD/Intel WebKit loaded no GL driver and rasterised every frame in software on the web process's main thread: ~17% idle CPU on the UI main thread and 7–22% on the web process, jittery scrolling, keystrokes queueing. Now explicit env values win, and DMA-BUF is only disabled when a DRM device is bound to NVIDIA (the check `nix/package.nix` already did). Measured 2026-10-13 on an RX 9070-class card: both main threads ~1–2% idle, inline video plays. X11 stays the default for now. The reason was that tao 0.35 gave the window a GTK `HeaderBar` on Wayland, forcing client-side Adwaita decorations instead of KWin's Breeze — but upstream's Tauri 2.12 brings tao 0.37, which removed `wayland/header.rs` and only installs a titlebar when `decorations` is false (ours is true). Read from source, not tested: before the PR, run `GDK_BACKEND=wayland` on KDE, and if Breeze decorations appear, drop the X11 default on this branch or in a follow-up. Re-checked 2026-10-20: upstream still sets both env vars unconditionally (`lib.rs:53`, `main.rs:7`); `cargo test -Dwarnings` passes (513) on the branch alone. No version bump yet (patch, `0.21.1`). |
| AbortError toast on video scrub | `fix/media-abort-toast` | `e992ab4` | clean | PR not yet opened. Scrubbing, or rapid play/pause in WebKit's native `<video>` controls, rejects an interrupted `play()` with `AbortError` that no app code can catch, so the global handler toasted "Unhandled error: AbortError". The handler now ignores `AbortError` by name — the controls run in their own script world, so `instanceof DOMException` fails (and the toast text proved `instanceof Error` did too). Re-checked 2026-10-20: `main.ts` (and its `unhandledrejection` handler) is byte-identical upstream and `showError` kept its signature through upstream's one-toast-at-a-time rewrite (`e44f1a7`), which makes the bug worse — an AbortError toast now displaces real status toasts. `tsc` + 1288 tests pass on the branch alone. No version bump yet (patch, `0.21.1`). |
| Build with `pnpm_10_latest` | `fix/nix-pnpm-10-latest` | `d6cf3d0` | clean | PR not yet opened. Moved below the carried patches in the 2026-10-20 rebuild. Newer nixpkgs pins `pnpm_10` at 10.34.0 and marks it insecure, so evaluating the package fails ("Refusing to evaluate package 'pnpm-10.34.0'"). The package now takes `pnpm_10_latest` (10.34.5) when nixpkgs has it and falls back to `pnpm_10`, so this flake's own lock (no `pnpm_10_latest`, `pnpm_10` = 10.32.1) builds unchanged. Evaluated against both; `pnpmDeps` keeps its hash under 10.34.5. Re-checked 2026-10-20 against upstream's new `pnpmDeps` hash (`bi+Q…`): matches under this flake's lock and under nixos-26.05 (what nixos-config locks), and the full `nix build .#quark` succeeds. **Only 26.05 needs it now:** nixos-unstable (`02c087f`) ships `pnpm_10` = 10.34.5 and has removed `pnpm_10_latest`, so there the fallback is taken and the patch is a no-op. Drop it once 26.05's `pnpm_10` gets the fix, and say so in the PR. No version bump yet (patch, `0.21.1`). |

`integration` is ordered deliberately: `upstream/main` → our upstream-bound commits (in
exactly the form each PR branch carries) → carried patches. That ordering is what makes
the post-merge cleanup a single command — see
[CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md#when-upstream-merges-one-of-our-branches).

### Landed upstream

| Block | Landed as | Notes |
| --- | --- | --- |
| Upstream's own `fix/0.17.2` (4 commits) | [MCPlummet/quark#44](https://github.com/MCPlummet/quark/pull/44), squashed to `82f26eb` | Dropped from `integration` 2026-08-20. |
| `feat/nix-darwin` | [#69](https://github.com/MCPlummet/quark/pull/69), merge commit `666aebd` | Dropped 2026-10-02. Review chasers followed in `8ee0e1e`. |
| `fix/compiler-warnings` | [#71](https://github.com/MCPlummet/quark/pull/71), merge commit `4569950` | Dropped 2026-10-02. Upstream then made new rustc warnings a hard CI failure (`7cbded1`). |
| `feat/convert-dm` | [#70](https://github.com/MCPlummet/quark/pull/70), merge commit `06ec69f` | Dropped 2026-10-02. |
| `fix/paste-clipboard-image` | [#119](https://github.com/MCPlummet/quark/pull/119), merge commit `331adcb` | Dropped 2026-10-13 — the rebase skipped it as already applied (the merged `c6525c8` differs only by the cherry-pick trailer). Upstream bumped to `0.20.1` separately in #120. The branch can be deleted. |

### Superseded upstream

| Was | What | Why it is gone |
| --- | --- | --- |
| `21cae57` | Align `@tauri-apps` npm packages with the tauri 2.11 crate | **Dropped 2026-08-20.** Upstream reached the same place independently. |
| `59b759d` (`fix/pnpm-deps-hash`) | Refresh the stale `pnpmDeps.hash` | **Dropped 2026-10-02.** Upstream regenerated it to the identical value, `sha256-8MOec…`, in [#85](https://github.com/MCPlummet/quark/pull/85) (`91a58e2`), and added a CI gate (`87a4a9b`, `5987ebc`) that fails on a stale hash and prints the right one. The branch can be deleted. |
| `tenor.rs` hunk of `fix/compiler-warnings` | Dead-code allows in `tenor.rs` | **Dropped 2026-08-31.** Upstream removed Tenor ([#61](https://github.com/MCPlummet/quark/pull/61)). |

## Review notes before opening PRs

- **What the pnpm patch actually fixes** (corrected 2026-10-20): lead the PR with
  `minimumReleaseAge`. The earlier claim that `pnpm@10.32.1` ignores
  `pnpm.onlyBuiltDependencies` in `package.json` was wrong — it still reads it; only newer
  pnpm drops the field. Moving the allowlist is preparation for that upgrade, not a fix.
- **`pnpmDeps.hash` is not load-bearing for the pnpm settings.** Measured 2026-08-31 and
  again 2026-10-02: the fetched store path is the same with or without
  `pnpm-workspace.yaml` in the fileset. The comment the patch adds to `nix/package.nix`
  ("changes pnpmDeps.hash") is about future resolution-affecting settings, not these.
- **Upstream's `mkAndroidShell` exports `PKG_CONFIG_PATH` / `LD_LIBRARY_PATH`
  unconditionally**, while `devShells.default` gates its whole hook on Linux. On darwin
  `buildInputs` is empty, so the Android shell exports a leading-empty search path. This
  was a review note on `feat/nix-darwin`; it shipped as-is in #69. Harmless; an upstream
  issue at most.
- **The 2026-08-20 rebuild silently gutted the pnpm patch** (restored 2026-08-31) — the
  reason [CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md#check-that-the-rebuild-kept-the-content)
  asks for a `--stat` check after every rebuild.

## Provenance

Every commit on `integration` carries a `(cherry picked from commit …)` trailer pointing
back at its original SHA, except `3cbc5d8` (cargo-deny), which was committed directly. The
pre-migration history is pinned by the `backup/pre-migration-main` tag on `origin`. The
state of `integration` before each rebuild is pinned by a `sync/<date>` tag:
`backup/pre-rebuild-integration` and `sync/2026-08-20`, then `sync/2026-08-31`, then
`sync/2026-10-02` (the last state that still carries the pre-registry context-menu block and the four
branches upstream has since merged or superseded), then `sync/2026-10-13` (the last state on
`32ddc36`, still carrying `fix/paste-clipboard-image`), then `sync/2026-10-20` (the last state
on `9d1b457`, before the context-menu save-section rework and the pnpm rationale rewrite).

## History rewrites

`integration` is rebuilt, not merged — its SHAs change on every sync. Two consequences:

- **Never `git pull` `integration`.** A pull rebases your local copy *onto* the remote and
  will happily reapply commits the rewrite already folded in — that is how the duplicated
  `fix(pnpm)` commit on `d4920bb` was created (2026-08-20). Use
  `git fetch origin && git reset --hard origin/integration` when you want the remote's
  version, and `git push --force-with-lease` when you want yours.
- Anyone tracking `integration` must reset rather than merge after a rebuild.
