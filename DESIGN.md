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

- [ ] **Windows and macOS builds** — GitHub Actions matrix CI (free on public repo).
  - Single workflow file (`.github/workflows/release.yml`) triggered on `v*` tags.
  - Three jobs in a matrix: `ubuntu-latest` (`.deb` + `.AppImage`), `macos-latest` (`.dmg`, universal binary targeting both Apple Silicon and Intel via `--target universal-apple-darwin`), `windows-latest` (`.msi` + NSIS `.exe`).
  - Each job runs `pnpm tauri build` with the appropriate targets, then uploads artifacts to the GitHub Release via `softprops/action-gh-release`.
  - Secrets needed: `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the updater signature; macOS additionally needs `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` for notarization.
  - Until Apple credentials are available, macOS builds can be produced unsigned (users must right-click → Open to bypass Gatekeeper).

- [ ] **Mobile (Tauri v2)** — iOS and Android targets using the existing Tauri/Rust codebase.
  - Phase 1: get a working build on **iOS** first as a proof of concept (developer is on macOS, so the Xcode toolchain is already at hand).
  - Spike in progress on branch `spike/mobile`:
    - [x] Responsive CSS: viewport-driven mobile mode hides the space strip + room list and stacks the layout to a single full-width timeline column.
    - [x] Full-screen slide-over drawer exposes the space strip + room list on mobile. Tapping the "◀ Rooms" header, selecting a room, or swiping left dismisses it. Only one mobile overlay (drawer, member list, or thread view) can be open at a time — opening any one closes the others.
    - [x] Slim mobile top bar with a hamburger button, current room name, and members toggle.
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
  - UI adaptations still needed beyond the spike: long-press for context menu (replacing right-click), swipe between rooms in the timeline, pull-to-refresh, large-tap-target audit on pickers/dialogs, font-size adjust for high-DPI phones.
  - Once iOS is working, Android follows by running `pnpm tauri android init` and adding the Android NDK / SDK paths; matrix-sdk supports both.
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
- [ ] Home UI: Friends' icons and chat bubbles float around and the user's status
  - [ ] Hides room list and member list
  - [ ] Show user's profile fixed to the left side with the ability to update status and profile picture
  - [ ] Click through to DMs
  - [ ] Replaces existing list of all unparented rooms

#### Hardening
- [ ] Accessibility audit — keyboard-only navigation, screen reader ARIA hints
- [ ] Performance profiling — large rooms (1000+ messages), many emoji packs

#### Bugs
