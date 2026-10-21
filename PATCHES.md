# Carried Patches

Patches maintained on `integration` that are **not** going upstream. Each entry states
*why*, so it can be confidently deleted once the reason expires.

Everything else on `integration` is upstream-bound and lives on its own PR branch — see
[CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md) for the layout and the sync loop.

Last reconciled against `upstream/main` on **2026-11-05** (`acc2f41`, v0.22.0 — `v0.22.0-beta.2` tagged at `a9e93fd`).

## Carried

| SHA | Files | What | Why not upstreamable | Added |
| --- | --- | --- | --- | --- |
| `5836d3d` | `design/`, `.design-sync/`, `scripts/extract-ds-slice.mjs`, `scripts/validate-ds-bundle.mjs` | Hand-authored design-system bundle consumed by claude.ai/design | Tooling for one contributor's design workflow. No upstream consumer, and it would obligate upstream to keep the slices in sync with `src/style/base.css` on every CSS change. Re-checked 2026-11-05: #139's theme editor (`src/theme-editor/` → `docs/theme/`) edits end-user theme TOML; it is not a design bundle, and no upstream path overlaps. **The bundle is stale:** `1623bdd` swapped the `--border-*` glyph tokens for `--frame-line/width/radius` and dropped `--thread-view-width`, and #134 removed four `thread-inline__`/`thread-view__` classes the InputBar, RoomListEntry and MessageRow slices still use. `validate-ds-bundle.mjs` passes because it checks only internal consistency. Re-extract on the next design sync. | 2026-07-31 |
| `70e96a1` | `design/components/Overlays/ContextMenu/`, `design/README.md`, `design/styles.css` | ContextMenu card + slice for the design bundle | Same reason as `5836d3d` — it is a component card inside that bundle. Split out of `25b9a15`; the `DESIGN.md` + `src/` half is now `feat/context-menu-registry`. The card predates the registry port; the shell it shows is unchanged, but its CSS slice should be re-extracted from `base.css` on the next design sync. | 2026-07-31 |
| `b1869dc` | `src-tauri/deny.toml` | cargo-deny config: bans the hijacked arrayref/internment/append-only-vec releases and the attacker's typosquats, denies yanked crates, unknown git sources and non-crates.io registries | The `[bans].deny` list is generated from `~/Projects/rust-tooling/denylist.txt`, a machine-local source shared with a pre-commit hook and a Claude Code guard. Nothing upstream runs `cargo deny`. Was committed straight onto `integration` with no PR branch; recorded here 2026-10-02. If upstream ever wants it, the generic half (`yanked`, `unknown-git`, `allow-registry`) stands alone without the local denylist. Re-checked 2026-11-05: upstream's `Cargo.lock` changed only the `quark` version line in `dd221a6..4af4a40`; `cargo-deny 0.19.6 check bans sources` passes; nothing upstream references cargo-deny; `denylist.txt` and `[bans].deny` list the same 9 entries. | 2026-08-31 |
| `1b4e63c` | `nix/package.nix` (one `env.CARGO_PROFILE_RELEASE_LTO` line) | Nix package builds with thin LTO instead of `Cargo.toml`'s fat LTO. Fat LTO spends 333s of a 531s release build linking the binary on one core; thin brings the full build to 177s (measured 2026-10-02, 24 cores). Source branch: `carry/nix-thin-lto`. | Trades binary size for build time, which only makes sense for a flake installed on our own machines. Upstream's flake output is for everyone, and `Cargo.toml` keeps fat LTO for the installers and the Android `.so`. `nix/package.nix` is upstream-owned, so a sync can conflict on the hunk next to `OPENSSL_NO_VENDOR`. Re-checked 2026-11-05: `Cargo.toml` still `lto = true`; upstream's only `package.nix` edit was the `pnpmDeps` hash, so the hunk still follows `OPENSSL_NO_VENDOR`; evaluates to `"thin"`. The wrapped binary is now 79 MB; the 55 → 63 MB figures were measured on the 2026-10-02 tree. | 2026-10-02 |
| `24e5537` | `.claude/skills/fork-sync/` | `fork-sync` skill: previews the sync by replaying `integration` and every branch onto the new upstream in memory, re-tests each row's premise in this file, reports a verdict and recommendation per block, then rebuilds from a scripted rebase todo. Source branch: `carry/fork-sync-skill`. | It automates *this* file's sync loop and reads this file's columns, so it is meaningless upstream for the same reason as the fork docs. Re-checked 2026-11-05: upstream changed nothing under `.claude/` (its skills are still `run-app` and `version-bump`). | 2026-10-20 |
| *(tip of `integration`)* | `PATCHES.md`, `CONTRIBUTING-FORK.md` | This file and the fork workflow guide | They document *our relationship to upstream*, which is meaningless in the upstream repository. Deliberately listed without a SHA: the commit is near the tip of `integration` and its SHA changes on every rebase. | 2026-08-10 |
| *(tip of `integration`)* | `CLAUDE.md` | Fork-layout section, plus fork notes on the branching, versioning and macOS-build instructions | Same reason — it describes the fork's branch topology. **Kept as its own commit** because unlike the two files above, `CLAUDE.md` is upstream-owned and upstream edits it. Isolating it means resolving one small commit rather than untangling it from the fork-only docs. Re-checked 2026-11-05: upstream did not touch `CLAUDE.md` in `dd221a6..acc2f41`. | 2026-08-11 |

## Retired carried patches

| Was | What | Why it is gone |
| --- | --- | --- |
| `a601bb4` | Version `0.18.0` across all six version-carrying files | **Dropped 2026-08-20.** Upstream reached `0.18.0` itself, so the bump was a no-op. This was the patch that conflicted on every single sync; retiring it removes that friction entirely. Do **not** re-add a fork version bump — take upstream's number until upstream's line and ours actually diverge. |

## Upstream work riding on `integration`

Not carried patches — these are on `integration` only so local builds have them before
they land in `upstream/main`. Each has its own branch and should be dropped from
`integration` once merged upstream.

| Block | Branch | Boundary SHA | Rebase onto `acc2f41` | Status |
| --- | --- | --- | --- | --- |
| mold linker in the devShell | `feat/nix-mold-linker` | `664ca19` | clean | PR not yet opened. Both devShells evaluate (x86_64-linux, aarch64-darwin); `RUSTFLAGS=-C link-arg=-fuse-ld=mold` inside `nix develop`. Re-checked 2026-11-05: upstream touched none of `flake.nix`, `flake.lock`, `.cargo/`, `.github/`; root `.cargo/config.toml` still carries only the swift-rs `[env]` entry. On upstream + branch the devShell exports `-C link-arg=-fuse-ld=mold` (mold 2.40.4; x86_64-linux only re-checked). |
| pnpm settings → `pnpm-workspace.yaml` | `fix/pnpm-minimum-release-age` | `be9bf61` | clean | PR not yet opened. The old premise — that `pnpm@10.32.1` ignores `pnpm.onlyBuiltDependencies` in `package.json` — was wrong (corrected 2026-10-20): the value is `minimumReleaseAge` (7 days) plus readiness for the pnpm that drops the field. Re-checked 2026-11-05: upstream's one new dependency, `smol-toml` 1.9.1 (#139), was published 2026-10-09, so the gate passes it; `pnpm install --frozen-lockfile` passes on 10.32.1 on upstream + branch and on the rebuilt `integration` (with highlight.js). `pnpmDeps` matches upstream's hash (`v/AT…`) with the yaml in the fileset under 10.32.1 and 10.34.5 (`--rebuild`), at the same store path as without it. **Before the PR:** the patch's "REQUIRED here" comment on the `pnpmDeps` fileset overstates it — the yaml is load-bearing for the main `src` fileset (where `onlyBuiltDependencies` now lives), not for the fetcher. |
| Converged context menus, ported onto the action registry (5 commits) | `feat/context-menu-registry` | `0ce2314` | conflicts, resolved by hand (rerere had no record): `keyboard.ts` message-menu block, `Input.ts` fields, `context_menus.test.ts`; then, onto #142, `keyboard.ts` room/section/space menus, `parity.ts`, `registry.ts` | PR not yet opened. **Replaces `feat/context-menu`**, which upstream's registry rewrite (`f848c9b`) made unrebaseable. The port keeps the old shell (`ContextMenu.ts`, CSS) nearly verbatim and moves the content into `registry.ts`: a `compose` surface, `MENU_SECTIONS`, and `whenUnavailable` / `chip` / `hint` on `MenuSpec`. Accelerators parse hints with the keymap's own chord helpers. Paste is built on upstream's attachment tray (`Input.pasteFromClipboard` over `_handlePaste`/`attachFiles`); the third commit starts the Paste row's clipboard reads inside the click (the same WebKit gesture fault as the AbortError row); the fourth gives `save-image-photos`/`save-image-file` their own `save` section. Re-checked 2026-11-05: upstream has no compose menu, `MENU_SECTIONS`, section/chip rows or compose undo history, and every helper and CSS token the branch uses still exists. Resolutions: upstream `ca29492` folded the timeline and thread menus into `showMessageMenu(eventId, x, y, surfaceOnly)`; the branch adds a `selection` argument, copy-as-quote, search-web/copy-selection and the `message · <sender>` title to it, and upstream's `findLoadedEvent` replaces the branch's buffer lookup. `Input.ts` keeps upstream's `_threadMode` beside the undo fields. `context_menus.test.ts` takes the branch's shape test with upstream's "Reply in thread" label (`35c8480`). #142's `create` surface sits beside `compose` in `MenuSurface` and both parity tables; its room-menu move rows and section/space create rows keep the branch's menu titles, and its `+` menu is titled `create`. **Fifth commit (2026-11-05):** upstream `7170d4e` moved thread replies into `ThreadView`, so thread-panel menus lost the selection rows; `ThreadView` now passes `selectionWithin(row)` on right-click, long press and ⋯, and DESIGN.md says what the thread menu leaves out. `tsc` + 1669 tests pass on `acc2f41` + branch. No version bump yet (minor: `0.23.0`). The old branch is pinned by `archive/feat-context-menu-pre-registry`. |
| GPU rendering on Linux (2 commits) | `fix/linux-gpu-rendering` | `30d2d73` | clean (`lib.rs` shared) | PR not yet opened. Upstream set `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `GDK_BACKEND=x11` unconditionally, so on AMD/Intel WebKit loaded no GL driver and rasterised every frame in software on the web process's main thread: ~17% idle CPU on the UI main thread and 7–22% on the web process, jittery scrolling, keystrokes queueing. Now explicit env values win, and DMA-BUF is only disabled when a DRM device is bound to NVIDIA (the check `nix/package.nix` already did). Measured 2026-10-13 on an RX 9070-class card: both main threads ~1–2% idle, inline video plays. X11 stays the default for now: tao 0.35 gave the window a GTK `HeaderBar` on Wayland, but upstream's Tauri 2.12 brings tao 0.37, which only installs a titlebar when `decorations` is false (ours is true). Read from source, not tested: before the PR, run `GDK_BACKEND=wayland` on KDE, and if Breeze decorations appear, drop the X11 default on this branch or in a follow-up. Re-checked 2026-11-05: upstream still sets both unconditionally (`lib.rs:53`, `main.rs:7`); #133, #136 and #142 edited `lib.rs` elsewhere only (media server also on Android, a crypto log directive, verification state, new command registrations). `RUSTFLAGS=-Dwarnings cargo test` passes (539) on `4af4a40` + branch. No version bump yet (patch, `0.22.1`). |
| AbortError toast on video scrub | `fix/media-abort-toast` | `4d6cf72` | clean (`main.ts` shared with #142) | PR not yet opened. Scrubbing, or rapid play/pause in WebKit's native `<video>` controls, rejects an interrupted `play()` with `AbortError` that no app code can catch, so the global handler toasted "Unhandled error: AbortError". The handler now ignores `AbortError` by name — the controls run in their own script world, so `instanceof DOMException` fails. Re-checked 2026-11-05: #142's only `main.ts` change moves the settings/profile wiring to the status bar; the `unhandledrejection` handler is untouched, `showError(message, duration?)` is unchanged, and upstream `src/` has no `AbortError` handling. #133 routes Android inline video through the loopback server (`inlineVideoTransport`), so Android's WebView now plays inline `<video>` too — untested for the same leak. No version bump yet (patch, `0.22.1`). |
| Build with `pnpm_10_latest` | `fix/nix-pnpm-10-latest` | `f88a8fd` | clean | PR not yet opened. Newer nixpkgs pins `pnpm_10` at 10.34.0 and marks it insecure, so evaluating the package fails ("Refusing to evaluate package 'pnpm-10.34.0'"). The package now takes `pnpm_10_latest` (10.34.5) when nixpkgs has it and falls back to `pnpm_10`. Re-checked 2026-11-05: upstream still uses `pnpm_10`, and its package still refuses to evaluate on nixos-26.05 (`7dcdd87`, 2026-11-02 — still the channel head and what nixos-config locks; `pnpm_10` = 10.34.0, 9 CVEs). With the patch it takes 10.34.5 and `pnpmDeps` matches. A no-op fallback on nixos-unstable (`1d06008`: `pnpm_10` = 10.34.7, no `pnpm_10_latest`) and on this flake's lock (10.32.1). **Only 26.05 needs it:** drop it once 26.05's `pnpm_10` gets the fix, and say so in the PR. No version bump yet (patch, `0.22.1`). |
| Fenced code blocks: compose, sanitize, highlight, `[colors.syntax]` (6 commits) | `feat/code-highlighting` | `2dccbbc` | reworked onto `4af4a40` (conflicts in `nix/package.nix`, `threads.ts`/`.test.ts`, `Timeline.ts` imports, `loader.ts`/`builtins.ts`/`loader.test.ts`, `mock.ts`, `message_body.ts`/`.test.ts`, `DESIGN.md`, plus a semantic one in `share.ts`); clean onto #142 | PR not yet opened. New this sync: folded in on 2026-10-21 via fork PR #2 as merge `96fe289`, above the carried patches; the rebuild flattened it into this section. Re-checked 2026-11-05: upstream has no highlighting, code-block CSS or syntax theming. #139 rebuilt theming around a pure `themeToCssVars` and a `THEME_SCHEMA` (`share.ts`) that mirrors the Rust struct and drives the theme editor, so `[colors.syntax]` now goes through both: its colour tables feed `themeToCssVars`; `applyTheme` alone sets `data-theme-applied` and clears absent syntax keys; the schema gains an optional "Code blocks" section (an empty optional colour is valid, an all-empty table is left out of the TOML); the editor's colour control accepts an empty optional colour and its preview sets `data-theme-applied`. A clean merge would have shipped 7 `share.test.ts` failures: the editor dropped the table on every import. The bundled `themes/*.toml` lose their comments (upstream's byte-for-byte rule); `builtins.parity.test.ts` keeps only its `vars.css` checks (its `ImportMeta.glob` declaration collided with upstream's `vite-env.d.ts`). Upstream `7170d4e` already gives the optimistic thread reply its formatted body, so the branch only fetches that reply's custom emoji. `pnpmDeps` = `sha256-B7XjjE6BjioU1K4qfWSuLMm3J6XSdwCPmPmCAhg3B94=` (upstream's smol-toml plus highlight.js), the same under pnpm 10.32.1 and nixos-26.05's 10.34.5. `tsc` + 1835 tests pass on `acc2f41` + branch; `cargo test -Dwarnings` (552) passed on `4af4a40` + branch; the app, demo and theme-editor builds succeed. **Before the PR:** rebuild the committed `docs/demo` and `docs/theme` in a final `chore(site)` commit. No version bump yet (minor: `0.23.0`). |
| Old and plain-text fenced messages drawn as code blocks (1 commit) | `feat/plain-body-code-blocks` | `fb37270` | reworked onto `4af4a40` (conflicts in `message_body.ts`/`.test.ts`; `Timeline.ts`/`ThreadView.ts` hunks dropped); clean onto #142 | PR not yet opened. Stacked on `feat/code-highlighting`, so it opens with or after that PR. New this sync: folded in via fork PR #3 as merge `9a38f4d`; flattened like the above. Its one-render-path refactor (`renderMessageBody`) landed independently upstream as `renderMessageText` (`1623bdd`, which also adds emoji-only sizing), and upstream deleted the inline thread it edited (`7170d4e`). `renderPlainBody` and `repairTextFences` now hang off `renderMessageText`, and a fenced emoji-only message draws as code, not at emoji size. `tsc` + 1883 tests pass on `acc2f41` + both branches. No version bump yet (minor). |
| Reaction hover card: who reacted (1 commit) | `feat/reaction-tooltip` | `d7d049f` | branch: clean onto #142 (conflicts in `DESIGN.md` and `reactions.ts` onto #134 resolved earlier); on `integration`, a `Timeline.ts` imports conflict with `feat/code-highlighting`'s `withoutCode` | PR not yet opened. New 2026-11-05. Hovering a reaction chip, in the timeline or the thread panel, lists who reacted in the card the read receipts use. The backend always sent `senders`; every IPC-to-chip mapping (including upstream's new thread mapper and thread-panel updates from #134) now goes through `_toReactionChips`. The receipt card moved out of `Timeline` into `src/ui/UserListCard.ts`, one instance per surface, because `ThreadView` is mounted beside the timeline's list rather than in it. The card caps at 15 rows ("and N more") — for receipts too. `tsc` + 1607 tests pass on `acc2f41` + branch. No version bump yet (minor: `0.23.0`). |

`integration` is ordered deliberately: `upstream/main` → our upstream-bound commits (in
exactly the form each PR branch carries) → carried patches. That ordering is what makes
the post-merge cleanup a single command — see
[CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md#when-upstream-merges-one-of-our-branches).
Fold new work in with `git cherry-pick -x` *below* the carried patches; merging a fork PR
into `integration` puts it above them (as `96fe289` and `9a38f4d` did) and leaves the next
sync to flatten it.

### Landed upstream

| Block | Landed as | Notes |
| --- | --- | --- |
| Upstream's own `fix/0.17.2` (4 commits) | [MCPlummet/quark#44](https://github.com/MCPlummet/quark/pull/44), squashed to `82f26eb` | Dropped from `integration` 2026-08-20. |
| `feat/nix-darwin` | [#69](https://github.com/MCPlummet/quark/pull/69), merge commit `666aebd` | Dropped 2026-10-02. Review chasers followed in `8ee0e1e`. |
| `fix/compiler-warnings` | [#71](https://github.com/MCPlummet/quark/pull/71), merge commit `4569950` | Dropped 2026-10-02. Upstream then made new rustc warnings a hard CI failure (`7cbded1`). |
| `feat/convert-dm` | [#70](https://github.com/MCPlummet/quark/pull/70), merge commit `06ec69f` | Dropped 2026-10-02. |
| `fix/paste-clipboard-image` | [#119](https://github.com/MCPlummet/quark/pull/119), merge commit `331adcb` | Dropped 2026-10-13 — the rebase skipped it as already applied (the merged `c6525c8` differs only by the cherry-pick trailer). Upstream bumped to `0.20.1` separately in #120. The branch can be deleted. |
| `fix/read-receipt-placement` | [#135](https://github.com/MCPlummet/quark/pull/135), as `0621bd3` (merge `74382ed`) | Dropped 2026-11-05. Upstream took the commit patch-for-patch (`git cherry`) and built its one-pass receipt reconciliation (`7b56ce5`, "supersedes #72") on top. The branch can be deleted. |

### Superseded upstream

| Was | What | Why it is gone |
| --- | --- | --- |
| `21cae57` | Align `@tauri-apps` npm packages with the tauri 2.11 crate | **Dropped 2026-08-20.** Upstream reached the same place independently. |
| `59b759d` (`fix/pnpm-deps-hash`) | Refresh the stale `pnpmDeps.hash` | **Dropped 2026-10-02.** Upstream regenerated it to the identical value, `sha256-8MOec…`, in [#85](https://github.com/MCPlummet/quark/pull/85) (`91a58e2`), and added a CI gate (`87a4a9b`, `5987ebc`) that fails on a stale hash and prints the right one. The branch can be deleted. |
| `tenor.rs` hunk of `fix/compiler-warnings` | Dead-code allows in `tenor.rs` | **Dropped 2026-08-31.** Upstream removed Tenor ([#61](https://github.com/MCPlummet/quark/pull/61)). |
| `renderMessageBody` half of `feat/plain-body-code-blocks` | One render path for every message surface | **Dropped 2026-11-05.** Upstream landed the same refactor as `renderMessageText` (`1623bdd`); the branch now hangs its fence handling off that. |
| Optimistic-thread-reply hunk of `feat/code-highlighting` | Give the pending thread reply its formatted body | **Dropped 2026-11-05.** Upstream `7170d4e` sends it; the branch keeps only fetching that reply's custom emoji. |

## Review notes before opening PRs

- **What the pnpm patch actually fixes** (corrected 2026-10-20): lead the PR with
  `minimumReleaseAge`. The earlier claim that `pnpm@10.32.1` ignores
  `pnpm.onlyBuiltDependencies` in `package.json` was wrong — it still reads it; only newer
  pnpm drops the field. Moving the allowlist is preparation for that upgrade, not a fix.
- **`pnpmDeps.hash` is not load-bearing for the pnpm settings.** Measured 2026-08-31,
  2026-10-02 and 2026-11-05: the fetched store path is the same with or without
  `pnpm-workspace.yaml` in the fileset. The comment the patch adds to `nix/package.nix`
  overstates this; reword it before the PR.
- **`feat/code-highlighting` carries a `pnpmDeps` hash for upstream's lockfile plus
  highlight.js.** If upstream changes dependencies before it lands, the hash goes stale
  again: set `lib.fakeHash` and read the `got:` line from `nix build .#quark.pnpmDeps`, or
  let upstream's CI gate print it.
- **The code-block PRs ship committed site builds.** `docs/demo` and `docs/theme` are
  checked-in Vite output, so the live theme editor shows no code blocks until a
  `chore(site)` rebuild lands with them.
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
back at its original SHA, except `b1869dc` (cargo-deny), which was committed directly. The
pre-migration history is pinned by the `backup/pre-migration-main` tag on `origin`. The
state of `integration` before each rebuild is pinned by a `sync/<date>` tag:
`backup/pre-rebuild-integration` and `sync/2026-08-20`, then `sync/2026-08-31`, then
`sync/2026-10-02` (the last state that still carries the pre-registry context-menu block and the four
branches upstream has since merged or superseded), then `sync/2026-10-13` (the last state on
`32ddc36`, still carrying `fix/paste-clipboard-image`), then `sync/2026-10-20` (the last state
on `9d1b457`, before the context-menu save-section rework and the pnpm rationale rewrite), then
`sync/2026-11-05` (the last state on `dd221a6`: still carrying `fix/read-receipt-placement`,
with the code-block branches as fork-PR merges above the carried patches).

## History rewrites

`integration` is rebuilt, not merged — its SHAs change on every sync. Two consequences:

- **Never `git pull` `integration`.** A pull rebases your local copy *onto* the remote and
  will happily reapply commits the rewrite already folded in — that is how the duplicated
  `fix(pnpm)` commit on `d4920bb` was created (2026-08-20). Use
  `git fetch origin && git reset --hard origin/integration` when you want the remote's
  version, and `git push --force-with-lease` when you want yours.
- Anyone tracking `integration` must reset rather than merge after a rebuild.
