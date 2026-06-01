#!/usr/bin/env bash
# version-bump — bump Quark's version everywhere it appears, in lockstep.
#
# The version string lives in SIX places. Editing one and forgetting the
# others (a recurring mistake — the README badge and the iOS plist in particular
# have been bumped in separate, late commits) leaves them out of sync. This
# script changes all six atomically and refuses to run if they don't already
# agree.
#
#   1. package.json                 "version": "X.Y.Z"
#   2. src-tauri/Cargo.toml          [package] version = "X.Y.Z"
#   3. src-tauri/tauri.conf.json     "version": "X.Y.Z"
#   4. README.md                     shields.io  version-X.Y.Z-<color>  badge
#   5. src-tauri/Cargo.lock          the `quark` package entry (also regenerated
#                                    by any `cargo build`, but kept in sync here
#                                    so the working tree is clean immediately)
#   6. src-tauri/gen/apple/quark_iOS/Info.plist
#                                    CFBundleShortVersionString + CFBundleVersion
#                                    (both <string>X.Y.Z</string>)
#
# Usage:   bump.sh <major|minor|patch|X.Y.Z>
#   major  1.4.2 -> 2.0.0
#   minor  1.4.2 -> 1.5.0   (new user-visible feature)
#   patch  1.4.2 -> 1.4.3   (bug fix, no new features)
#   X.Y.Z  set an explicit version
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

PKG_JSON="package.json"
CARGO_TOML="src-tauri/Cargo.toml"
CARGO_LOCK="src-tauri/Cargo.lock"
TAURI_CONF="src-tauri/tauri.conf.json"
README="README.md"
PLIST="src-tauri/gen/apple/quark_iOS/Info.plist"

die() { echo "version-bump: $*" >&2; exit 1; }

# ── Read the current version from each file (package.json is the source of truth) ──
read_pkg()   { grep -m1 '"version"' "$PKG_JSON"   | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
read_tauri() { grep -m1 '"version"' "$TAURI_CONF" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
# Cargo.toml: the version line inside the [package] section only.
read_cargo() { awk -F'"' '/^\[package\]/{p=1;next} /^\[/{p=0} p&&/^version[[:space:]]*=/{print $2; exit}' "$CARGO_TOML"; }
# Cargo.lock: the version on the line after `name = "quark"`.
read_lock()  { awk -F'"' '/^name = "quark"$/{getline; print $2; exit}' "$CARGO_LOCK"; }
# README: the shields.io version badge.
read_readme(){ grep -m1 -oE 'version-[0-9]+\.[0-9]+\.[0-9]+-' "$README" | sed -E 's/version-(.*)-/\1/'; }
# Info.plist: the <string> on the line after the CFBundleShortVersionString key.
read_plist(){ awk '/CFBundleShortVersionString/{getline; gsub(/[[:space:]]*<\/?string>/,""); print; exit}' "$PLIST"; }

CURRENT="$(read_pkg)"
[[ "$CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "could not parse current version from $PKG_JSON (got '$CURRENT')"

# ── All five must already agree, or we'd be papering over an existing drift ──
declare -A FOUND=(
  [$PKG_JSON]="$(read_pkg)"
  [$TAURI_CONF]="$(read_tauri)"
  [$CARGO_TOML]="$(read_cargo)"
  [$CARGO_LOCK]="$(read_lock)"
  [$README]="$(read_readme)"
  [$PLIST]="$(read_plist)"
)
drift=0
for f in "${!FOUND[@]}"; do
  if [[ "${FOUND[$f]}" != "$CURRENT" ]]; then
    echo "  out of sync: $f has '${FOUND[$f]}' (expected '$CURRENT')" >&2
    drift=1
  fi
done
[[ $drift -eq 0 ]] || die "files are already out of sync — reconcile to '$CURRENT' before bumping."

# ── Compute the new version ──
arg="${1:-}"
IFS=. read -r MAJ MIN PAT <<<"$CURRENT"
case "$arg" in
  major) NEW="$((MAJ + 1)).0.0" ;;
  minor) NEW="${MAJ}.$((MIN + 1)).0" ;;
  patch) NEW="${MAJ}.${MIN}.$((PAT + 1))" ;;
  [0-9]*.[0-9]*.[0-9]*)
    [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid explicit version '$arg'"
    NEW="$arg" ;;
  *) die "usage: bump.sh <major|minor|patch|X.Y.Z>" ;;
esac
[[ "$NEW" != "$CURRENT" ]] || die "new version equals current ($CURRENT); nothing to do."

echo "version-bump: $CURRENT -> $NEW"

# Escape dots so the current version matches literally, not as a regex wildcard.
CUR_RE="${CURRENT//./\\.}"

# ── Apply. Each substitution is scoped so unrelated versions stay untouched
#    (e.g. dependency versions in Cargo.toml / Cargo.lock). ──
perl -0pi -e "s/(\"version\"\\s*:\\s*\")${CUR_RE}(\")/\${1}${NEW}\${2}/"                  "$PKG_JSON"
perl -0pi -e "s/(\"version\"\\s*:\\s*\")${CUR_RE}(\")/\${1}${NEW}\${2}/"                  "$TAURI_CONF"
perl -0pi -e "s/(\\[package\\][^\\[]*?\\nversion\\s*=\\s*\")${CUR_RE}(\")/\${1}${NEW}\${2}/s" "$CARGO_TOML"
perl -0pi -e "s/(name = \"quark\"\\nversion = \")${CUR_RE}(\")/\${1}${NEW}\${2}/"        "$CARGO_LOCK"
perl -0pi -e "s/(version-)${CUR_RE}(-)/\${1}${NEW}\${2}/"                                 "$README"
# Both CFBundleShortVersionString and CFBundleVersion carry the version; the /g
# updates both. Scoped to <string>X.Y.Z</string> so other plist strings (bundle
# name, etc.) are untouched — no non-version string equals the version number.
perl -0pi -e "s/(<string>)${CUR_RE}(<\\/string>)/\${1}${NEW}\${2}/g"                       "$PLIST"

# ── Verify every file now reports the new version ──
fail=0
check() { [[ "$2" == "$NEW" ]] || { echo "  FAILED to update $1 (still '$2')" >&2; fail=1; }; }
check "$PKG_JSON"   "$(read_pkg)"
check "$TAURI_CONF" "$(read_tauri)"
check "$CARGO_TOML" "$(read_cargo)"
check "$CARGO_LOCK" "$(read_lock)"
check "$README"     "$(read_readme)"
check "$PLIST"      "$(read_plist)"
[[ $fail -eq 0 ]] || die "one or more files did not update cleanly — inspect the diff."

echo "version-bump: all six files now at $NEW"
echo
echo "Changed lines:"
grep -nH -m1 '"version"' "$PKG_JSON" "$TAURI_CONF"
grep -nH    'version-'"$NEW"'-' "$README"
awk '/^\[package\]/{p=1} p&&/^version/{print FILENAME":"FNR":"$0; exit}' "$CARGO_TOML"
awk '/^name = "quark"$/{getline; print FILENAME":"FNR":"$0; exit}' "$CARGO_LOCK"
grep -nH -m1 -A1 'CFBundleShortVersionString' "$PLIST" | grep '<string>'
