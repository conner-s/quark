#!/usr/bin/env bash
# Preview a fork sync without moving any ref: what upstream changed since the
# stack's base, and what every stack and branch commit does when replayed onto
# the new upstream. The replay runs in memory (merge-tree + commit-tree); the
# only side effect is a few unreachable objects that gc collects.
#
# usage: preview.sh [onto=upstream/main] [stack=integration]
set -euo pipefail

onto=${1:-upstream/main}
stack=${2:-integration}

cd "$(git rev-parse --show-toplevel)"
old=$(git merge-base "$stack" "$onto")
new=$(git rev-parse "$onto")
short() { git rev-parse --short "$1"; }

upstream_files=$(git diff --name-only "$old" "$new" | sort)

echo "# Upstream $(short "$old")..$(short "$new")"
echo
if [ "$old" = "$new" ]; then
  echo "No new upstream commits."
else
  git log --first-parent --format='%h %s' "$old..$new"
  echo
  echo "## Files changed upstream"
  git diff --stat=160 --compact-summary "$old" "$new"
fi
echo

declare -A on_stack=() subject_branches=()
branch_list=$(git for-each-ref --format='%(refname:short)' refs/heads/fix refs/heads/feat refs/heads/carry)

# A cherry-pick trailer goes stale once its branch is rebased, so fall back to
# matching commit subjects against each branch.
for b in $branch_list; do
  while IFS= read -r s; do
    subject_branches[$s]+="${subject_branches[$s]:+ }$b"
  done < <(git log --no-merges --format=%s "$(git merge-base "$b" "$onto")..$b")
done

# simulate <range-base> <tip> <onto-commit> [stack]: replay range-base..tip onto
# onto-commit one commit at a time, printing a status for each. With "stack",
# also map each commit to its source branch.
simulate() {
  local from=$1 tip=$2 cur=$3 mode=${4:-}
  local c out rc tree nc files newfiles lost overlap status landed src branches skipped=""
  declare -A eq=()
  local mark sha
  while read -r mark sha; do eq[$sha]=$mark; done < <(git cherry "$onto" "$tip" "$from")

  for c in $(git rev-list --reverse --no-merges "$from..$tip"); do
    files=$(git diff-tree --no-commit-id --name-only -r "$c" | sort)
    set +e
    out=$(git merge-tree --write-tree --name-only --no-messages --merge-base="$c^" "$cur" "$c")
    rc=$?
    set -e
    tree=${out%%$'\n'*}
    case $rc in
      0)
        if [ "$tree" = "$(git rev-parse "$cur^{tree}")" ]; then
          status=EMPTY
        else
          nc=$(git commit-tree "$tree" -p "$cur" -m preview)
          newfiles=$(git diff --name-only "$cur" "$nc" | sort)
          lost=$(comm -23 <(echo "$files") <(echo "$newfiles") | paste -sd' ')
          status=${lost:+SHRUNK (lost: $lost)}
          status=${status:-clean}
          cur=$nc
        fi ;;
      1)
        # The conflicted commit is skipped, so a later conflict may only be
        # its knock-on effect.
        status="CONFLICT ($(tail -n +2 <<<"$out" | sed '/^$/d' | sort -u | paste -sd' '))${skipped:+ after skipping $skipped}"
        skipped+="${skipped:+ }$(short "$c")" ;;
      *)
        echo "merge-tree failed on $c" >&2; exit 2 ;;
    esac
    [ "${eq[$c]:-+}" = "-" ] && landed=" landed-upstream" || landed=""
    overlap=$(comm -12 <(echo "$files") <(echo "$upstream_files") | paste -sd' ')

    if [ "$mode" = stack ]; then
      src=$(git log -1 --format=%B "$c" | sed -n 's/^(cherry picked from commit \([0-9a-f]*\))$/\1/p' | tail -1)
      branches=""
      if [ -n "$src" ] && git cat-file -e "$src^{commit}" 2>/dev/null; then
        branches=$(git branch --format='%(refname:short)' --contains "$src" --list 'fix/*' 'feat/*' 'carry/*' | paste -sd' ')
      fi
      if [ -z "$branches" ]; then
        branches=${subject_branches[$(git log -1 --format=%s "$c")]:-}
      fi
      for b in $branches; do on_stack[$b]=1; done
    fi

    echo "- $(short "$c") $(git log -1 --format=%s "$c")"
    echo "    replay: $status$landed"
    if [ -n "$overlap" ]; then echo "    upstream also touched: $overlap"; fi
    if [ "$mode" = stack ]; then echo "    branch: ${branches:-none}${src:+ (picked from $(git rev-parse --short "$src" 2>/dev/null || echo "$src"))}"; fi
  done
}

echo "# Stack: $stack ($(git rev-list --count "$old..$stack") commits on $(short "$old"))"
echo
simulate "$old" "$stack" "$new" stack
echo

echo "# Branches"
echo
for b in $branch_list; do
  if git merge-base --is-ancestor "$b" "$onto"; then
    echo "## $b: tip is in $onto (merged); delete candidate"
    continue
  fi
  mb=$(git merge-base "$b" "$onto")
  ahead=$(git rev-list --count --no-merges "$mb..$b")
  plus=$(git cherry "$onto" "$b" "$mb" | grep -c '^+' || true)
  stackmark=$([ -n "${on_stack[$b]:-}" ] && echo "on $stack" || echo "NOT on $stack")
  if [ "$plus" -eq 0 ]; then
    echo "## $b: all $ahead commits patch-equivalent in $onto (landed); delete candidate"
    continue
  fi
  echo "## $b ($ahead commits on $(short "$mb"), $stackmark)"
  if [ "$mb" = "$new" ]; then
    echo "already based on $(short "$new")"
  else
    simulate "$mb" "$b" "$new"
  fi
  echo
done
