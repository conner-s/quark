# Carried Patches

Patches maintained on `integration` that are **not** going upstream. Each entry states
*why*, so it can be confidently deleted once the reason expires.

Everything else on `integration` is upstream-bound and lives on its own PR branch — see
[CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md) for the layout and the sync loop.

Last reconciled against `upstream/main` on **2026-08-20** (`1fa43cd`).

## Carried

| SHA | Files | What | Why not upstreamable | Added |
| --- | --- | --- | --- | --- |
| `b572f8a` | `design/`, `.design-sync/`, `scripts/extract-ds-slice.mjs`, `scripts/validate-ds-bundle.mjs` | Hand-authored design-system bundle consumed by claude.ai/design | Tooling for one contributor's design workflow. No upstream consumer, and it would obligate upstream to keep the slices in sync with `src/style/base.css` on every CSS change. | 2026-07-31 |
| `9b17291` | `design/components/Overlays/ContextMenu/`, `design/README.md`, `design/styles.css` | ContextMenu card + slice for the design bundle | Same reason as `b572f8a` — it is a component card inside that bundle. Split out of `25b9a15`; the `DESIGN.md` + `src/` half of that commit went upstream on `feat/context-menu`. | 2026-07-31 |
| *(tip of `integration`)* | `PATCHES.md`, `CONTRIBUTING-FORK.md` | This file and the fork workflow guide | They document *our relationship to upstream*, which is meaningless in the upstream repository. Deliberately listed without a SHA: the commit is near the tip of `integration` and its SHA changes on every rebase. | 2026-08-10 |
| *(tip of `integration`)* | `CLAUDE.md` | Fork-layout section, plus fork notes on the branching, versioning and macOS-build instructions | Same reason — it describes the fork's branch topology. **Kept as its own commit** because unlike the two files above, `CLAUDE.md` is upstream-owned and upstream edits it. Isolating it means resolving one small commit rather than untangling it from the fork-only docs. | 2026-08-11 |

## Retired carried patches

| Was | What | Why it is gone |
| --- | --- | --- |
| `a601bb4` | Version `0.18.0` across all six version-carrying files | **Dropped 2026-08-20.** Upstream is now on `0.18.0` itself, so the bump is a no-op. This was the patch that conflicted on every single sync; retiring it removes that friction entirely. Do **not** re-add a fork version bump — take upstream's number until upstream's line and ours actually diverge. |

## Upstream work riding on `integration`

Not carried patches — these are on `integration` only so local builds have them before
they land in `upstream/main`. Each has its own branch and should be dropped from
`integration` once merged upstream.

| Block | Branch | Boundary SHA | Rebase onto `1fa43cd` | Status |
| --- | --- | --- | --- | --- |
| mold linker in the devShell | `feat/nix-mold-linker` | `c54eb16` | 1 hunk in `flake.nix` (upstream appended `android-tools` to the same list) — **resolution recorded in rerere** | PR not yet opened. Branch on origin still sits on the old base; rebase before opening. |
| nix: build on darwin | `feat/nix-darwin` | `77fb0cc` | 1 hunk in `flake.nix` (upstream's `rustToolchainAndroid` block landed immediately above `tauriDeps`) — **recorded in rerere** | PR not yet opened. See the review note below. Sits after the mold commit because both restructure the same `flake.nix` region. |
| Converged context menu (4 commits) | `feat/context-menu` | `ad4e2b9` | 1 hunk in `src/ui/Input.test.ts` — two sibling `describe` blocks landing at the same line — **recorded in rerere** | PR not yet opened. Largest block (~2100 lines); expect the slowest review. |
| Read-receipt placement fix | `fix/read-receipt-placement` | `4bbb08d` | clean | PR not yet opened |
| pnpm settings → `pnpm-workspace.yaml` (2 commits) | `fix/pnpm-minimum-release-age` | `c217b01` | 1 hunk in `package.json` | PR not yet opened. **Squash the two commits before opening** — as-is they read "add setting to the wrong place, then move it". Branch on origin carries only the first commit. |
| rustc warnings + edit-fallback bug | `fix/compiler-warnings` | `2ecb66a` | clean | PR not yet opened. Branch rebased 2026-08-20 but **not yet pushed to origin**. |
| Convert a room to a DM and back | `feat/convert-dm` | `78fce92` | clean | PR not yet opened. Branch rebased 2026-08-20 but **not yet pushed to origin**. |

`integration` is ordered deliberately: `upstream/main` → our upstream-bound commits (in
exactly the form each PR branch carries) → carried patches. That ordering is what makes
the post-merge cleanup a single command — see
[CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md#when-upstream-merges-one-of-our-branches).

### Landed upstream

| Block | Landed as | Notes |
| --- | --- | --- |
| Upstream's own `fix/0.17.2` (4 commits) | [MCPlummet/quark#44](https://github.com/MCPlummet/quark/pull/44), squashed to `82f26eb` | Dropped from `integration` 2026-08-20. |

### Superseded upstream

| Was | What | Why it is gone |
| --- | --- | --- |
| `21cae57` | Align `@tauri-apps` npm packages with the tauri 2.11 crate | **Dropped 2026-08-20.** Upstream reached the same place independently — `@tauri-apps/api ^2.11.1` and `@tauri-apps/cli ^2.11.4` in both `package.json` and `pnpm-lock.yaml` — and went further (`plugin-shell 2.3.5`, `vite ^6.4.3`, `typescript ^5.9.3`). Our `pnpmDeps.hash` refresh went with it — but the hash does **not** revert to upstream's, because the pnpm-workspace change below moves it again. |

## Review notes before opening PRs

- **`feat/nix-darwin` × upstream's Android shell.** Upstream's new `mkAndroidShell` does
  `inherit buildInputs` and exports `PKG_CONFIG_PATH` / `LD_LIBRARY_PATH` from it
  *unconditionally*, whereas `devShells.default` wraps those exports in
  `optionalString isLinux`. Once `tauriDeps` is Linux-gated, `buildInputs` is empty on
  darwin and the Android shell exports a leading-empty search path (which POSIX reads as
  the current directory). Harmless in practice but sloppy; decide whether the PR should
  extend the `isLinux` guard to `mkAndroidShell` too.
- **What the darwin patch actually fixes**, for the PR description: on `upstream/main`,
  `nix eval .#devShells.aarch64-darwin.default.drvPath` fails with
  `Refusing to evaluate package 'webkitgtk-2.50.6+abi=4.1' … because it is marked as broken`.
  With the patch, both `devShells.aarch64-darwin.default` and
  `packages.aarch64-darwin.default` evaluate.
- **The pnpm patch moves `pnpmDeps.hash` — this is load-bearing.** Making the settings
  effective is precisely what changes the fetched store path: `onlyBuiltDependencies`
  starts really gating esbuild's postinstall and `minimumReleaseAge` starts really
  constraining resolution. The PR **must** carry the refreshed hash
  (`sha256-8MOecinRFwm70YC2Rzvjabo9kMY4fmnfCGpUK4tHIvk=`) or every `nix build` of the
  package fails with a fixed-output hash mismatch. Any later rebase that touches
  `pnpm-lock.yaml` or `pnpm-workspace.yaml` needs it recomputed — set it to
  `lib.fakeHash`, build, and copy the "got:" value.
- **What the pnpm patch actually fixes**: upstream's own `pnpm.onlyBuiltDependencies` in
  `package.json` is inert on the `pnpm@10.32.1` upstream pins — pnpm 10 stopped reading
  that field. Lead the PR with that, not with `minimumReleaseAge`.
- **What the warnings patch actually fixes**: `cargo build` on `upstream/main` emits 14
  warnings; one (`unused variable: new_content`) masks a real defect that makes edited
  messages re-render with a spurious leading `* ` after a resync. Zero warnings after.

## Provenance

Every commit on `integration` carries a `(cherry picked from commit …)` trailer pointing
back at its original SHA. The pre-migration history is pinned by the
`backup/pre-migration-main` tag on `origin`, and the state of `integration` before the
2026-08-20 rebuild is pinned by `backup/pre-rebuild-integration` and `sync/2026-08-20`.

## History rewrites

`integration` is rebuilt, not merged — its SHAs change on every sync. Two consequences:

- **Never `git pull` `integration`.** A pull rebases your local copy *onto* the remote and
  will happily reapply commits the rewrite already folded in — that is how the duplicated
  `fix(pnpm)` commit on `d4920bb` was created (2026-08-20). Use
  `git fetch origin && git reset --hard origin/integration` when you want the remote's
  version, and `git push --force-with-lease` when you want yours.
- Anyone tracking `integration` must reset rather than merge after a rebuild.
