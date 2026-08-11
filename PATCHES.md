# Carried Patches

Patches maintained on `integration` that are **not** going upstream. Each entry states
*why*, so it can be confidently deleted once the reason expires.

Everything else on `integration` is upstream-bound and lives on its own PR branch — see
[CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md) for the layout and the sync loop.

Last reconciled against `upstream/main` on **2026-08-31** (`1feb77d`, v0.18.1).

## Carried

| SHA | Files | What | Why not upstreamable | Added |
| --- | --- | --- | --- | --- |
| `d486e78` | `design/`, `.design-sync/`, `scripts/extract-ds-slice.mjs`, `scripts/validate-ds-bundle.mjs` | Hand-authored design-system bundle consumed by claude.ai/design | Tooling for one contributor's design workflow. No upstream consumer, and it would obligate upstream to keep the slices in sync with `src/style/base.css` on every CSS change. | 2026-07-31 |
| `a23edbf` | `design/components/Overlays/ContextMenu/`, `design/README.md`, `design/styles.css` | ContextMenu card + slice for the design bundle | Same reason as `d486e78` — it is a component card inside that bundle. Split out of `25b9a15`; the `DESIGN.md` + `src/` half of that commit went upstream on `feat/context-menu`. | 2026-07-31 |
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

| Block | Branch | Boundary SHA | Rebase onto `1feb77d` | Status |
| --- | --- | --- | --- | --- |
| mold linker in the devShell | `feat/nix-mold-linker` | `0d5bc18` | 1 hunk in `flake.nix`, replayed from rerere | PR not yet opened. Branch had been left on the pre-`1fa43cd` base; rebased across both syncs 2026-08-31 and pushed. |
| nix: build on darwin | `feat/nix-darwin` | `a38c03e` | 1 hunk in `flake.nix`, replayed from rerere | PR not yet opened. Rebased across both syncs 2026-08-31. Re-verified: `devShells.aarch64-darwin.default` evaluates with the patch and the Linux shell still evaluates. |
| Converged context menu (4 commits) | `feat/context-menu` | `06ff055` | 1 hunk in `src/ui/Input.test.ts` — upstream's `compose-row action buttons` / `hidden mode indicator` blocks land where ours open. Keep both, upstream's first, each closed. | PR not yet opened. Largest block (~2100 lines). Rebased across both syncs 2026-08-31; `tsc` + 794 tests pass on the branch alone. |
| Read-receipt placement fix | `fix/read-receipt-placement` | `8ec58f0` | clean | PR not yet opened |
| Stale `pnpmDeps.hash` on upstream | `fix/pnpm-deps-hash` | `59b759d` | clean | PR not yet opened. **Split out of the pnpm branch 2026-08-31** — see the note below. Fixes a live breakage on `upstream/main`, so it is the most obviously mergeable branch here. |
| pnpm settings → `pnpm-workspace.yaml` | `fix/pnpm-minimum-release-age` | `e89f94a` | clean | PR not yet opened. **Content restored 2026-08-31** after the 2026-08-20 rebuild dropped it — see the note below. Now a single commit, so the old "squash before opening" caveat is discharged. |
| rustc warnings + edit-fallback bug | `fix/compiler-warnings` | `fcbc73e` | modify/delete on `src-tauri/src/gif/tenor.rs` — upstream deleted the file (#61). Accept the deletion; the giphy/klipy halves still apply. | PR not yet opened. Rebased and message corrected 2026-08-31 (counts re-measured against `1feb77d`). |
| Convert a room to a DM and back | `feat/convert-dm` | `94ce8d7` | clean | PR not yet opened |

`integration` is ordered deliberately: `upstream/main` → our upstream-bound commits (in
exactly the form each PR branch carries) → carried patches. That ordering is what makes
the post-merge cleanup a single command — see
[CONTRIBUTING-FORK.md](CONTRIBUTING-FORK.md#when-upstream-merges-one-of-our-branches).

### Dropped into upstream's changes

| Was | What | Why it is gone |
| --- | --- | --- |
| `tenor.rs` hunk of `fix/compiler-warnings` | `#[allow(dead_code)]` on `TenorResponse::next` / `TenorMediaFormat::size`, and wiring `search()` to the tested `build_search_url` | **Dropped 2026-08-31.** Upstream removed Tenor entirely ([#61](https://github.com/MCPlummet/quark/pull/61), `8835044`), so the file the hunk edited no longer exists. Resolve the modify/delete by accepting the deletion; the giphy and klipy halves of the commit are unaffected and still needed. |

### Landed upstream

| Block | Landed as | Notes |
| --- | --- | --- |
| Upstream's own `fix/0.17.2` (4 commits) | [MCPlummet/quark#44](https://github.com/MCPlummet/quark/pull/44), squashed to `82f26eb` | Dropped from `integration` 2026-08-20. |

### Superseded upstream

| Was | What | Why it is gone |
| --- | --- | --- |
| `21cae57` | Align `@tauri-apps` npm packages with the tauri 2.11 crate | **Dropped 2026-08-20.** Upstream reached the same place independently — `@tauri-apps/api ^2.11.1` and `@tauri-apps/cli ^2.11.4` in both `package.json` and `pnpm-lock.yaml` — and went further (`plugin-shell 2.3.5`, `vite ^6.4.3`, `typescript ^5.9.3`). Our `pnpmDeps.hash` refresh went with it. Upstream has since bumped further without refreshing the hash, so the refresh is back — as `fix/pnpm-deps-hash`, and as a fix to upstream's breakage rather than a side effect of ours. |

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
- **The 2026-08-20 rebuild silently gutted the pnpm patch; it was restored 2026-08-31.**
  `c217b01` kept the commit *message* — which describes creating `pnpm-workspace.yaml`,
  dropping the `pnpm` field from `package.json` and widening both `nix/package.nix`
  filesets — while its diff had shrunk to the one-line `pnpmDeps.hash` bump. The file
  never existed on `integration`, so `minimumReleaseAge` sat in `package.json` where
  pnpm 10 ignores it and the 7-day supply-chain guard was inert again, exactly the bug
  the commit was written to fix. Restored from the pre-migration original `5fdde9a`.
  Verified: `pnpm config list` now reports `minimum-release-age=10080` and
  `only-built-dependencies[]=esbuild`, neither of which it did before.

- **`pnpmDeps.hash` is *not* load-bearing for the pnpm settings — the old note was wrong.**
  Measured on x86_64-linux 2026-08-31 with `lib.fakeHash`: the fetched store path is
  `sha256-8MOecinRFwm70YC2Rzvjabo9kMY4fmnfCGpUK4tHIvk=` **with or without**
  `pnpm-workspace.yaml` in the fileset. Making the settings effective does not change
  what the fetcher stores. The hash movement that got attributed to this patch actually
  belongs to upstream's dependency bumps, which is why it is now its own branch
  (`fix/pnpm-deps-hash`). `upstream/main` still specifies the pre-bump
  `sha256-gInn…`, so `nix build .#packages.x86_64-linux.default` fails on upstream today
  with a fixed-output hash mismatch. A future lockfile change still needs the hash
  recomputed — set `lib.fakeHash`, build, copy the "got:" value.

- **What the pnpm patch actually fixes**: upstream's own `pnpm.onlyBuiltDependencies` in
  `package.json` is inert on the `pnpm@10.32.1` upstream pins — pnpm 10 stopped reading
  that field. Lead the PR with that, not with `minimumReleaseAge`.

- **What the warnings patch actually fixes** (re-measured against `1feb77d`): `cargo build`
  on `upstream/main` emits **9** warnings, not the 14 from the last sync — upstream's
  Tenor removal took the rest with it. One (`unused variable: new_content`) masks a real
  defect that makes edited messages re-render with a spurious leading `* ` after a
  resync. Zero warnings after; clippy goes 37 → 28, i.e. the clippy-specific advisory set
  is untouched. **Measure this with a built `dist/` present** — without one,
  `tauri::generate_context!` panics, the build aborts before dead-code analysis runs, and
  you will see 3 warnings instead of 9 and wrongly conclude the GIF hunks are obsolete.

## Provenance

Every commit on `integration` carries a `(cherry picked from commit …)` trailer pointing
back at its original SHA. The pre-migration history is pinned by the
`backup/pre-migration-main` tag on `origin`, and the state of `integration` before the
2026-08-20 rebuild is pinned by `backup/pre-rebuild-integration` and `sync/2026-08-20`.
The state before the 2026-08-31 sync is pinned by `sync/2026-08-31`.

## History rewrites

`integration` is rebuilt, not merged — its SHAs change on every sync. Two consequences:

- **Never `git pull` `integration`.** A pull rebases your local copy *onto* the remote and
  will happily reapply commits the rewrite already folded in — that is how the duplicated
  `fix(pnpm)` commit on `d4920bb` was created (2026-08-20). Use
  `git fetch origin && git reset --hard origin/integration` when you want the remote's
  version, and `git push --force-with-lease` when you want yours.
- Anyone tracking `integration` must reset rather than merge after a rebuild.
