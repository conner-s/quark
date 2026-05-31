# Quark — A CLI-Styled Matrix Client

## Verification queue — 0.13.3 search + raw-messages live timeline + instant re-open

Branch `feature/search-implementation`. Message **search** runs through the matrix-sdk event cache (`RoomEventCache::pagination().run_backwards`), which persists decrypted events to the SQLite cache so re-running a search is fast and consistent. The **live timeline** (initial open + backward scroll) loads via the raw `room.messages()` API. Fixes three issues found testing 0.12.0 search: (a) the local-cache search tier was nearly empty, (b) "search back to date" returned different results on repeat runs (E2EE decryption timing), (c) historical search was slow.

**0.13.2 — room-open performance fix.** 0.13.0–0.13.1 also routed the *live timeline* through the event cache. That regressed room-open badly: matrix-sdk 0.9's `RoomEventCache` deserializes the room's **entire** persisted linked-chunk into memory on first access (no lazy/partial load), and deep searches persist tens of thousands of events into that chunk — so first-open of a heavily-searched room took **40+ seconds** (measured: 50,128 cached events → 48s, dominated by `room.event_cache().await` itself). Fix: `open_room_timeline`/`load_older_timeline` now use raw `room.messages()` (transient, bounded, does **not** persist), with a per-room `prev_batch` token tracked server-side in `TimelineTokens`. The event cache is touched only by search now, so room-open cost is independent of cache size. `pnpm test` green (468); `cargo test` green.

**0.13.3 — instant re-open (frontend cache).** With the live timeline on `room.messages()`, *every* open (re-opens included) paid a homeserver round-trip — profiled at a steady **~2.2–2.6s per open**, consistent per-server, so it's network/server latency, not local work (`aggregate` was ~9ms). Fix is a per-room frontend cache (`_roomTimelineCache`, capped at 200 events): `selectRoom` paints the cached tail **synchronously** on revisit (skips the skeleton) and runs the authoritative `openRoomTimeline` in the background, re-rendering only if the head changed (no flicker, scroll preserved). The sync stream appends new messages to every already-cached room's tail so revisits aren't stale. Initial fetch trimmed 100 → 50 events to shave the unavoidable first-ever open. **Images:** message media now has an in-memory blob-URL cache (`_messageMediaCache`, mirroring avatars) — previously every render re-fetched + re-decoded media over IPC (~1s even on a disk-cache hit); now `timelineEventToMessage` pre-fills the cached blob URL so revisited images paint with the text, and downloads kick off at paint time instead of after the background fetch. Only the *first* open of a room in a session still hits the network (~1.5–2s, homeserver-bound); a prefetch-on-room-list-load step could remove that too if wanted.

### Backend
- [x] **`search_messages` on the event cache** — scans already-cached events first (instant, offline), then `run_backwards` (BATCH_SIZE 300) persisting each batch; stop decision extracted to the unit-tested `search_should_break`. Re-running a search is now fast and consistent.
- [x] **Raw-messages live timeline** — `open_room_timeline` (fetches the most recent page) and `load_older_timeline` (resumes from the stored token) call raw `room.messages()`; the `prev_batch` token is held server-side per room in `TimelineTokens` (so the IPC keeps the token-free `CachedTimelinePage { events, reached_start }` shape). `room.messages()` is transient and decrypts fresh on every fetch — it never persists into the event cache, so room-open cost doesn't scale with how much search has cached. Reaction aggregation extracted to `aggregate_chunk` (shared by `get_timeline`/`paginate_forward`/the open/load fns), aggregating over the batch so same-batch reactions attach.
- **Constraint:** the 0.9 event cache has no forward pagination / context-jump API, so `paginate_forward` + `get_event_context` (context view) stay on raw `room.messages()` too. The live and context-view backward paths are mutually exclusive via `inContextView`.

### Frontend
- [x] `selectRoom` opens via `openRoomTimeline`; `loadMoreMessages` branches on `inContextView` (context view keeps the raw `getTimeline`/`prevBatch` path; live uses `loadOlderTimeline`/`reachedStart`); `jumpToLatest` returns to the cache-backed live timeline.
- [x] **Search input guards** — min query length (3), debounced live loaded-tier (~180ms), and a 200-row render cap (counts stay exact). Stops the lag spike from 1–2 char queries matching a huge fraction of the now-large cached buffer.
- [x] **Results sort dropdown** — right end of the scope row; Newest-first (default, reset on each open) / Oldest-first. Results held in an array and re-rendered sorted+capped (streaming hits re-sort as they arrive, throttled).
- [x] **Custom `DatePicker` component** ([src/ui/DatePicker.ts](src/ui/DatePicker.ts)) for "Back to date" — replaces `<input type=date>`, whose native popup on WebKitGTK is an uncontrollable modal grab (ignores blur/click/Enter; only the toolkit's Escape dismisses it). A themed DOM calendar popover, mounted on `<body>` with `position: fixed` (positioned from the trigger rect, flips/nudges to stay on-screen) so the dialog's `overflow: hidden` can't clip it. Reusable: `getElement()`/`onChange()`/`getValue()`/`setValue()`/`open/close/toggle/destroy`.
- [x] **Concurrency/UX fixes** — event-cache back-pagination (now only search) is serialized via a `PaginationLock` with cancel-first hand-off (fixes the "expected Idle, observed Paginating" error); opening a room or scrolling cancels any in-flight search. Pagination errors soft-recover with partial results. (Since the live timeline no longer paginates the cache, room-open/scroll can't collide with the paginator at all.)
- [x] **Late-key re-decryption** — the event cache stores events with their decrypt-state at sync time and (in 0.9) never retries when keys arrive later, so the initial page could stay `🔒 unable to decrypt` after verification. Two-part fix: **(A)** the live timeline loads via raw `room.messages()`, which decrypts fresh on every fetch — so a reload reflects current keys (no per-event re-decrypt pass needed); **(B)** a `room_keys_received_stream` listener emits `quark://sync/room_keys`, and the frontend reloads the displayed room (`reloadCurrentRoomTimeline`, preserves scroll, skipped in context view) so it refreshes automatically without a manual re-open.
- [x] **Sort-dropdown theming** — `appearance: none` so WebKitGTK honors the theme background (native selects paint white otherwise).

### To verify manually (needs a real account)
- [x] **Room-open is fast regardless of cache size** — opening a heavily-searched room (50k+ cached events) is now near-instant instead of 40+s (raw `room.messages()`, independent of the persisted cache).
- [ ] Scroll up repeatedly → older loads, scroll position preserved, reactions on older messages render; reaching room start stops the spinner.
- [ ] "Search back to date" **twice** → identical results; second run near-instant; local-cache tier then returns the scanned range.
- [ ] Jump-to-message context view + jump-to-latest still work; live reactions/edits/redactions still update.
- [x] **Custom date-picker calendar** — opens on the trigger, navigates year/month, picks a day, closes on select/outside-click; renders fully (not clipped) and themed (verified in the WebKitGTK dev build on NixOS/KDE, where the native `<input type=date>` was unusable).
- [x] **Sort dropdown** — Newest/Oldest flips result order; defaults to Newest each open; background matches the theme in the real app.

---

## Verification queue — 0.12.0 in-room message search

Branch `feature/search-implementation`. Adds message search: a 🔍 button in the room header (and `:search [query]`) opens a four-tier search dialog — **loaded** (instant filter of the on-screen timeline) · **local cache** (matrix-sdk event cache, offline) · **back to date** · **entire history**. The server tiers stream hits incrementally via Tauri events (`EVENT_SEARCH_HIT`/`EVENT_SEARCH_PROGRESS`) with a cancelable, bounded-memory backward scan. The event cache is enabled at startup (`event_cache().subscribe()` + `enable_storage()`). `pnpm test` green (469).

### Backend
- [x] `search_room_cache` (tier 2, reads the event cache) + `search_room_messages` (tiers 3/4, streaming) + `cancel_room_search`; `SearchState(AtomicBool)` cancel flag; `event_matches` skips undecryptable events.

### Frontend
- [x] `RoomHeader` 🔍 button (`setSearchHandler`) opens `SearchDialog` (extends `DialogBase`); scope control styled as a tab bar; results highlight the matched substring and click-to-jump via `jumpToMessage`; `Timeline.searchLoaded` powers the instant tier; `:search` registered in `vim/commands.ts`.

> Superseded by 0.13.0, which re-routed these tiers (and the timeline) through the event cache to fix coverage/consistency/speed issues found here.

---

## Verification queue — 0.11.2 bug patch batch

Branch `v0.11.2`. Four bug fixes (#59, #60, #61, #63) plus a small timeline-load tweak. `pnpm test` green (460); `cargo test` green (190).

### Cross-platform
- [x] **#61 Image captions** — an `m.image` message with a media caption (MSC2530: a `body` distinct from its `filename`) now renders the caption beneath the image. Bare-filename bodies are still suppressed, so uncaptioned images are unchanged. *Rust surfaces `image.caption()` as a new `TimelineEvent.caption`; `Timeline` renders it as `.message__image-caption`.*
- [x] **#60 Sticker aspect ratio** — non-square stickers no longer stretch in the timeline. *`.message__sticker` lacked `object-fit: contain` (the image and thread-inline rules already had it), so the bitmap filled the attribute-reserved box instead of letterboxing into it.*
- [x] **#59 Double message render** — sending a message whose sync echo beats the send-IPC response no longer leaves a permanent duplicate. *Race: while the optimistic node still carried its `optimistic-…` ID, all three sync-path dedup checks missed, so the echo was appended; `confirmMessage` then renamed the optimistic node to the same event ID. It now drops the optimistic node when the echo already rendered the event.*
- [x] **#63 Duplicate OS notifications** — a single message could raise ~20 system notifications. *The matrix-sdk message handler had no per-event dedup, so any re-delivery (the sync loop retries after a transient error and replays events from before the sync token advanced) fired another notification. Added a bounded event-ID set (`claim_notification`) so each event notifies once. Also hardened the frontend: `startSync` now tears down its prior listeners before re-registering, instead of orphaning them on a second call (logout→login), which would otherwise double every sync handler.*

### Performance
- [x] **Timeline media loads in parallel with member fetch** — image / reaction-emoji / inline-emoji downloads depend only on the (already-fetched) timeline events, but were gated behind `await getRoomMembers(...)`. Moved ahead of the member round-trip so images start loading immediately after the timeline renders. (Larger wins — virtual scrolling, IPC payload size — are out of scope for a patch.)

---

## Verification queue — 0.11.0 compose / media / mobile feature batch

Branch `feature/compose-media-mobile-release`. Six features: #35, #44, #48, #50, #54, #45. `pnpm test` green (452). Mobile items need a fresh iOS/Android build to verify.

### Compose — cross-platform
- [x] **#54 Rich text formatting** — markdown in the compose box compiles to `org.matrix.custom.html` on send: `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `||spoiler||`, `` `code` ``. Desktop: Ctrl/Cmd+B/I/U and Ctrl/Cmd+Shift+X wrap the selection. Mobile: a formatting toolbar above the compose box wraps the selection. *New `markdown.ts` (tested); the formatted-body builder delegates to it.*
- [x] **#45 Full compose Normal mode** — leave Insert with content in the box (Esc) → vim editing of the textarea: motions `w/b/e/0/^/$/h/l/j/k` with counts, operators `d/c/y` (+ `dd/cc/yy`, `D/C/Y`), `x`, `r`, insert-entry `i/a/A/I/o/O`, internal register `p/P`. `v` still enters Visual select. *New `compose_normal.ts` (tested); routed ahead of the read-only text-select handler.*
    - [x] **Compose vim now follows nav rebinds** — the editor was driven by raw keys, bypassing the keymap, so quarkrc nav remaps (e.g. the documented ijkl scheme) never reached it. `keyboard.ts` now translates each physical key through `keymapManager.actionForKey()` (a new non-buffering single-key lookup) into the canonical motion key before the editor sees it. Only nav actions are rebindable today — operators/word-motions have no keymap action — so those pass through literally.

### Media — cross-platform
- [x] **#35 Video embeds** — pick a video via the attach button → sent as `m.video` (not `m.file`) so it renders as a playable embed; dimensions/duration are probed client-side for correct aspect ratio. *New `send_video` command + `timeline::send_video`.*
- [x] **#48 Upload spinner** — sending an image/video/file shows a persistent braille spinner that resolves to ✓/error (matrix-sdk 0.9 has no byte-level progress). *New `showProgressToast()`.*

### Emoji — cross-platform
- [x] **#44 Full emoji set** — the picker shows the full Unicode set (1914 emoji, 9 categories) with keyword search, not the old 184-item curated list. *Generated from emojibase-data via `pnpm gen:emoji`; glyphs are fully-qualified (U+FE0F).* Verify reactions still aggregate with other clients.
    - [x] **Picker spacing loosened** — the 184-item layout used a tight `gap: 2px` with zero cell padding, which felt cramped once the full set filled the grid. Bumped to `gap: 6px`, grid padding `8px`, and `3px` cell padding in `base.css`.

### Mobile (needs build)
- [x] **#50 Drag-to-open drawer** — a horizontal drag from anywhere pulls the room-list drawer along with the finger and snaps open/closed on release by travel + velocity (Discord-style), replacing the edge-only canned slide. Pull-down-for-command-palette still works.
- [x] **#44 emoji grid perf** — open the picker on a phone; category switching and search stay smooth across the full set.
- [~] **#54 mobile toolbar** — *punted.* The custom HTML formatting toolbar has been **removed**; mobile users format by typing markdown, desktop keeps the Ctrl/Cmd shortcuts. Surfacing real B/I/U/strike/spoiler items in the native OS long-press menu (the desired behaviour) isn't reachable from web JS — it needs native `UIEditMenuInteraction` (iOS) + Android `ActionMode.Callback` work plus a selection bridge. Tracked as a future native task.

---

## Verification queue — 0.9.1 consistency + patch batch

Branch `v0.9.1`. A consistency pass (every vim feature reachable by mouse/touch; every overlay dismissable via UI, Esc, **and** Ctrl+[) plus patch fixes for #33/#40/#43/#45/#49/#52/#53. `pnpm test` green (319). Mobile items need a fresh iOS/Android build to verify.

### Consistency pass — cross-platform
- [x] **Overlay dismissal via Ctrl+[** — open each and confirm Ctrl+[ closes it (the vim twin of Esc), matching Esc and the close button: GIF picker, device picker, command bar, reply preview, mention/shortcode autocomplete, image lightbox, verification dialog. *Fix: these handled Esc but not Ctrl+[, and the global keydown handler early-returns while they're visible, so each must handle it itself.*
- [x] **Help reachable by mouse** — Settings → General → **[keybindings & help]** opens the help/keybindings screen. *Previously only `?` / `:help`.*
- [x] **GIF button** — a **GIF** button sits beside 🙂 in the compose bar and opens the GIF picker. *Previously Ctrl+G only.*
    - [x] **GIF button now follows the theme** — it inherited the icon buttons' `opacity: 0.5`, which reads fine on a coloured glyph but washed out the "GIF" text label. It now takes its colour from the theme (`--accent-secondary` text + `--border-color` badge, full opacity; inverts to accent-on-bg on hover).

### Mobile (needs build)
- [x] **Command palette (pull-down)** — open the room-list drawer and pull down from the top of the list → the command palette (`:`) opens and focuses. Only fires when the list is scrolled to the top. *Command mode was keyboard-only and unreachable by touch; desktop still uses `:`.*
- [x] **#52 Start in room list** — a fresh launch on mobile lands on the room list (drawer open), not an empty timeline. Selecting a room closes the drawer.
- [x] **#49 Re-tap current room closes drawer** — with a room open, open the drawer and tap that same room: the drawer dismisses. *Re-selecting didn't change `currentRoomId`, so the close-on-change listener never fired; `selectRoom` now closes the drawer directly.*
- [x] **#40 iOS autocorrect (follow-up to 0.9.0)** — compose field shows QuickType suggestions, sentence-casing, and spellcheck on iOS. *0.9.0 enabled the assist attributes but left `autocomplete="off"`, which suppresses QuickType on WKWebView; `autocomplete` is now toggled with the others (on for mobile, off on desktop).*
- [ ] **#33/#43 First-login room list** — fresh install, log in: the list populates without a relaunch even on a slow first sync. *Poll window extended from ~8s to ~30s with backoff, and it now also runs on session restore.*

### Cross-platform
- [x] **#53 Selection contrast** — select message text under each built-in theme; the highlight is clearly visible and the text readable. *`::selection` now uses `--accent-primary` with the page `--bg` as text, instead of the near-invisible per-theme `selection_bg`. Vim text-select rules override it locally and are unaffected.*
- [x] **#45 Shift+Enter newline** — in the compose box, Shift+Enter inserts a newline; Enter still sends. The box auto-grows with content up to ~6 lines, then scrolls. *Compose field is now a `<textarea>` (was an `<input>`); watch the send-fly animation and vim visual-select on the compose field.*

---

## Verification queue — 0.9.0 mobile/formatting batch

Branch `fix/mobile-formatting-issues`. Covers issues #34, #37, #38, #40, #42. iOS needs a fresh install to pick up the new Info.plist permission keys.

### Cross-platform
- [x] **#42 Spoiler text** — receive (or send from another client) a message containing a spoiler (`<span data-mx-spoiler>`). Confirm it renders blurred/blacked-out and reveals on click (desktop) or tap (mobile). A spoiler with a reason shows the reason as a tooltip. *Fix: `data-mx-spoiler` already survived into the DOM but had no styling/handler — added `setupSpoilers()` in Timeline + `.message__spoiler` CSS.*
- [x] **#37 Edit/Delete in context menu** — right-click (desktop) or long-press (mobile) one of **your own** messages: the menu now shows **Edit** and **Delete** below the standard actions. Messages from others show neither. *Same callback feeds desktop + mobile, so this also resolves #34.*
- [x] **#34 Long-hold delete on mobile** — long-press your own message → bottom sheet includes **Delete** (and **Edit**). Resolved together with #37.

### iOS (needs reinstall)
- [x] **#38 Camera crash** — tap 📎 attach, choose "Take Photo". Camera opens instead of crashing the app. *Fix: added `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` / `NSPhotoLibraryUsageDescription` to `gen/apple/quark_iOS/Info.plist` — accessing the camera without the usage-description key is a hard crash on iOS.*
- [x] **#40 Autocorrect** — focus the compose field, type a misspelled / lowercase-first sentence. The soft keyboard now autocorrects, sentence-capitalises, and shows spellcheck. *Fix: the field hard-disabled `autocorrect`/`autocapitalize`/`spellcheck`; now enabled on mobile (where vim is off anyway), still off on desktop for the terminal feel.*

---

## Verification queue — 0.8.x mobile batch

Branch `fix/mobile-issues-25-33`. 0.8.2 needs a fresh iPhone install (re-run `xcrun devicectl`); Android still needs `make android-build` + sideload to verify. Delete this section once everything's confirmed.

### iOS (needs reinstall for 0.8.2)
- [x] **#17 Link tap** — open a message with an http(s) link, tap it, confirm Safari opens. *0.8.2 fix: shell plugin's iOS Swift handler does `parseArgs(String)` but the standard JS wrapper sends `{path, with}` — silently failed to decode. Now routed through a Rust `open_external_url` command that calls `Shell::open` directly (which serializes the URL as a raw string for the mobile plugin to parse).*
- [x] **#26 Long-press menu** — long-press a message, confirm bottom-sheet appears with Reply / React / Thread / Copy / View raw.
- [x] **#28 Members button** — `@` button on right of top bar opens member list overlay.
- [x] **#29 Profile edit** — tap avatar at bottom of space strip, tap `[edit profile]`, confirm: status field pre-fills, dialog appears at centre without jumping, save persists across relaunch.
    - [x] **Status on profile view wraps long text** — 0.8.2 added `min-width: 0` so a long status doesn't overflow the dialog, but paired it with `overflow-wrap: anywhere` + `word-break: break-word`, which split ordinary status text mid-word. Switched to `overflow-wrap: break-word` + `word-break: normal`: wraps on word boundaries, only breaking inside a single unbreakable token (e.g. a long URL).
- [x] Member-list overlay has an opaque background (no timeline bleeding through).
- [x] Drawer slide-out: edge-swipe from left ~32px feels responsive.
- [x] Drawer drop-shadow only blooms when drawer is open.
- [x] **Image viewer touch (0.8.4)** — open an image. Pinch to zoom (stays anchored under the fingers), drag with one finger to pan, double-tap to toggle fit ↔ 2.5×. Confirm the zoom +/- / 1:1 buttons are gone but `⬇ download` and `✕ close` remain. Tap the backdrop to close.

### Android (needs build)
Run `make android-build` then sideload. All of the above iOS items apply, plus:
- [x] **#27 OS notifications** — on first launch after install, accept POST_NOTIFICATIONS prompt. Background the app and have someone message you in an unmuted room. Verify the notification fires. (Settings → Notifications → `[test notification]` is a quicker round-trip.)
- [x] **#30 Theme save** — Settings → Themes → pick a different theme. Confirm no "error" toast and the theme persists across relaunch. *Used to fail because `directories::ProjectDirs` returns None on Android.*
- [x] **#31 Back button** — with an overlay open, back closes it. With drawer open, back closes drawer. With nothing open, back **opens** the drawer (per the issue's request — confirm this matches your intent; if it should exit instead, say the word and I'll flip it).
- [x] **#32 Edge swipe** — confirm easier than 0.7.0 but doesn't fight the system back-gesture.
- [x] **#33 Login flow** — fresh install, log in, confirm the room list populates within ~8s without needing to relaunch.

### Desktop (macOS — verified login works)
- [x] Settings file is still at `~/Library/Application Support/quark/config.toml` (not the temporary `zone.derg.quark/quark/` from 0.8.0).
- [x] Media cache still at `~/Library/Caches/quark/media_cache/` — confirm cached avatars persist across relaunch.
- [x] Browser-style back-button gesture (mouse 4/5, trackpad swipe): closes overlays via popstate. If this was a no-op before and now feels weird, file it.
- [x] Profile button at bottom of space strip (now **below** the settings cog as of 0.8.2) opens the profile dialog with `[edit profile]` visible. Bottom margin bumped to 12px so the avatar isn't crammed against the status bar.
- [x] `Thread` entry in the right-click message context menu works.
- [x] **Image viewer pan bounds (0.8.4)** — open an image, zoom in past fit, drag hard in every direction. The image can no longer be flung off-screen; an edge always stops at the viewport centre. Zoom back out and confirm it re-centres.
- [x] All existing tests still passing: `pnpm test` (currently 317).

### Cross-platform regression watch
- [x] First-login `_pollUntilRoomsLoaded` runs everywhere now; should be invisible on desktop. Watch for unnecessary re-renders or flicker.
- [x] Context menu now also listens to `touchstart` for outside-dismiss — touchscreen laptops on desktop might dismiss menus on touches that previously didn't.
- [x] `ProfileDialog.show()` rewrote DM/edit button visibility independently. Sanity check that the dialog for *other* users (sender of a message, member-list focus) still hides the edit button and shows the message button.

---

## Overview

Quark is a keyboard-driven, CLI-aesthetic Matrix client that renders in a GUI window (not a raw terminal) to support inline images, custom emoji, and stickers. It uses vim-style navigation throughout and offers deep theme customization.

---

## Architecture

### Stack: Tauri v2 + matrix-sdk (Rust) + Web Frontend

```
┌─────────────────────────────────────┐
│        Web Frontend (TypeScript)    │
│   Monospace / terminal-styled UI    │
│   Renders HTML, images, emoji       │
├─────────────────────────────────────┤
│          Tauri v2 IPC Bridge        │
├─────────────────────────────────────┤
│         Rust Backend (Core)         │
│   matrix-sdk  ·  Vodozemac E2EE     │
│   Sliding Sync  ·  Media cache      │
└─────────────────────────────────────┘
```

**Why Tauri over Electron?** ~10x smaller binary, ~3-5x less RAM. The Rust backend uses `matrix-sdk` directly — the same SDK powering Element X — giving us best-in-class E2EE, Sliding Sync, and protocol coverage without FFI wrappers.

**Why not a real TUI?** Inline custom emoji (`<img data-mx-emoticon>`) and stickers require rendering images inline with text flow. Terminal image protocols (Sixel/Kitty) can't do this reliably across terminals. The CLI aesthetic is achieved purely through CSS (monospace fonts, dark background, prompt-style input).

### Backend (Rust)

The backend handles all Matrix protocol interaction and exposes commands to the frontend via Tauri's IPC.

**Crates:**
- `matrix-sdk` — client, sync, room operations, E2EE (Vodozemac), Sliding Sync
- `matrix-sdk-crypto` — cross-signing, key backup, device verification
- `tauri` — windowing, IPC, system tray, file dialogs
- `serde` / `serde_json` — serialization
- `tokio` — async runtime
- `directories` — XDG-compliant config/data paths

**Responsibilities:**
- Login (OIDC via MAS + legacy password fallback)
- Sliding Sync room list management & subscriptions
- Sending/receiving messages, reactions, edits, redactions
- E2EE: device verification (SAS emoji, QR), key backup, cross-signing
- Media download/upload with authenticated media (MSC3916)
- Custom emoji/sticker pack resolution (MSC2545)
- Theme file loading and validation
- Local encrypted database (sled or SQLite via matrix-sdk store)

### Frontend (TypeScript)

A single-page app styled as a terminal interface. No framework required initially — vanilla TS + a lightweight reactive layer (Preact or Solid) if needed.

**Responsibilities:**
- Rendering the message timeline (text, images, replies, threads, reactions, custom emoji, stickers)
- Vim-mode input handling and command bar
- Emoji/sticker picker (keyboard-navigable)
- Theme application from user config
- Room list, member list, space hierarchy display

---

## UI Design

### Layout

```
┌────┬───────────┬──────────────────────────────┐
│    │           │ #general · 42 members         │
│ S  │  Rooms    ├──────────────────────────────┤
│ P  │           │                               │
│ A  │  #general │ <alice> hey check this out    │
│ C  │  #dev     │ <alice> :custom_emoji:  ← img │
│ E  │  #random  │ <bob> ┊ replying to alice     │
│ S  │  #off-top │ <bob> ┊ nice!                 │
│    │           │ <carol> [sticker: partyblob]  │
│ 🌐 │  ──────── │ ─── reactions: 🎉 3  :cool: 2 │
│ 🎮 │  DMs      │                               │
│ 🏠 │  @friend  │ :> I love :parti|             │
│    │           │ ┌────────────────┐            │
│    │           │ │ 🎉 :partyblob: │ ← preview  │
│    │           │ │ 🥳 :partytime: │            │
│    │           │ └────────────────┘            │
└────┴───────────┴──────────────────────────────┘
```

All panels, borders, and text use monospace rendering. Colors, borders, and glyph styles are controlled by themes.

### Spaces (Cinny-Style)

The room list has a two-column layout inspired by Cinny:

**Left strip — Space selector:**
- Narrow vertical strip showing space icons (avatar images or first-letter fallback)
- A "Home" icon at the top for rooms not in any space, and a "DMs" icon
- Spaces display their avatar/icon; this is the only place icons appear in the room list
- `j/k` (or rebound keys) to navigate spaces, `Enter` to select
- Selecting a space filters the room list to show only that space's children

**Right column — Room list (text only, no icons):**
- Rooms listed by name in a **fixed, deterministic order** (not sorted by activity):
  - Order follows the `m.space.child` state event `order` field if set
  - Fallback: alphabetical by room name
  - User can pin rooms to top via `:pin` command
- No room avatars or icons — text only, matching the CLI aesthetic
- Unread indicators via color (theme-configurable) and optional badge count
- Nested spaces shown as indented sections with collapsible headers
- Categories/sections within a space rendered as visual dividers (using `m.space.child` ordering)

This mirrors Cinny's approach: spaces have visual identity through icons, but the channel list itself is clean text in a stable order, so rooms don't jump around based on activity.

### Vim-Style Navigation

**Modes:**
- **Normal** — navigate rooms, scroll messages, select items
- **Insert** — compose messages in the input bar
- **Command** — `:` prefix for client commands
- **Visual** — select text/messages for quoting or copying

**Key bindings (defaults, all rebindable via quarkrc — see below):**

| Context       | Key           | Action                        |
|---------------|---------------|-------------------------------|
| Global        | `i`           | Enter insert mode             |
| Global        | `Esc`         | Return to normal mode         |
| Global        | `:`           | Open command bar              |
| Room list     | `j/k`         | Move down/up                  |
| Room list     | `Enter`       | Open room                     |
| Room list     | `/`           | Search/filter rooms           |
| Room list     | `gs`          | Go to spaces view             |
| Timeline      | `j/k`         | Scroll down/up                |
| Timeline      | `g/G`         | Jump to top/bottom            |
| Timeline      | `r`           | Reply to selected message     |
| Timeline      | `e`           | React to selected message     |
| Timeline      | `t`           | Open/enter thread             |
| Timeline      | `dd`          | Redact own message            |
| Timeline      | `E` / `c`     | Edit own message              |
| Insert        | `Ctrl-e`      | Open emoji/sticker picker     |
| Insert        | `Ctrl-g`      | Open GIF search               |
| Insert        | `Tab`         | Autocomplete :shortcode:      |
| Picker        | `j/k/h/l`     | Navigate grid                 |
| Picker        | `Enter`       | Select emoji/sticker/GIF      |
| Picker        | `/`           | Search within picker          |
| Picker        | `Tab`         | Switch emoji ↔ sticker ↔ GIF  |

### Keybinding Configuration (quarkrc)

Keybindings are configured via `~/.config/quark/quarkrc`, using a vimrc-inspired syntax. This file is sourced on startup and on `:source` command.

```vim
" ~/.config/quark/quarkrc

" Remap navigation to ijkl (scandalous but valid)
nmap i     mode-insert
nmap j     nav-left
nmap k     nav-down
nmap l     nav-up        " yes, really
nmap ;     nav-right

" Context-scoped mappings
tmap k     scroll-down          " timeline: scroll down
tmap l     scroll-up            " timeline: scroll up
rmap k     room-next            " room list: next room
rmap l     room-prev            " room list: prev room
pmap k     picker-down          " picker: move down
pmap l     picker-up            " picker: move up
pmap j     picker-left          " picker: move left
pmap ;     picker-right         " picker: move right

" Multi-key sequences
nmap gg    jump-top
nmap G     jump-bottom
nmap dd    redact

" Leader key (default: space)
let mapleader = " "
nmap <leader>e  emoji-picker
nmap <leader>g  gif-search
nmap <leader>s  sticker-picker
nmap <leader>t  thread-open
nmap <leader>v  verify-device

" Unmap a default binding
nunmap gs

" Set options (like :set in vim)
set scrolloff=5               " keep 5 messages visible above/below cursor
set shortcode_preview=true    " show emoji preview while typing :shortcode:
set gif_provider=tenor        " tenor | giphy
set gif_rating=pg             " g | pg | pg-13 | r
```

**Map command syntax:**
- `nmap` — normal mode mapping
- `imap` — insert mode mapping
- `tmap` — timeline-scoped mapping (normal mode, timeline focused)
- `rmap` — room list-scoped mapping (normal mode, room list focused)
- `pmap` — picker-scoped mapping (emoji/sticker/GIF picker)
- `cmap` — command mode mapping
- `vmap` — visual mode mapping
- `nunmap`, `iunmap`, etc. — remove a mapping
- `noremap` variants (`nnoremap`, etc.) — non-recursive mappings

Scoped maps (`tmap`, `rmap`, `pmap`) take precedence over global `nmap` when that panel is focused. This allows the same key to do different things depending on context.

**quarkrc also supports:**
- `source <path>` — include another rc file
- `colorscheme <name>` — shorthand for `:theme`
- `set <option>=<value>` — set config options inline
- `" comments` — lines starting with `"` are ignored
- `autocmd` — hooks for events (e.g., `autocmd RoomEnter * set scrolloff=3`)

### Commands

```
:join #room:server.org       Join a room
:leave                       Leave current room
:topic <text>                Set room topic
:invite @user:server.org     Invite user
:verify                      Start device verification
:upload <path>               Upload file/image
:theme <name>                Switch theme
:keys                        Show/edit keybindings
:stickers                    Browse sticker packs
:emoji                       Manage emoji packs
:gif <query>                 Search and send a GIF
:search [query]              Search messages in the current room
:source <path>               Reload quarkrc or source a file
:roomsettings                Open room settings (name/topic/access/permissions)
:spacesettings               Open space settings (name/topic/children)
:debug                       Open debug viewer for current room state events
:debug $eventId              Open debug viewer for a specific event
:version                     Show the current app version
```

---

## Matrix Feature Support

### Core Protocol
- [x] Login: OIDC (MAS) + legacy password + SSO
- [x] Sliding Sync (MSC4186) — native, no proxy
- [x] E2EE: Megolm via Vodozemac, cross-signing, key backup (SSSS)
- [x] Device verification: SAS emoji, QR code
- [x] Room creation, join, leave, invite, kick, ban
- [x] Room directory & federated room search
- [x] In-room message search — header search box (`:search`) with four tiers: loaded window (instant) · local cache (matrix-sdk event cache, offline) · back-to-date · entire history. Server tiers stream results one page at a time (bounded memory) and are cancelable.
- [x] Spaces: hierarchy display, space-scoped room lists, restricted joins
- [x] Threads (m.thread relation)
- [x] Rich replies (m.in_reply_to)
- [x] Reactions (m.annotation) — Unicode + custom emoji
- [x] Message editing & redaction
- [x] Read receipts (public m.read + private m.read.private)
- [x] Typing indicators
- [x] Presence (when homeserver enables it)
- [x] Authenticated media (MSC3916)
- [x] Room summary previews (MSC3266)

### Custom Emoji & Stickers (MSC2545 — im.ponies)

Full compatibility with Cinny, FluffyChat, Nheko, and SchildiChat.

**Pack sources:**
- `im.ponies.room_emotes` — room state events (per-room packs)
- `im.ponies.user_emotes` — account data (personal packs)
- Packs distinguish emoji (`usage: ["emoticon"]`) from stickers (`usage: ["sticker"]`)

**Sending custom emoji in messages:**
- User types `:shortcode:` → autocomplete resolves from available packs
- Sent as `formatted_body` HTML: `<img data-mx-emoticon height="32" src="mxc://..." alt=":shortcode:" title=":shortcode:" />`
- Plain `body` contains `:shortcode:` as fallback
- Format field: `org.matrix.custom.html`

**Sending stickers:**
- Sticker picker (keyboard-navigable grid) sourced from packs with `usage: ["sticker"]`
- Sent as `m.sticker` event with `url` (mxc://), `body`, and `info` (mimetype, dimensions, thumbnail)
- Rendered in timeline at larger size than emoji, standalone (not inline with text)

**Custom emoji in reactions:**
- Reaction key is `:shortcode:`
- Client resolves the mxc:// URL from loaded packs for display
- Falls back to text `:shortcode:` if pack not available

**Custom emoji in replies:**
- Reply preview renders custom emoji images inline
- `<mx-reply>` fallback contains `:shortcode:` text

**Pack management UI:**
- View available packs (room + personal)
- Create/edit personal packs (set state on account data)
- Create/edit room packs (if user has state event permissions)
- Import packs from other rooms

### GIF Search

Discord-style integrated GIF search, accessible from insert mode or command bar.

**Providers (configurable in quarkrc):**
- Tenor (default) — `set gif_provider=tenor`
- Giphy — `set gif_provider=giphy`
- Klipy — `set gif_provider=klipy`
- Content rating filter: `set gif_rating=pg` (g / pg / pg-13 / r)

**UX flow:**
1. User presses `Ctrl-g` (insert mode) or runs `:gif <query>`
2. A search overlay appears with a text input and a grid of GIF thumbnails
3. Thumbnails are animated previews (low-res for performance)
4. Navigate grid with `j/k/h/l`, search with `/`, send with `Enter`
5. `Tab` to load more results, `Esc` to dismiss
6. Selected GIF is uploaded to the homeserver as media and sent as an `m.image` event with `info.mimetype: "image/gif"` — this avoids linking to external URLs that may break or track users

**Backend:**
- Rust backend handles API calls to Tenor/Giphy/Klipy (API keys stored in config)
- Downloads selected GIF, uploads to homeserver via media API
- Caches recent search results and thumbnails locally

### Emoji Shortcode Preview

When the user types `:` followed by characters in insert mode, an inline autocomplete popup appears:

```
:> I think this is :aweso|
  ┌──────────────────────────┐
  │ 😎  :awesome:            │  ← Unicode emoji
  │ [img] :awesome_face:     │  ← Custom emoji (shows image)
  │ 🌟  :awesome_star:       │
  └──────────────────────────┘
```

- Each row shows the emoji **image or glyph** alongside the `:shortcode:`
- Custom emoji display their actual `mxc://` image thumbnail (small, inline)
- Unicode emoji display the native glyph
- List updates as user types, fuzzy-matched against all available packs
- `Tab` / arrow keys to select, `Enter` to insert, `Esc` to dismiss
- Triggered after `shortcode_min_chars` characters (default: 2, configurable via `set shortcode_min_chars=2` in quarkrc)
- Sources: Unicode emoji database + `im.ponies.user_emotes` + `im.ponies.room_emotes` from current room

### Media Handling
- Authenticated media download via `/_matrix/client/v1/media/download/`
- Inline image previews in timeline (configurable max dimensions)
- Sticker rendering (larger than emoji, centered)
- Image uploads with thumbnail generation
- Blurhash placeholders during loading
- Media cache on disk with configurable size limit

### Not in Scope (v1)
- VoIP / MatrixRTC (group calls) — fundamentally incompatible with CLI aesthetic
- Widgets — no iframe support in terminal-styled UI
- Mobile targets — Tauri v2 supports them, but defer to future

---

## Theming

Themes are TOML files stored in `~/.config/quark/themes/`. The active theme is set in `~/.config/quark/config.toml`.

### Theme File Structure

```toml
[meta]
name = "Phosphor"
author = "user"
version = "1.0"

[colors]
background = "#0a0a0a"
foreground = "#b0b0b0"
cursor = "#00ff41"
selection_bg = "#1a3a1a"
selection_fg = "#00ff41"
border = "#333333"

[colors.accent]
primary = "#00ff41"
secondary = "#00aaff"
error = "#ff3333"
warning = "#ffaa00"
success = "#00ff41"
link = "#00aaff"

[colors.messages]
own = "#00ff41"
other = "#b0b0b0"
system = "#555555"
timestamp = "#444444"
mention_bg = "#1a1a00"
mention_fg = "#ffaa00"
reply_border = "#555555"
thread_indicator = "#00aaff"

[colors.roomlist]
active_bg = "#1a1a1a"
active_fg = "#00ff41"
unread = "#ffffff"
mention_badge = "#ff3333"
muted = "#444444"

[colors.reactions]
background = "#1a1a1a"
border = "#333333"
own_bg = "#1a3a1a"
count = "#888888"

[typography]
font_family = "JetBrains Mono, Fira Code, monospace"
font_size = 14
line_height = 1.5
message_spacing = 4           # px between messages

[borders]
style = "single"              # single | double | rounded | ascii | none
room_list_width = "25%"

[emoji]
size = 32                     # px, inline custom emoji height
sticker_max_size = 256        # px, max sticker dimension
reaction_size = 20            # px, emoji in reaction bar

[prompt]
symbol = ":>"                 # input prompt glyph
normal_indicator = "NOR"      # mode indicator in normal mode
insert_indicator = "INS"
command_indicator = "CMD"
visual_indicator = "VIS"
```

### Built-in Themes
- **Phosphor** — green-on-black CRT terminal
- **Amber** — amber phosphor CRT
- **Dracula** — based on Dracula color scheme
- **Nord** — based on Nord palette
- **Solarized Dark / Light**
- **Catppuccin Mocha / Latte**
- **Gruvbox Dark**
- **High Contrast** — accessibility-focused

### Theme Hot-Reloading
Themes reload on file save (watched via `notify` crate / filesystem events passed through Tauri). No restart required.

---

## Configuration

`~/.config/quark/config.toml`:

```toml
[general]
theme = "phosphor"
notifications = true
confirm_redact = true

[sync]
sliding_sync = true           # use Sliding Sync (MSC4186)
timeline_limit = 50           # initial messages to load per room

[media]
auto_load_images = true
max_image_width = 600
max_image_height = 400
sticker_max_size = 256
cache_size_mb = 500

[gif]
provider = "tenor"            # tenor | giphy
api_key = ""                  # user provides their own API key
rating = "pg"                 # g | pg | pg-13 | r
cache_results = true

[emoji]
shortcode_autocomplete = true
autocomplete_min_chars = 2    # chars before autocomplete triggers

# Keybindings are configured in ~/.config/quark/quarkrc (see Keybinding Configuration)
# NOT in this file — quarkrc uses vimrc-style syntax for full flexibility
```

---

## Project Structure

```
quark/
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs           # Tauri entry point
│   │   ├── matrix/           # Matrix client logic
│   │   │   ├── client.rs     # Login, sync, session management
│   │   │   ├── rooms.rs      # Room operations
│   │   │   ├── timeline.rs   # Message timeline handling
│   │   │   ├── threads.rs    # Thread support
│   │   │   ├── reactions.rs  # Reactions (Unicode + custom emoji)
│   │   │   ├── emoji.rs      # MSC2545 pack resolution
│   │   │   ├── stickers.rs   # Sticker pack handling & sending
│   │   │   ├── media.rs      # Authenticated media, cache
│   │   │   ├── crypto.rs     # E2EE, verification, key backup
│   │   │   └── spaces.rs     # Space hierarchy
│   │   ├── gif/              # GIF search integration
│   │   │   ├── mod.rs
│   │   │   ├── tenor.rs      # Tenor API client
│   │   │   ├── giphy.rs      # Giphy API client
│   │   │   └── klipy.rs      # Klipy API client
│   │   ├── config/           # Config & theme loading
│   │   │   ├── mod.rs
│   │   │   ├── theme.rs      # Theme parsing, validation
│   │   │   └── quarkrc.rs    # vimrc-style keybinding parser
│   │   └── commands.rs       # Tauri IPC command handlers
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                      # Web frontend
│   ├── index.html
│   ├── main.ts               # Entry point, Tauri IPC bindings
│   ├── ui/
│   │   ├── App.ts            # Root layout (room list + timeline + input)
│   │   ├── ModalManager.ts   # Open-overlay registry (replaces isVisible switchyards)
│   │   ├── DialogBase.ts     # Shared dialog chrome: overlay, header, Esc, form rows
│   │   ├── PickerBase.ts     # Shared picker overlay + keymap-driven SelectionList
│   │   ├── RoomList.ts       # Room list panel
│   │   ├── Timeline.ts       # Message rendering
│   │   ├── MessageRow.ts     # Single message (text, images, emoji)
│   │   ├── ReplyPreview.ts   # Inline reply rendering
│   │   ├── ThreadView.ts     # Thread timeline
│   │   ├── Reactions.ts      # Reaction bar
│   │   ├── Input.ts          # Compose bar with mode indicator
│   │   ├── EmojiPicker.ts    # Keyboard-navigable emoji/sticker picker
│   │   ├── StickerPicker.ts  # Sticker grid browser
│   │   ├── GifPicker.ts      # GIF search overlay
│   │   ├── ShortcodePreview.ts # Inline emoji preview popup
│   │   ├── MemberList.ts     # Room member sidebar
│   │   └── Verification.ts   # SAS/QR verification UI
│   ├── vim/
│   │   ├── mode.ts           # Mode state machine
│   │   ├── keybindings.ts    # Keymap resolution
│   │   └── commands.ts       # : command parser
│   ├── theme/
│   │   ├── loader.ts         # Apply theme from backend
│   │   └── vars.css          # CSS custom properties
│   └── style/
│       └── base.css          # Monospace terminal base styles
├── themes/                   # Built-in theme files
│   ├── phosphor.toml
│   ├── amber.toml
│   ├── dracula.toml
│   └── ...
└── README.md
```

---

## Implementation Phases

### Phase 1 — Foundation
- Tauri v2 project scaffold
- Rust backend: matrix-sdk login (password), basic sync, room list
- Frontend: terminal-styled layout, room list panel, basic timeline rendering
- Vim mode state machine (Normal / Insert) with core keybindings
- quarkrc parser (vimrc-style keybinding config)

### Phase 2 — Core Messaging
- Sliding Sync integration
- Send/receive text messages
- Rich replies (render + compose)
- Message editing & redaction
- Read receipts, typing indicators
- Basic image rendering in timeline

### Phase 3 — E2EE
- Vodozemac-backed encryption via matrix-sdk-crypto
- Cross-signing setup
- SAS emoji verification flow
- Key backup (SSSS)
- Encrypted media handling

### Phase 4 — Custom Emoji, Stickers & GIF Search
- MSC2545 pack loading (room + user account data)
- `:shortcode:` autocomplete with inline emoji preview popup
- Inline custom emoji rendering (`<img data-mx-emoticon>`)
- Custom emoji in reactions
- Custom emoji in reply previews
- Sticker picker UI (keyboard-navigable grid)
- Sending `m.sticker` events
- Sticker rendering in timeline (larger, standalone)
- Pack management (create, edit, import)
- GIF search integration (Tenor + Giphy + Klipy backends)
- GIF picker overlay with animated thumbnails
- GIF upload-to-homeserver flow (no external URL leaking)

### Phase 5 — Spaces, Threads, Polish
- Cinny-style space sidebar (icon strip + text-only room list, fixed order)
- Thread view and thread-aware navigation
- Reactions bar with aggregation
- Room directory search
- Presence display
- Notifications (system-level via Tauri)

### Phase 6 — Theming & Configuration
- Theme TOML parser + validator
- All built-in themes
- Hot-reload on theme file change
- Full keybinding customization (`keys.toml`)
- User config file support

### Phase 7 — Hardening
- Authenticated media (MSC3916)
- Private read receipts
- Room summary previews
- Media cache management
- Accessibility audit (keyboard-only, screen reader hints)
- Performance profiling (large rooms, many emoji packs)

---

## TODO (current as of 2026-03-23)

### In Progress / Partially Implemented
- [ ] **Sliding Sync (MSC4186)** — backend uses matrix-sdk default sync; Sliding Sync not explicitly configured
- [x] **Presence display** — DM room list entries show a colored presence dot (online/unavailable/offline) populated from `AppState.getUserPresence()`; dots update live via `roomList.updatePresenceForUser()` called from the presence sync handler
- [x] **GIF upload-to-homeserver** — `send_gif` command downloads GIF from external URL, uploads to homeserver, sends as `m.image`
- [x] **Custom emoji in reply previews** — `ReplyPreview.ts` exists; verify `:shortcode:` resolves to images inline

### Production

- [ ] **Website** — Static marketing/download page hosted on GitHub Pages (requires public repo).
  - Terminal-aesthetic design matching Quark's look (monospace, dark, green accents).
  - Sections: hero/tagline, feature highlights, screenshots, platform download links (pointing to GitHub Releases assets), and a brief install guide.
  - Source lives in a `docs/` folder on `main` (or a dedicated `gh-pages` branch); GitHub Pages serves it automatically.
  - No framework required — vanilla HTML/CSS. Keep it small and fast.

- [ ] **Auto-update** — `tauri-plugin-updater` against GitHub Releases (requires public repo for free Actions minutes).
  - On each tagged release, the GitHub Actions release workflow produces a `latest.json` update manifest alongside the platform installers and attaches all as release assets.
  - `tauri-plugin-updater` is configured in `tauri.conf.json` to fetch `latest.json` from the GitHub Releases CDN URL on launch.
  - The frontend shows a dismissible in-app dialog when a new version is detected ("Version X.Y.Z is available — update now / later").
  - macOS builds must be code-signed for Gatekeeper to allow the update; Linux and Windows updates work without signing but signing is recommended.
  - Add `:checkupdate` command to trigger a manual check.

- [x] **Multi-platform builds** — GitLab CI pipeline (`.gitlab-ci.yml`).
  - **Gating:** the `test` job (`pnpm test` + `cargo test`; `pnpm build` also type-checks) and the advisory `lint` job (`cargo clippy`, `allow_failure`) run on **every** pipeline — tag pushes, merge requests, and branch pushes — so regressions are caught before merge, not just at release time. The `build:*` and `release` jobs are pinned to tag pushes via per-job `rules`.
  - Jobs: `build:linux` (`.deb` + `.AppImage` + `.rpm`), `build:flatpak`, `build:windows` (`.msi` + NSIS `.exe`), `build:macos` (`.dmg` + `.app.tar.gz`), `build:android` (arm64-only `.apk` via `--target aarch64` — a universal all-ABI APK ran ~4x larger and overflowed the package-registry upload limit).
  - Each job runs `pnpm tauri build` (or `pnpm tauri android build --apk` for Android) and uploads its bundles to the project's Generic Package Registry under `quark/<tag>/quark-<tag>-<platform>.<ext>`. The `release` job creates a GitLab Release whose asset links point to those stable, externally-accessible URLs (not job-artifact URLs, which expire).
  - Secrets needed (optional): macOS notarisation — `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`; Android release signing — `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without Android keystore vars, the APK is debug-signed (installable on dev devices, not for public distribution).
  - **Android signing is done by Gradle** via the `release` `signingConfig` in `gen/android/app/build.gradle.kts`, which reads `keystore.properties` (local) or `ANDROID_KEYSTORE_PATH` + the password/alias env vars (CI). **Use one permanent keystore for every release, forever** — Android refuses to install an update whose signing certificate differs from the installed app (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` / "App not installed"), so a new/rotated key forces every user to uninstall and reinstall. The CI debug-signed fallback key is regenerated per run and is therefore never upgradeable; public builds must be release-signed. The Android job runs `apksigner verify` and fails if the APK came out unsigned.
  - Until Apple credentials are available, macOS builds can be produced unsigned (users must right-click → Open to bypass Gatekeeper).

- [ ] **Mobile (Tauri v2)** — iOS and Android targets using the existing Tauri/Rust codebase.
  - Phase 1: get a working build on **iOS** first as a proof of concept (developer is on macOS, so the Xcode toolchain is already at hand).
  - Spike in progress on branch `spike/mobile`:
    - [x] Responsive CSS: viewport-driven mobile mode hides the space strip + room list and stacks the layout to a single full-width timeline column.
    - [x] Full-screen slide-over drawer exposes the space strip + room list on mobile. Tapping the "◀ Rooms" header, selecting a room, or swiping left dismisses it. Only one mobile overlay (drawer, member list, or thread view) can be open at a time — opening any one closes the others.
    - [x] Slim mobile top bar with a hamburger button, room avatar (tap → room settings), and current room name. Desktop room-header is hidden on mobile to avoid duplicate info.
    - [x] Virtual-keyboard handling via `visualViewport` resize → `--keyboard-offset` CSS var so the compose box stays above the keyboard.
    - [x] iOS safe-area insets (`env(safe-area-inset-*)`) applied to top bar, input bar, content area, drawer panels, login screen, and full-screen overlays so the layout clears the notch and home indicator in both portrait and landscape.
    - [x] Touch gestures: edge-swipe right opens the drawer, swipe left on the drawer (or tap the backdrop) closes it.
    - [x] Vim mode auto-disabled when mobile mode activates; re-enables on resize back to desktop.
    - [x] Viewport meta hardened (`user-scalable=no`, `viewport-fit=cover`, `apple-mobile-web-app-*`) to block pinch + double-tap zoom and opt into safe-area insets.
    - [x] Root layout uses `100dvh`/`100dvw` so the timeline doesn't overflow the visible area when iOS browser chrome is showing.
    - [x] Form inputs forced to ≥16px on mobile so iOS doesn't auto-zoom on focus; ASCII login banner + divider auto-scale so they don't bleed off narrow viewports.
    - [x] `pnpm tauri ios init` generated the Xcode project at `gen/apple/quark.xcodeproj` (Tauri 2 places it at the repo root, not under `src-tauri/`). Cocoapods and `libimobiledevice` were installed automatically as part of `tauri ios init`.
    - [x] `aarch64-apple-ios-sim` and `x86_64-apple-ios` Rust targets installed via rustup.
    - [ ] **Toolchain gotcha**: Homebrew's `rust` is ahead of `~/.cargo/bin` on `PATH` and does not carry the iOS targets — only the rustup toolchain does. But the project's `Cargo.lock` is lockfile v4 (requires Rust ≥ 1.78) and the rustup default channel may be older. Either run `rustup update stable` so rustup's cargo is current, or `brew uninstall rust` and let rustup own the toolchain. Until this is resolved, `pnpm tauri ios dev` will fail at the Rust compile step.
    - [ ] Smoke test on the iOS Simulator (`pnpm tauri ios dev`) and confirm matrix-sdk's SQLite store works under iOS sandboxing.
    - [x] Long-press on a message opens the context menu (replaces hover toolbar on touch). Hover action bar hidden via CSS on mobile.
    - [x] Quick-react picker docks as a bottom sheet on mobile with finger-scrollable grid; taps outside dismiss.
    - [x] Settings dialog: tabs horizontally scrollable on mobile so all sections are reachable on narrow viewports.
    - [x] Profile dialog: full-width with stacked rows so long user IDs and homeserver names wrap.
    - [x] Links in messages keep their `href` + `target="_blank"` on mobile so iOS WebView opens them in Safari (the async shell-plugin invoke loses iOS popup-blocker eligibility).
    - [x] Edge-swipe gesture suppresses native scroll on the timeline so swiping the drawer open doesn't also scroll messages behind it. While the drawer is open, the timeline is locked from touch/scroll.
    - [x] iOS app icons composited over a black background (previously rendered as white where iOS strips alpha).
  - UI adaptations still needed beyond the spike: swipe between rooms in the timeline, pull-to-refresh, font-size adjust for high-DPI phones.
  - Android scaffolding (branch `feature/android-build`):
    - [x] `pnpm tauri android init` generated the Gradle project at `src-tauri/gen/android/` (namespace `zone.derg.quark`, `minSdk = 24`, `compileSdk = 36`, NDK 28.2.13676358).
    - [x] Rust Android targets installed: `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`.
    - [x] `matrix-sdk` and `reqwest` switched to `rustls-tls` for `target_os = "android"` only — `native-tls` pulls in `openssl-sys`, which can't cross-compile to Android without a vendored OpenSSL build. Desktop + iOS keep `native-tls` so their existing TLS behaviour is unchanged.
    - [x] Makefile targets `android-init`, `android-dev`, `android-build`, `android-build-debug` export `ANDROID_HOME`, `NDK_HOME`, and `JAVA_HOME` automatically (defaults assume the macOS Android Studio layout).
    - [x] Debug APK builds cleanly for `aarch64-linux-android`.
    - [x] **Local APK size fixed (~500MB → ~100MB)** — `make android-build` ran `pnpm tauri android build` with no `--target`, so Tauri's Gradle plugin defaulted to the `universal` flavor bundling all four ABIs (arm64-v8a, armeabi-v7a, x86, x86_64) ≈ 4x the per-ABI size. CI had already been cut back to `--target aarch64` but the Makefile was never updated. Fixed: `android-build` now builds arm64-only (matching CI); the old behaviour moved to `android-build-universal`. Also added `[profile.release]` `strip = true` + `lto = true` to `Cargo.toml` — Cargo's default release profile left the JNI `.so` unstripped and nothing in the Gradle release path re-strips it, so this also trims the CI arm64 build.
    - [x] Config persistence works on Android — routed through `app_handle.path().app_config_dir()` so `directories::ProjectDirs` returning `None` on Android no longer breaks theme/notification save.
    - [x] Hardware back button is wired: seeds a history entry on startup and uses `popstate` to close the topmost overlay, then member list, then thread, then drawer; with nothing else open, the back press toggles the drawer.
    - [x] OS notification permission (POST_NOTIFICATIONS, Android 13+) is requested on login + session-restore via the notification plugin. Settings → Notifications has a "test notification" button for verification.
    - [x] Release APKs signed by a single permanent keystore via Gradle `signingConfig` (was: per-run debug key → every version had a different signature → users couldn't upgrade in place, only uninstall+reinstall). See the Multi-platform builds section for the keystore requirement.
    - [ ] Smoke test on a physical device or emulator (`make android-dev`).
    - [ ] Confirm matrix-sdk's SQLite store works under Android scoped storage.
    - [ ] Android-specific icon set (currently the default Tauri launcher icons).
    - [ ] **Crash on launch, Android 12 only (works on newer Android)** — under investigation, no device/logcat yet. Leading suspects: (1) system WebView too old on the device (wry can't init) — have the user update Android System WebView + Chrome and retest; (2) R8 minify (`isMinifyEnabled = true`) stripping a class only hit on the API ≤32 path — test an unminified build; (3) CI builds against build-tools 34 / platform android-34 / NDK 26 while the project declares `compileSdk`/`targetSdk = 36` — align CI to the declared SDK.
  - The Rust backend requires no changes — matrix-sdk supports mobile targets.
  - iOS requires a paid Apple Developer account ($99/yr) for device builds and App Store distribution; Android requires a Google Play account ($25 one-time) for Play Store distribution.
  - Track as a separate milestone after the desktop release is stable.

### Not Yet Implemented

#### Authentication -- low priority
- [ ] OIDC login via MAS (only password auth is implemented)
- [ ] SSO login flow

#### E2EE / Crypto
- [ ] Key backup (SSSS) — no backup/restore commands exist
- [x] Cross-signing setup UI — `:cross-sign [password]` bootstraps keys; `:verify <user-id>` starts SAS with emoji polling
- [x] Undecryptable events surface as `🔒 unable to decrypt` placeholders in the timeline instead of being silently dropped, so users on a new (un-verified) device can see *that* encrypted messages exist while keys are pending

#### Media
- [x] Authenticated media (MSC3916) — matrix-sdk 0.9 routes to `/_matrix/client/v1/media/download/` automatically for Matrix 1.11+ servers; E2EE media now decrypted by passing `EncryptedFile` key material through the `download_media` IPC command
- [x] Support video — `m.video` events rendered as `<video controls>` with native playback; media downloaded via the same mxc:// pipeline as images

#### Messaging
- [ ] Room summary previews (MSC3266) — no preview fetch before joining

#### Room Discovery
- [x] Room directory browser — `:directory` command opens a searchable public room browser with j/k navigation and join button; `search_room_directory` IPC backed by matrix-sdk `public_rooms_filtered`

#### Emoji / Sticker Packs
- [ ] Pack management UI — create, edit, and import emoji/sticker packs (per-room and account data)
- [ ] Emoji list is still relatively limited. Should support all currently available emojis

#### Configuration
- [ ] Theme hot-reloading — filesystem watcher (`notify` crate) not hooked up; requires app restart to change theme

#### UI / Polish
- [x] Profile edit dialog — display name and presence status are editable via a `[edit profile]` button on the own-profile view; opened from a new avatar button at the bottom of the space strip. Avatar upload is still a TODO (needs file picker + mxc upload).
- [ ] Home UI: Friends' icons and chat bubbles float around and the user's status
  - [ ] Hides room list and member list
  - [ ] Show user's profile fixed to the left side with the ability to update status and profile picture
  - [ ] Click through to DMs
  - [ ] Replaces existing list of all unparented rooms

#### Hardening
- [ ] Accessibility audit — keyboard-only navigation, screen reader ARIA hints
- [ ] Performance profiling — large rooms (1000+ messages), many emoji packs

#### Bugs
