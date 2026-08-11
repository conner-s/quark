# Working on this fork

`conner-s/quark` is a fork of [`MCPlummet/quark`](https://github.com/MCPlummet/quark).
This file describes how the branches are laid out and how to keep them in sync. For the
project's own contributor docs see [CLAUDE.md](CLAUDE.md) and [DESIGN.md](DESIGN.md).

## Layout

```text
upstream/main  ────────────────────────────►
                    │
origin/main    ─────┘  exact mirror of upstream, zero unique commits
                    │
fix/<topic>     ────┤   one per upstreamable change, branched off upstream/main
feat/<topic>    ────┤
                    │
integration     ────┴──► everything above, plus the carried patches
```

- **`main`** is a read-only mirror. Never commit to it. If `git log upstream/main..main`
  prints anything, something went wrong.
- **`fix/*` / `feat/*`** each hold exactly one logical change, branched off
  `upstream/main`, and are what PRs are opened from. No carried patches ever land here.
- **`integration`** is the branch to build and run from. It is every upstream-bound branch
  stacked in order, then the carried patches on top.
- **Carried patches** are documented in [PATCHES.md](PATCHES.md), with a stated reason
  each one is not upstreamable.

## Remotes

```text
origin     git@github.com:conner-s/quark.git      (fetch + push)
upstream   https://github.com/MCPlummet/quark.git (fetch only — push URL is DISABLED)
```

The upstream push URL is deliberately set to `DISABLED` so an absent-minded `git push
upstream` fails loudly instead of trying to write to someone else's repository.

## Starting a change

```bash
git fetch upstream
git switch -c fix/<topic> upstream/main     # branch off upstream, NEVER off integration
```

Work, commit, then fold it into `integration` so local builds pick it up:

```bash
git switch integration
git cherry-pick -x <first>..<last>          # -x records provenance; always pass it
```

Keep the upstream-bound commits *below* the carried patches on `integration`. If the
carried patches are already on top, rebase the new work underneath rather than appending
above it — the ordering is what makes post-merge cleanup a one-liner.

## Before opening a PR

Prove the branch stands alone. A change developed against `integration` can silently
depend on a carried patch.

```bash
git switch fix/<topic>
git log --oneline upstream/main..HEAD       # only this change's commits
git diff --stat upstream/main...HEAD        # only files this change should touch — no design/
npx tsc --noEmit && pnpm test
cd src-tauri && cargo test
```

Run the suite against `upstream/main` + this branch **only**, never via `integration`. If
it fails, the missing dependency is exactly what has to be included in the PR or
refactored out — do not paper over it by pulling in extra commits.

### Building on macOS

Use the dev shell:

```bash
nix develop
cd src-tauri && cargo test
```

On `upstream/main` this does not work — the flake hard-requires WebKitGTK/GTK/GStreamer
for every system, so `devShells.aarch64-darwin` and `packages.aarch64-darwin` both fail to
evaluate. The `feat/nix-darwin` commit on `integration` gates that surface, and `nix
develop` then gives you clang plus the pinned rust/node/pnpm.

**Outside** the dev shell, a bare macOS shell picks up nix's `cc` — which is **GCC**, not
clang — and the build dies twice over: `ld: library not found for -liconv` with no SDK on
the search path, then `mac-notification-sys` and `libsqlite3-sys` failing because GCC
can't compile their Objective-C. If you must build outside the shell, point it at the
system toolchain:

```bash
export SDKROOT="$(xcrun --show-sdk-path)"
export CC=/usr/bin/clang CXX=/usr/bin/clang++
export RUSTFLAGS="-C linker=/usr/bin/clang"
cd src-tauri && cargo test
```

Note these are *different toolchains* — the dev shell pins its own rust, so switching
between the two rebuilds the whole dependency graph.

Building on macOS also leaves `src-tauri/gen/schemas/macOS-schema.json` dirty: it is a
tracked generated file, and upstream regenerates only the desktop/linux/acl schemas
because upstream builds on Linux. Discard it (`git checkout --`) unless you specifically
intend to carry a regenerated macOS schema — it is not part of any change here.

Upstream notes, verified 2026-08-10:

- Upstream **squash-merges** every PR (no merge commits in the last 100 on `main`).
- There is no `CONTRIBUTING.md`, no CLA, and no DCO/`Signed-off-by` requirement.
- Upstream's README asks each PR to bump the version in `package.json`,
  `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` together. Our `0.18.0` bump is a
  carried patch, so add a per-PR bump on the branch itself if the maintainer wants one —
  don't cherry-pick `df06aaa`.

## The sync loop

```bash
# Recovery point that survives gc
git tag sync/$(date +%Y-%m-%d) integration

# Refresh main
git switch main
git fetch upstream
git reset --hard upstream/main
git push --force-with-lease origin main

# Rebase each live branch
git switch fix/<topic>
git rebase upstream/main
git push --force-with-lease

git switch integration
git rebase upstream/main
git push --force-with-lease
```

`rerere` is enabled, so conflicts resolved once (notably the version-bump patch, which
conflicts on nearly every sync) replay automatically on later rebases.

Never use bare `--force`. `--force-with-lease` refuses to overwrite work you haven't seen.

## When upstream merges one of our branches

Upstream squashes, so rebasing `integration` afterwards would replay commits that are
already in `upstream/main` and conflict with itself. Skip past them explicitly using the
boundary SHA recorded in [PATCHES.md](PATCHES.md):

```bash
git fetch upstream
git rebase --onto upstream/main <boundary-sha> integration
```

where `<boundary-sha>` is the last commit of the block that just landed upstream. Then
update the table in [PATCHES.md](PATCHES.md).

## During review

Push review fixes as **new commits**. Do not force-push mid-review unless a maintainer
asks for a rebase — force-pushing marks GitHub's inline review comments as outdated and
collapses the threads. Since upstream squashes at merge, extra commits cost nothing; name
them `fixup! <original subject>` so they read as corrections.

## Recovery points

| Ref | What it pins |
| --- | --- |
| `backup/pre-migration-main` | The fork's `main` as it stood before the 2026-08-10 migration (`1ee9ea4`) |
| `backup/pre-migration-stash-0` | The WIP stash that sat on `feature/search-implementation` |
| `archive/beta` | The `beta` branch at `4dc1ae0` |
| `archive/feature-search-implementation` | That branch at `ef2fbc5` |
| `archive/feature-video-embed` | That branch at `36e7799` |
| `archive/pr-msc2530-caption` | `pr/msc2530-caption` at `ecd733a` — landed upstream as #26 |
| `archive/pr-nix-package` | `pr/nix-package` at `2127d9f` — landed upstream as #25 |
| `archive/feat-nix-package` | `feat/nix-package` at `5feb273` — superseded by the above |
| `archive/nix-darwin-package` | `nix-darwin-package` at `24639ca` — its one unmerged commit now lives on `feat/nix-darwin` |

All of these are pushed to `origin`. The `backup/*` refs must not be deleted until the
migration is confirmed good in day-to-day use.

## Local git configuration

Set globally during the migration:

```bash
git config --global rerere.enabled true       # replay previously-resolved conflicts
git config --global rerere.autoUpdate true
git config --global rebase.updateRefs true    # keep dependent branches in sync
git config --global rebase.autosquash true    # honour fixup! commits
```

Repo-level:

```bash
git config branch.main.pushRemote origin
git config push.default current
```
