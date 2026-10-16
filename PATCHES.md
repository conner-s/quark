# Carried Patches

Patches maintained on `integration` that are **not** going upstream. Each entry states
*why*, so it can be confidently deleted once the reason expires.

Everything else on `integration` is upstream-bound and lives on its own PR branch — see
[CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md) for the layout and the sync loop.

Last reconciled against `upstream/main` on **2026-10-13** (`9d1b457`, v0.20.2 — not yet tagged).

## Carried

| SHA | Files | What | Why not upstreamable | Added |
| --- | --- | --- | --- | --- |
| `0f885c6` | `design/`, `.design-sync/`, `scripts/extract-ds-slice.mjs`, `scripts/validate-ds-bundle.mjs` | Hand-authored design-system bundle consumed by claude.ai/design | Tooling for one contributor's design workflow. No upstream consumer, and it would obligate upstream to keep the slices in sync with `src/style/base.css` on every CSS change. | 2026-07-31 |
| `23146d0` | `design/components/Overlays/ContextMenu/`, `design/README.md`, `design/styles.css` | ContextMenu card + slice for the design bundle | Same reason as `0f885c6` — it is a component card inside that bundle. Split out of `25b9a15`; the `DESIGN.md` + `src/` half is now `feat/context-menu-registry`. The card predates the registry port; the shell it shows is unchanged, but its CSS slice should be re-extracted from `base.css` on the next design sync. | 2026-07-31 |
| `f84f296` | `src-tauri/deny.toml` | cargo-deny config: bans the hijacked arrayref/internment/append-only-vec releases and the attacker's typosquats, denies yanked crates, unknown git sources and non-crates.io registries | The `[bans].deny` list is generated from `~/Projects/rust-tooling/denylist.txt`, a machine-local source shared with a pre-commit hook and a Claude Code guard. Nothing upstream runs `cargo deny`. Was committed straight onto `integration` with no PR branch; recorded here 2026-10-02. If upstream ever wants it, the generic half (`yanked`, `unknown-git`, `allow-registry`) stands alone without the local denylist. | 2026-08-31 |
| `8ea2f0e` | `nix/package.nix` (one `env.CARGO_PROFILE_RELEASE_LTO` line) | Nix package builds with thin LTO instead of `Cargo.toml`'s fat LTO. Fat LTO spends 333s of a 531s release build linking the binary on one core; thin brings the full build to 177s (measured 2026-10-02, 24 cores). The binary grows from 55 to 63 MB. Source branch: `carry/nix-thin-lto`. | Trades binary size for build time, which only makes sense for a flake installed on our own machines. Upstream's flake output is for everyone, and `Cargo.toml` keeps fat LTO for the installers and the Android `.so`. `nix/package.nix` is upstream-owned, so a sync can conflict on the hunk next to `OPENSSL_NO_VENDOR`. | 2026-10-02 |
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

| Block | Branch | Boundary SHA | Rebase onto `9d1b457` | Status |
| --- | --- | --- | --- | --- |
| mold linker in the devShell | `feat/nix-mold-linker` | `8c2903f` | clean | PR not yet opened. Both devShells evaluate (x86_64-linux, aarch64-darwin); `RUSTFLAGS=-C link-arg=-fuse-ld=mold` inside `nix develop`. |
| Read-receipt placement fix | `fix/read-receipt-placement` | `2744fe2` | clean | PR not yet opened. Re-checked: upstream's `_settleTailAppend`, `appendMessages` and `prependMessages` still never call `_renderReceipts`. |
| pnpm settings → `pnpm-workspace.yaml` | `fix/pnpm-minimum-release-age` | `f0b6043` | clean | PR not yet opened. Still needed: `upstream/main` keeps `pnpm.onlyBuiltDependencies` in `package.json` on `pnpm@10.32.1`, which ignores it. Verified: `pnpm config list` reports `minimum-release-age=10080` and `only-built-dependencies[]=esbuild`, and `pnpmDeps` still builds against upstream's hash with the yaml in the fileset — so upstream's new hash gate (`.github/workflows/nix.yml`) stays green. |
| Converged context menus, ported onto the action registry (3 commits) | `feat/context-menu-registry` | `2ed6102` | clean | PR not yet opened. **Replaces `feat/context-menu`**, which upstream's registry rewrite (`f848c9b`) made unrebaseable: both added `src/app/context_menus.ts`. The port keeps the old shell (`ContextMenu.ts`, CSS) nearly verbatim and moves the content into `registry.ts`: a `compose` surface, `MENU_SECTIONS`, and `whenUnavailable` / `chip` / `hint` on `MenuSpec`. Accelerators now parse hints with the keymap's own chord helpers, since hints are live keymap sequences. Paste was rebuilt on upstream's attachment tray (`Input.pasteFromClipboard`). `tsc` + 1308 tests pass on the branch alone. The third commit (`2ed6102`, 2026-10-02) starts the Paste row's clipboard reads inside the click, the same WebKit gesture fault as the row below. No version bump on the branch yet (it would be minor: `0.21.0`). The old branch is pinned by `archive/feat-context-menu-pre-registry`. |
| GPU rendering on Linux (2 commits) | `fix/linux-gpu-rendering` | `e859517` | n/a — written against `9d1b457` | PR not yet opened. Upstream set `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `GDK_BACKEND=x11` unconditionally, so on AMD/Intel WebKit loaded no GL driver and rasterised every frame in software on the web process's main thread: ~17% idle CPU on the UI main thread and 7–22% on the web process, jittery scrolling, keystrokes queueing. Now explicit env values win, and DMA-BUF is only disabled when a DRM device is bound to NVIDIA (the check `nix/package.nix` already did). Measured 2026-10-13 on an RX 9070-class card: both main threads ~1–2% idle, inline video plays. X11 stays the default: on Wayland tao gives the window a GTK `HeaderBar`, which forces client-side Adwaita decorations instead of KWin's Breeze. `cargo test -Dwarnings` passes on the branch alone. No version bump: upstream's `0.20.2` is unreleased. |
| AbortError toast on video scrub | `fix/media-abort-toast` | `66bf026` | n/a — written against `9d1b457` | PR not yet opened. Scrubbing, or rapid play/pause in WebKit's native `<video>` controls, rejects an interrupted `play()` with `AbortError` that no app code can catch, so the global handler toasted "Unhandled error: AbortError". The handler now ignores `AbortError` by name — the controls run in their own script world, so `instanceof DOMException` fails (and the toast text proved `instanceof Error` did too). `tsc` + 1246 tests pass on the branch alone. No version bump: upstream's `0.20.2` is unreleased. |
| Build with `pnpm_10_latest` | `fix/nix-pnpm-10-latest` | `f8b726d` | n/a — written against `dad39f0` | PR not yet opened. **Out of order:** cherry-picked onto the tip of `integration` (2026-10-15) to avoid a rewrite; move it below the carried patches on the next rebuild. Newer nixpkgs pins `pnpm_10` at 10.34.0 and marks it insecure, so evaluating the package fails ("Refusing to evaluate package 'pnpm-10.34.0'"). The package now takes `pnpm_10_latest` (10.34.5) when nixpkgs has it and falls back to `pnpm_10`, so this flake's own lock (no `pnpm_10_latest`, `pnpm_10` = 10.32.1) builds unchanged. Evaluated against both; `pnpmDeps` keeps its hash under 10.34.5. |

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

- **What the pnpm patch actually fixes**: upstream's own `pnpm.onlyBuiltDependencies` in
  `package.json` is inert on the `pnpm@10.32.1` upstream pins — pnpm 10 stopped reading
  that field. Lead the PR with that, not with `minimumReleaseAge`.
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
back at its original SHA, except `f84f296` (cargo-deny), which was committed directly. The
pre-migration history is pinned by the `backup/pre-migration-main` tag on `origin`. The
state of `integration` before each rebuild is pinned by a `sync/<date>` tag:
`backup/pre-rebuild-integration` and `sync/2026-08-20`, then `sync/2026-08-31`, then
`sync/2026-10-02` (the last state that still carries the pre-registry context-menu block and the four
branches upstream has since merged or superseded), then `sync/2026-10-13` (the last state on
`32ddc36`, still carrying `fix/paste-clipboard-image`).

## History rewrites

`integration` is rebuilt, not merged — its SHAs change on every sync. Two consequences:

- **Never `git pull` `integration`.** A pull rebases your local copy *onto* the remote and
  will happily reapply commits the rewrite already folded in — that is how the duplicated
  `fix(pnpm)` commit on `d4920bb` was created (2026-08-20). Use
  `git fetch origin && git reset --hard origin/integration` when you want the remote's
  version, and `git push --force-with-lease` when you want yours.
- Anyone tracking `integration` must reset rather than merge after a rebuild.
