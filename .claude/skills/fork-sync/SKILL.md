---
name: fork-sync
description: Sync this fork onto upstream/main. Gives an impact readout for every fork patch (which ones upstream landed, superseded, invalidated, overlaps or conflicts with) plus a keep, drop or merge-pieces recommendation for each, then rebuilds main, the fix/*, feat/* and carry/* branches, and integration. Use when asked to sync with, rebase onto, or catch up with upstream, or to check whether upstream changes affect a patch.
---

# fork-sync

This is the sync loop from [CONTRIBUTING-FORK.md](../../../CONTRIBUTING-FORK.md#the-sync-loop) with an impact analysis run first. Read CONTRIBUTING-FORK.md and [PATCHES.md](../../../PATCHES.md) before you start.

PATCHES.md is the ledger. Each row carries a **premise**: a claim about upstream that justifies the patch, such as "upstream's `_settleTailAppend` still never calls `_renderReceipts`" or "nothing upstream runs `cargo deny`". A sync re-tests every premise. Replaying the commits is the easy part, because a patch can rebase cleanly and still be pointless or wrong.

Steps 1–3 move no ref. Step 4 rewrites history, and it runs only after the user has made a call on every block in the readout. If the user only asked whether upstream affects a patch, stop after step 3.

## 1. Preview

```bash
git status --porcelain                  # must be empty
git fetch upstream && git fetch origin
git log --oneline upstream/main..main   # must be empty: main is a pure mirror
git rev-parse integration origin/integration
.claude/skills/fork-sync/preview.sh > <scratchpad>/preview.txt
```

If the two `rev-parse` SHAs differ, stop and ask. Either someone pushed from elsewhere or there is unpushed local work, and you have to know which before rewriting anything.

[preview.sh](preview.sh) lists the upstream commits and files since `integration`'s base. It then replays every commit on `integration`, and on each local `fix/*`, `feat/*` and `carry/*` branch, onto the new `upstream/main` in memory, and prints each commit's `replay:` status:

| Status | Meaning |
| --- | --- |
| `clean` | Applies, and touches nothing upstream touched |
| `clean` + `upstream also touched:` | Applies, but shares files with upstream, so it needs semantic review |
| `landed-upstream` | `git cherry` finds a patch-equivalent commit upstream |
| `EMPTY` | Applies as no change at all: upstream already has it in some form |
| `SHRUNK (lost: …)` | Applies but drops files. This is how a rebase silently guts a commit |
| `CONFLICT (…)` | Textual conflict. The replay skips the commit, so a later `after skipping` conflict may just be a knock-on. `rerere` can still replay a recorded resolution in the real rebase, which merge-tree can't predict |

The branch sections end with housekeeping signals: `delete candidate` (the branch is in upstream) and `NOT on integration` (stale, or never folded in).

## 2. Impact analysis

Group the stack into **blocks**, one per PATCHES.md row: an upstream-bound branch, or a carried patch. The step is done when every block and every local branch has a verdict backed by evidence you can cite: an upstream SHA or PR, a file and line, or command output.

For each block:

1. **Read the upstream side.** Run `git log -p <old>..upstream/main -- <files the block touches>`. For merges that touch those files, run `gh pr view <n> -R MCPlummet/quark`, because the PR body often states intent ("replaces X", "fixes the same bug as …").
2. **Re-test the premise.** Check the claim in the row's *Why not upstreamable* column (carried) or its *Status* column (upstream-bound) against the new `upstream/main` with `git grep` or by reading the code. Do this for every block, including `clean` ones.
3. **Look past shared files.** Grep the upstream diff for the symbols the patch defines or relies on: functions, CSS custom properties, config keys, env vars, IPC command names, Nix attributes. A patch can replay cleanly onto code where upstream renamed a caller, removed the function it patches, or moved the behaviour elsewhere. That counts as invalidated even when no file is shared.
4. **Assign a verdict:**

| Verdict | When | Recommendation it usually leads to |
| --- | --- | --- |
| **keep** | Premise holds, and the replay is clean or the conflict is mechanical | Rebase as is |
| **landed** | Upstream merged our branch | Drop it from `integration`, move the row to *Landed upstream*, delete the branch |
| **superseded** | Upstream solved the same problem its own way | Drop it. If ours covers a case theirs doesn't, rework the branch down to that residual |
| **overlapping** | Both sides changed the same behaviour, and each has something worth keeping | Rework the branch to combine them. Name the piece taken from each side |
| **invalidated** | The premise is false now, or the code the patch targets moved, was renamed or is gone | Drop it, or rewrite it against the new code. Say which, and why |
| **conflicting** | Textual conflict, premise still holds | Keep. Describe the resolution you will apply |

A recommendation names hunks, functions or behaviours, for example "take upstream's `showToast` queue and keep our `AbortError` filter in `main.ts`". A line like "consider merging" is not a recommendation.

If four or more blocks show something other than plain `clean`, give each one its own general-purpose subagent and run them in parallel. Pass each agent the block's commits, its PATCHES.md row, the upstream range, and the verdict table above. Ask for a verdict, evidence, and a concrete recommendation.

## 3. Readout, then wait

Give the user the readout in this shape:

```markdown
**Upstream <old>..<new>**: <n> commits. <one theme per PR, with its number>

| Block | Branch | Replay | Verdict | Recommendation |
| --- | --- | --- | --- | --- |
| <PATCHES.md row> | <branch, or "carried"> | <preview status> | <verdict> | <one line: the concrete action and the evidence it rests on> |

### <block> (one section for every row that isn't a plain keep)
What upstream did (SHA/PR) · what ours does · evidence · recommendation

### Branch housekeeping
Branches that are merged, landed, `NOT on integration`, or missing from PATCHES.md, each with a suggested action.
```

Then stop. The user decides each block that isn't **keep**. Even when every block is **keep**, get a go-ahead before step 4.

## 4. Rebuild

1. **Recovery point.** Run `git tag sync/$(date +%F) integration`. If a tag for today already exists, add a suffix (`sync/<date>-2`).
2. **main.** Run `git branch -f main upstream/main`.
3. **Reworks first.** Work each rework or merge-pieces verdict on its own branch. Rebase that branch onto `upstream/main`, make the change as new commits, then run the standalone checks from [CONTRIBUTING-FORK.md](../../../CONTRIBUTING-FORK.md#before-opening-a-pr) on the branch alone. A carried patch with no source branch (cargo-deny, the design bundle) is reworked during step 5 with an `edit` line.
4. **Other live branches.** Run `git rebase upstream/main <branch>` for each branch with a **keep** or **conflicting** verdict. Leave landed branches untouched, so the user can delete them.
5. **integration.** Write the rebase todo yourself into `<scratchpad>/todo`, in the deliberate order: the upstream-bound blocks in PATCHES.md table order, then the carried patches, then `PATCHES.md`/`CONTRIBUTING-FORK.md`, then `CLAUDE.md` last as its own commit. In that todo:
   - Leave out the `pick` lines of dropped blocks.
   - Replace a reworked block's picks with `exec git cherry-pick -x <base>..<branch>`, so `integration` carries exactly the branch's form along with its provenance.
   - Move every commit PATCHES.md marks **out of order** into its proper place.

   Then run:

   ```bash
   GIT_SEQUENCE_EDITOR="cp <scratchpad>/todo" GIT_EDITOR=true git rebase -i upstream/main integration
   ```

   For a conflict, use the `resolving-merge-conflicts` skill, then `GIT_EDITOR=true git rebase --continue`. When `rerere` replays a resolution, read the result before you continue (CONTRIBUTING-FORK.md explains how a resolution recorded in one context goes wrong in another).

## 5. Verify

The rebuild is done when all of these hold:

- `git range-diff <old>..sync/<date> upstream/main..integration`: every pair is `=`, or `!` that you can explain by a conflict resolution or an agreed rework. Every `<` is a block the user agreed to drop, and every `>` is an agreed rework. Read the `!` hunks. This is the per-commit check for gutted commits.
- `git log --oneline upstream/main..main` is empty.
- On `integration`, `npx tsc --noEmit && pnpm test` passes. Run `pnpm install --frozen-lockfile` first if `pnpm-lock.yaml` moved. `nix develop --command bash -c 'cd src-tauri && RUSTFLAGS=-Dwarnings cargo test'` also passes. Report failures with their output. If a failure reproduces on bare `upstream/main`, it's upstream's, so say so rather than fixing it inside the sync.

## 6. Ledger and hand-off

Update PATCHES.md:

- the *Last reconciled* line: date, short SHA, and the version from `package.json`
- every boundary SHA, since they all changed
- the *Rebase onto* column header and its values
- rows that move to *Landed upstream*, *Superseded upstream* or *Retired*, each with its reason
- re-checked premises in the *Status* column
- the new `sync/<date>` tag in *Provenance*

Commit it on `integration` as `docs(fork): reconcile PATCHES.md against <short-sha>`.

Pushing is the user's job. End with a ready-to-paste block:

```bash
git push --force-with-lease origin main
git push --force-with-lease origin <each rebased branch>   # git push -u origin <b> for any not yet on origin
git push --force-with-lease origin integration
git push origin sync/<date>
```

Below it, list the branch deletions you recommend (`git branch -D <b>` and `git push origin --delete <b>`) without running them. Remind the user to fetch and reset rather than use the editor's Sync button: on a rewritten `integration`, Sync runs `git pull`, which rebases onto the stale remote.
