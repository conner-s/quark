# Quark — A CLI-Styled Matrix Client

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
| Timeline      | `E`           | Edit own message              |
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
:source <path>               Reload quarkrc or source a file
:roomsettings                Open room settings (name/topic/access/permissions)
:spacesettings               Open space settings (name/topic/children)
:debug                       Open debug viewer for current room state events
:debug $eventId              Open debug viewer for a specific event
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
- Content rating filter: `set gif_rating=pg` (g / pg / pg-13 / r)

**UX flow:**
1. User presses `Ctrl-g` (insert mode) or runs `:gif <query>`
2. A search overlay appears with a text input and a grid of GIF thumbnails
3. Thumbnails are animated previews (low-res for performance)
4. Navigate grid with `j/k/h/l`, search with `/`, send with `Enter`
5. `Tab` to load more results, `Esc` to dismiss
6. Selected GIF is uploaded to the homeserver as media and sent as an `m.image` event with `info.mimetype: "image/gif"` — this avoids linking to external URLs that may break or track users

**Backend:**
- Rust backend handles API calls to Tenor/Giphy (API keys stored in config)
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
│   │   │   └── giphy.rs      # Giphy API client
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
- GIF search integration (Tenor + Giphy backends)
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
- [ ] **Presence display** — `quark:presence` events are handled in `sync.ts` but no dedicated presence UI in the room list or member list
- [x] **GIF upload-to-homeserver** — `send_gif` command downloads GIF from external URL, uploads to homeserver, sends as `m.image`
- [x] **Custom emoji in reply previews** — `ReplyPreview.ts` exists; verify `:shortcode:` resolves to images inline

### Not Yet Implemented

#### Authentication -- low priority
- [ ] OIDC login via MAS (only password auth is implemented)
- [ ] SSO login flow

#### E2EE / Crypto
- [ ] Key backup (SSSS) — no backup/restore commands exist
- [x] Cross-signing setup UI — `:cross-sign [password]` bootstraps keys; `:verify <user-id>` starts SAS with emoji polling

#### Media
- [x] Authenticated media (MSC3916) — matrix-sdk 0.9 routes to `/_matrix/client/v1/media/download/` automatically for Matrix 1.11+ servers; E2EE media now decrypted by passing `EncryptedFile` key material through the `download_media` IPC command
- [x] Support video — `m.video` events rendered as `<video controls>` with native playback; media downloaded via the same mxc:// pipeline as images

#### Messaging
- [x] Private read receipts (`m.read.private`) — both public and private receipts now sent on `mark_room_read`
- [ ] Room summary previews (MSC3266) — no preview fetch before joining

#### Room Discovery
- [x] Room directory browser — `:directory` command opens a searchable public room browser with j/k navigation and join button; `search_room_directory` IPC backed by matrix-sdk `public_rooms_filtered`

#### Emoji / Sticker Packs
- [ ] Pack management UI — create, edit, and import emoji/sticker packs (per-room and account data)
- [ ] Emoji list is still relatively limited. Should support all currently available emojis

#### Configuration
- [ ] Theme hot-reloading — filesystem watcher (`notify` crate) not hooked up; requires app restart to change theme
- [x] `config.toml` full loading — `AppConfig` struct covers all `[general]`, `[sync]`, `[media]`, `[gif]`, `[emoji]` sections; loaded at startup via `load_app_config()`, persisted via `set_app_config` IPC; notification config persisted separately to `notifications.toml`; settings UI exposes all options across General, Media, GIF, Emoji, Notifications, and Themes tabs

#### UI / Polish
- [x] **Compose box animation** — input bar restyled as a message bubble; sent messages animate upward into the timeline with header/avatar fade-in; compose box pulses on send; consecutive own-messages merge into the same group
- [x] **Reply indicator in timeline** — reply messages show an inline quoted preview and always start a new message group (bubble break), even for consecutive same-sender messages
- [x] **Reactions UI** — `e` key opens a floating `QuickReactPicker` for the selected message; reaction chips are click-to-toggle; both dispatch to `sendReaction`
- [x] **Member list sidebar** — toggled with `m`; renders as a fixed right-side column (Discord-style) with presence indicators and power-level badges; populated on room select
- [x] Handle spaces — `get_user_spaces` IPC command populates SpaceStrip with joined spaces; spaces refresh in parallel with room list load
- [x] Sort DMs by recent — DM list sorted by `last_activity_ts` descending (timestamp of latest event fetched from local sqlite cache), fallback to notification_count × 2 + unread_count, then alphabetically
- [x] Sort rooms in spaces by space-defined order — `selectSpace()` preserves backend-sorted order from `getSpaceChildren()` (backend sorts by `m.space.child` `order` field, fallback alphabetical)
- [x] Don't show rooms that are in spaces in the DM view — home view (`__home__`) filters out rooms that belong to any space; `spaceRoomIds` set built at startup by fetching each space's children
- [x] Add profile dialogue and keybind — `ProfileDialog` overlay shows display name, user ID, and avatar; opened with `P` in normal mode or `:profile` command; `get_own_profile` IPC backed by matrix-sdk `account()` API
- [x] Back out of threads and replies with escape — global Escape handler now calls `cancelReply()` and `closeThread()`
- [x] Add emoji search window
- [x] Enable shortcode for custom emoji
- [x] Show all emojis in react picker — `QuickReactPicker` now loads all `BUILTIN_EMOJI` (pinned common reactions first) in a scrollable grid; filtering uses shortcode text
- [x] Add sticker picker dialogue
- [x] Add buttons on right side of compose box — emoji picker (🙂) and attach (📎) buttons added to right of compose box; emoji button opens picker; attach opens native file picker (images → m.image, other files → m.file)
- [x] Support pasting images into the compose box — clipboard image paste detected in `Input`, converted to base64, uploaded via new `send_pasted_image` IPC (Rust: decode base64 → upload → send as `m.image`)
- [x] Polish pass over top bar displaying room info. Take cues from the message UI.
- [x] Polish pass over verification UI; currently unstyled at the bottom
- [x] Emoji and sticker picker styling. Should show in box above compose area.
- [x] Threads animate open a space between message bubbles and display there.
- [x] Settings UI — `SettingsDialog` overlay with Notifications, Media Cache, and Themes tabs; opened with `:settings` or `?` key
- [x] Permissions UI — `RoomSettingsDialog` exposes General (name/topic), Access (join rule/history visibility), and Permissions (power levels with per-user overrides) tabs; opened via `:roomsettings` command or `[settings]` button in RoomInfoDialog
- [x] Space settings UI — `SpaceSettingsDialog` exposes General (name/topic) and Children (list of child rooms/spaces) tabs; opened via `:spacesettings` command
- [x] Debug viewer — `DebugViewer` shows raw JSON for room state events, specific timeline events (`$eventId`), and user profiles; opened via `:debug`, `:debug $eventId`, or `[raw]` button in RoomInfoDialog; supports [copy] to clipboard
- [x] Room info/configuration UI — `RoomInfoDialog` shows room name/topic/member count/encryption/ID, mute toggle, and leave button; now also has `[settings]` and `[raw]` action buttons; opened with `:info` or `I` key
- [x] Polish pass over top right status UI. User state (online, status, etc.) should go in the bottom left. Mode is no longer needed since it's in the compose UI. Presence status_msg shown in status bar; editable via click or S key.
- [x] Mouse interactions — hover react (😀) and reply (↩) buttons on messages
- [x] Mouse interactions — click on profile to open profile view
- [x] Pinned messages UI — `PinnedMessagesDialog` lists pinned events for the current room; opened with `:pinned`; `get_pinned_events` IPC backed by reading `m.room.pinned_events` state event
- [x] Implement themes — `loadTheme` IPC + `applyTheme` apply CSS custom properties; `:theme <name>` command works; Themes tab in Settings lists all built-in themes; all 10 built-in themes embedded in `src/theme/builtins.ts` so switching works without file system access
- [x] Make space UI bigger
- [x] Show avatars in member list
- [x] Profile images should snap to the top of the visible area if the message's position would place it out of view
- [x] Pause gif animation while not focused
- [x] Detect links
- [x] Add more info to profile screen
- [x] Split up messages more than 30 minutes apart
- [x] Add pinned message button to room header — 📌 pinned button added to room header; opens PinnedMessagesDialog; wired via `setPinnedClickHandler`
- [x] Add jump to pinned message — clicking a pinned message in the dialog closes it and calls `timeline.scrollToMessage(eventId)`
- [x] Move typing indicators below message box — dedicated `typing-indicator` div below input bar with animated dots; no longer uses status bar
- [x] Subspaces should be treated as categories of rooms in the parent space by the UI — `selectSpace` detects `is_space` children and calls `roomList.setSections()` with subspace names as labels
- [x] Pasting an image should put it in a preview above the message box, not immediately send — `Input` shows paste preview with Send/Cancel buttons; only uploads on confirm
- [x] Resizable panes — drag handles on room list (right edge), member list (left edge), thread view (left edge) update CSS variables via `attachResizeHandle`
- [x] Show reconfigured binds in help window — `HelpDialog` queries `keymapManager.getEntries()` and highlights any user-remapped keys in accent color with default shown in tooltip
- [x] Remove outline from image, keep it left aligned — removed border from `.message__image`; images were already `display: block` (left-aligned)
- [x] Image lightbox with ability to zoom and download — `ImageLightbox` overlay with zoom +/-, 1:1 reset, and download button; opens on click of any `.message__image`
- [x] Panning in image lightbox — drag-to-pan, scroll-wheel zoom, arrow-key pan; resets on zoom-out
- [x] Add quick navigation palette, similar to discord's ctrl+k — `QuickNavPalette` overlay opened with Ctrl+K; filters `roomListCache` in real-time; ↑/↓ or j/k to navigate, Enter to jump, Esc to close
- [x] @mention autocomplete — typing `@` in insert mode opens a member picker; prefix+fuzzy filtered; inserts display name on select
- [x] Unread message separator — `── new messages ──` line inserted before first unread message on room enter; timeline scrolls to separator
- [x] Skeleton page while messages are loading — phosphor-green shimmer skeleton rows shown immediately on room select; startup overlay with QUARK logo + progress bar covers the window during session restore and fades out when ready
- [x] Ability to disable vim mode — `vim_mode` toggle in General config + Settings UI; when off, app stays in Insert mode permanently, mode indicator is hidden, Escape only closes overlays, Normal/Visual/Command modes are bypassed
- [ ] Text selection; o on a message moves the cursor into the message for selection of the text.
  - [ ] If in text selection mode and visual mode, 'y' should copy selected text and '>' should insert selected text into the text box with md quote prefix i.e. `> quoted text here`
  - [ ] If I'm in insert mode and the compose box is not empty, I should enter text select mode in the compose box.
  - [ ] Outside of text select mode but in normal mode, 'y' should copy the full message
  - [ ] Outside of text select mode but in normal mode, 'p' should paste into the compose box
  - [ ] In text select mode in normal mode in the compose box, 'p' should paste into the compose box at the cursor position

#### Messaging
- [ ] **Message revision history UI** — clicking the "(edited)" marker on a message opens a dialog showing all previous versions of the message (fetched via `get_event_context` or a dedicated revision history IPC that queries `m.replace` events for the original event ID). Show each revision with its timestamp and sender.

#### Hardening
- [ ] Accessibility audit — keyboard-only navigation, screen reader ARIA hints
- [ ] Performance profiling — large rooms (1000+ messages), many emoji packs
- [ ] Command audit - make sure all commands are fully implemented
- [ ] Use blobs rather than data URLs so the browser can cache (I think this makes sense? Tell me if it doesn't.)
- [ ] Unload messages far out of view in timeline when adding new messages to prevent overloading the timeline

#### Bugs
- [x] rooms don't always load. (scroll getting stuck fixed — cancelled scroll animation on room switch)
- [x] Some images aren't showing up — removed lazy loading (prevented load in overflow containers); isOwn now set on loaded timeline events
- [x] Space icons don't show up — mxc:// URLs now downloaded and resolved in background
- [x] Timeline should always start scrolled to the bottom — scroll on render + rAF + 150ms delayed pass
- [x] Profile pictures don't show in profile view — mxc:// resolved via getThumbnail before show
- [x] Profile view always selects user, not sender of selected message — now shows selected message sender (falls back to own profile)
- [x] Profile viewer starts offset from center, then snaps into view — CSS animation conflict fixed (profile-dialog-in includes translate offset)
- [x] Unable to move vim keyboard focus to room list, space list, or member list — ArrowLeft/Right navigates spaces ← roomlist ← timeline → members; SpaceStrip/MemberList have focusFirst/navDown/navUp
- [x] Send message animation is no longer aligned when creating a new bubble — input-bar padding-left set to 0 to align compose box with message groups
- [x] Sent messages show as from "you" rather than with the correct profile info — ownUserId/ownDisplayName fetched after login and stored in AppState
- [x] Emoji picker sometimes goes off screen — added full CSS (was missing entirely); fixed position bottom-right above compose area
- [x] Clicking in the compose box allows you to type without switching to insert mode — click handler on input field transitions to Insert mode
- [x] Custom emojis are not shown in shortcode preview, emoji picker, or react picker — mxc:// URLs resolved to data: URLs before display (emoji picker + shortcode preview)
- [x] ctrl + [ does not work as escape in all places (i.e. react emoji picker) — QuickReactPicker now handles Ctrl+[ in both input and grid handlers
- [x] React picker and emoji picker are separate entities; probably best to combine for consistency and maintainability — QuickReactPicker refactored: _allData + _rebuildButtons() replaces hardcoded REACTION_DATA; setCustomEmoji() prepends MSC2545 custom emoji with img thumbnails
- [x] Noticeable delay when switching rooms — timeline rendered immediately from getTimeline, members fetched concurrently and UI updated when ready
- [x] Loading new messages scrolls to a random position — preserveScroll option in setMessages(); secondary member-data re-render no longer jumps to bottom
- [x] App does not use my KDE window bar, seems to have custom?
- [x] h/l don't navigate left and right.
- [x] Focus sometimes gets stuck/can't move to timeline
- [x] React picker goes off screen if message is close to the bottom — picker flips upward via rAF bounding rect check when near viewport bottom
- [x] o should open select rooms/spaces
- [x] Selecting a space should move to the rooms list — focusPanel("roomlist") called from all selectSpace() branches
- [x] Message recency sorting doesn't seem to be working for DMs — last_activity_ts from Rust timeline cache used as primary sort key
- [x] Viewing a room doesn't dismiss the unread count — mark_room_read Tauri command sends read receipt; local cache zeroed optimistically
- [x] Custom emotes still don't show up in the react or message emoji picker or in shortcode — fixed race condition in refreshCustomEmoji (capture by object ref, not index); custom emoji injected into QuickReactPicker via openQuickReactPicker(); mock download_media handler added
- [x] Sticker previews don't render in sticker picker — async getThumbnail() resolves mxc:// URLs per sticker; updateStickerThumbnail() patches live img src without full re-render
- [x] Animated avatars don't work — use downloadMedia instead of getThumbnail for avatars; Rust sniffs MIME from magic bytes
- [x] There's currently no way to log out — :logout command revokes session, clears storage, reloads to login screen
- [x] Timeline disappears briefly when loading new messages, reappears if scroll again.
- [x] Home view should be sorted by recent
- [x] Escape/ctrl + [ don't close profile popup — added tabindex="-1" to dialog element, call focus() on show(), and handle Ctrl+[ in keydown handler
- [x] Clicking a message should also update the keyboard's selected message — click handler on _el uses closest("[data-message-id]") to find index and calls _setSelected()
- [x] pressing P while in member list opens the profile of the currently selected message's sender rather than the selected user in the member list — openProfileDialog() checks activePanel==="members" first and uses memberList.getFocusedMember()
- [x] Keyboard nav doesn't quite scroll far enough when moving to an off-screen message — replaced scrollIntoView({block:"nearest"}) with a custom _scrollIntoViewWithScrolloff() that keeps 80px margin on both edges (vim-style scrolloff)
- [x] Sometimes unable to navigate timeline — fixed two root causes: (1) _selectedIndex not reset on room switch left it out-of-range, making selectNext/selectPrev think the boundary was reached; (2) clicking the timeline now fires an onFocus callback that updates activePanel to "timeline" so j/k immediately routes there
- [x] timeline navigation broken after loading more messages — _scrollTopFired was not reset in prependMessages, blocking keyboard nav from triggering further page loads; reset to false after scroll restoration (_paginationLoading guard prevents immediate double-fire)
- [x] Still can't see custom emotes, only getting stickers
- [x] Emoji and sticker pickers are separate dom elements; just recreate the content box, don't recreate the whole popup — StickerPicker merged into EmojiPicker; tab switching swaps section visibility within one DOM element, no popup close/reopen
- [x] Emoji and sticker pickers initially appear in the wrong position — both used profile-dialog-in animation (centering transform) instead of a simple picker-in fade/slide; added @keyframes picker-in
- [x] Custom emoji tabs pop in after emoji picker load — custom emoji categories now cached per-room in `_customEmojiCategoryCache`; prepended immediately on open, then refreshed by the async load
- [x] Show emoji categories in react picker
- [x] When sending a message, break into new bubble on the same condition as loading existing messages — appendMessage/appendMessageHidden now check 30-minute time gap before merging into existing group, inserting a time separator when needed
- [x] Redacted messages don't disappear until reloading the chat — redactMessage now calls timeline.removeMessage() after successful IPC; removes from DOM and _messages array, collapses single-message groups
- [x] Selecting a room in some spaces returns the room list to the home view — selectRoom was calling roomList.setRooms() with all cached rooms when clearing unread badge; now uses updateRoomBadge() to update only the specific room item in place
- [x] Newly sent messages don't have a profile picture — optimistic message in sendMessage was missing senderAvatarUrl; now resolved from _memberAvatarMxc/_avatarDataUrl cache using ownUserId
- [x] Room list still jumps from selected space to home with all rooms listed sometimes — sync message handler was calling setRooms() with all cached rooms; now uses updateRoomBadge() to update only the affected room badge in place
- [x] Timeline jumps when loading images, placing user in the middle of message history upon newly loading a room — added capture-phase `load` listener on the scroll container that scrolls to bottom when any image loads while not scrolled up
- [x] Image paste does not work on Linux — added fallback to clipboardData.files (used by some Linux clipboard managers) and async navigator.clipboard.read() for Wayland/WebKit2GTK where clipboardData is not populated for text inputs
- [x] Emojis in emoji picker are sometimes too large, end up scrolling sideways — added overflow-x: hidden to grid and overflow: hidden + min-width: 0 to cells
- [x] Emoji categories in react emoji picker not implemented properly — _focusGrid and all navigation keys (h/l/j/k/Tab) now skip hidden buttons so keyboard focus lands on a visible emoji when a category filter is active
- [x] Links sometimes open inside the app, navigating away from the chat UI — HTML body anchor tags now have href removed and a click handler added that opens via plugin:shell|open instead of letting the WebView follow the link
- [x] Multiple/global sticker packs don't load in the sticker picker — pack section headers added to sticker grid; each pack group renders with a label when pack name changes
- [x] User statuses don't always load — presence state now cached from live sync events and applied on room switch via updateMemberPresence()
- [x] toml file seems to be ignored — loadThemeFromConfig() now called on login and session restore, reads theme from config.toml via get_app_config IPC
- [x] Custom emotes in reacts just send text — reaction key now uses mxc:// URL per MSC2545 spec instead of :shortcode: text
- [x] Sometimes can't load additional messages in timeline — loadMoreMessages() now retries up to 10 empty pages when all fetched events are non-message types (reactions/state events)
- [x] Custom emotes/stickers don't show always — shortcode preview no longer sets imageUrl to mxc:// before download; waits for data: URL to resolve
- [x] Custom emotes don't render from shortcode or in reacts — sendMessage/sendThreadReply now build formatted_body with <img data-mx-emoticon> for custom emoji shortcodes
- [x] No settings button — gear button added to SpaceStrip bottom, opens SettingsDialog
- [x] Icon roundedness globally configurable — --icon-radius CSS variable + icon_radius config field; Circle/Rounded/Square picker in General settings tab
- [x] Select bar doesn't follow theme — fixed as side effect of TOML config now loading correctly on startup
- [x] Sent messages don't initially render custom emote shortcode until room reloaded — optimistic message now has htmlBody set before appendMessageHidden; _downloadInlineEmoji called immediately after
- [x] Reacts not updating / raw mxc:// text in react picker — setCustomEmoji inside async thumbnail callbacks now filters to only fully-resolved entries
- [x] Raw text for some emotes on first react picker open — same fix as above; unresolved entries excluded until imageUrl is ready
- [x] Room-scope stickers still not showing in sticker picker — emoji.rs pack_usage fallback changed from ["emoticon"] to ["emoticon","sticker"] so packs without explicit usage field are included
- [x] Theme selection from settings UI resets on relaunch — theme button handler now calls getAppConfig/setAppConfig to persist the selection to config.toml
- [x] Icon roundness doesn't apply to profile/message avatars — replaced hardcoded border-radius on member-list, room-header, message-group, and profile-dialog avatars with var(--icon-radius)
- [x] Video messages show no thumbnail — `media_thumbnail_url` / `media_thumbnail_encryption_info` extracted from `VideoInfo.thumbnail_source` and passed through IPC; `buildVideoAffordance` loads thumbnail async and renders 160×90 preview with ▶ overlay
- [x] No URL preview cards for messages containing links — `get_url_preview` Tauri command calls homeserver `/_matrix/media/v3/preview_url`; frontend extracts first URL from text messages and appends a styled preview card (title, description, image, site name) async with module-level cache

