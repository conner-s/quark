// Keyboard orchestration — wires vim mode + keymaps to action dispatcher

import { modeManager, Mode } from "../vim/mode.js";
import { keymapManager } from "../vim/keybindings.js";
import type { AppComponents } from "../ui/App.js";
import {
  sendMessage,
  sendReaction,
  cancelReply,
  openEmojiPicker,
  openGifPicker,
  openProfileDialog,
  openSettings,
  openRoomInfo,
  openRoomSettings,
  openSpaceSettings,
  openDebugViewer,
  openDebugViewerForEvent,
  openPinnedMessages,
  openRoomDirectory,
  executeCommand,
  toggleMemberList,
  startReply,
  startEdit,
  cancelEdit,
  editMessage,
  redactMessage,
  openThread,
  closeThread,
  openQuickReactPicker,
  setupReactionChipHandler,
  setupMessageActionHandlers,
  handleImagePaste,
  handleFilePick,
  setupStatusBar,
  editStatus,
  jumpToMessage,
  jumpToLatest,
  loadTheme,
  selectRoom,
} from "./actions.js";
import { AppState } from "./state.js";
import { loadQuarkrc } from "../ipc/config.js";
import type { ParsedRc } from "../ipc/types.js";
import { getAppConfig, setAppConfig } from "../ipc/app_config.js";
import type { AppConfig } from "../ipc/app_config.js";
import type { KeyContext } from "../vim/keybindings.js";
import { BUILTIN_EMOJI } from "../data/unicode-emoji.js";
import { showToast } from "../ui/NotificationToast.js";
import { filterShortcodes, type ShortcodeEntry } from "../ui/ShortcodePreview.js";
import { filterMembers, type MentionEntry } from "../ui/MentionPreview.js";
import { getEmojiPacks } from "../ipc/emoji.js";
import { getThumbnail } from "../ipc/media.js";
import { getRoomMembers } from "../ipc/rooms.js";

// ── Default keybindings ───────────────────────────────────────────────────────

function registerDefaultBindings(): void {
  // Normal mode — global
  keymapManager.nmap("i", "mode-insert");
  keymapManager.nmap(":", "mode-command");
  keymapManager.nmap("v", "mode-visual");
  keymapManager.nmap("j", "nav-down");
  keymapManager.nmap("k", "nav-up");
  keymapManager.nmap("h", "nav-left");
  keymapManager.nmap("l", "nav-right");
  keymapManager.nmap("ArrowLeft", "nav-left");
  keymapManager.nmap("ArrowRight", "nav-right");
  keymapManager.nmap("ArrowUp", "nav-up");
  keymapManager.nmap("ArrowDown", "nav-down");
  keymapManager.nmap("gg", "jump-top");
  keymapManager.nmap("G", "jump-bottom");
  keymapManager.nmap("r", "reply");
  keymapManager.nmap("e", "react");
  keymapManager.nmap("dd", "redact");
  keymapManager.nmap("E", "edit");
  keymapManager.nmap("c", "edit");
  keymapManager.nmap("t", "open-thread");
  keymapManager.nmap("m", "toggle-members");
  keymapManager.nmap("P", "open-profile");
  keymapManager.nmap("S", "edit-status");
  keymapManager.nmap("?", "open-settings");
  keymapManager.nmap("I", "open-room-info");

  // select — activates the focused item in panels that support it (roomlist, spaces)
  keymapManager.nmap("Enter", "select");
  keymapManager.nmap("o", "select");

  // copy / paste
  keymapManager.nmap("y", "copy-message");
  keymapManager.nmap("p", "paste-to-input");

  // close — clears selection / reply / thread for the active panel
  keymapManager.nmap("Escape", "close");
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

function dispatchAction(action: string, components: AppComponents): void {
  const { input, commandBar, timeline, imageLightbox, revisionHistoryDialog, contextMenu } = components;

  switch (action) {
    case "mode-insert":
      modeManager.transition(Mode.Insert);
      input.focus();
      break;

    case "mode-command":
      modeManager.transition(Mode.Command);
      commandBar.show();
      break;

    case "mode-visual":
      modeManager.transition(Mode.Visual);
      break;

    // ── Navigation — routed through panel registry ─────────────────────
    case "nav-down":
      AppState.navDown();
      break;

    case "nav-up":
      AppState.navUp();
      break;

    case "nav-left":
      AppState.moveFocusLeft();
      break;

    case "nav-right":
      AppState.moveFocusRight();
      break;

    case "jump-top":
      AppState.jumpTop();
      break;

    case "jump-bottom":
      if (AppState.get("activePanel") === "timeline") {
        void jumpToLatest();
      } else {
        AppState.jumpBottom();
      }
      break;

    // ── Message actions — operate on the selected message ───────────────
    case "reply": {
      const msgId = timeline.selectedMessageId;
      if (msgId) {
        const events = AppState.get("currentTimeline");
        const evt = events.find((e) => e.event_id === msgId);
        if (evt) {
          startReply(msgId, evt.sender, evt.body.slice(0, 80));
          modeManager.transition(Mode.Insert);
          input.focus();
        }
      }
      break;
    }

    case "redact": {
      const msgId = timeline.selectedMessageId;
      if (msgId) void redactMessage(msgId);
      break;
    }

    case "copy-message": {
      const msgId = timeline.selectedMessageId;
      if (msgId) {
        const events = AppState.get("currentTimeline");
        const evt = events.find((e) => e.event_id === msgId);
        if (evt) {
          void navigator.clipboard.writeText(evt.body).then(() => {
            showToast("Copied message");
          });
        }
      }
      break;
    }

    case "paste-to-input": {
      // Avoid navigator.clipboard.readText() — on macOS it triggers a system
      // permission popup for external clipboard sources. Switch to insert mode
      // and focus the input; the user pastes with ⌘V / Ctrl+V as usual.
      modeManager.transition(Mode.Insert);
      input.focus();
      break;
    }

    case "open-thread": {
      if (timeline.inlineThreadRootId) {
        closeThread();
      } else {
        // selectedMessageId returns the thread-reply ID when a thread is
        // navigated — we need the underlying timeline selection here.
        const msgId = timeline.timelineSelectedMessageId;
        if (msgId) void openThread(msgId);
      }
      break;
    }

    case "react": {
      const msgId = timeline.selectedMessageId;
      if (msgId) openQuickReactPicker(msgId);
      break;
    }

    case "select":
    case "select-room": {
      // If in the timeline and the selected message is an image, open the lightbox
      const sel = timeline.selectedMessage;
      if (sel?.type === "image" && sel.mediaUrl && AppState.get("activePanel") === "timeline") {
        imageLightbox.show(sel.mediaUrl, sel.mediaAlt ?? sel.body);
      } else {
        AppState.select();
      }
      break;
    }

    case "edit": {
      const msg = timeline.selectedMessage;
      if (msg?.id && msg.isOwn) {
        // Use body from MessageData (already has _applyEdits applied and
        // reflects any subsequent updateMessageBody calls).
        startEdit(msg.id, msg.body);
        modeManager.transition(Mode.Insert);
        input.focus();
      }
      break;
    }

    case "toggle-members":
      toggleMemberList();
      break;

    case "open-profile":
      void openProfileDialog();
      break;

    case "open-settings":
      openSettings();
      break;

    case "open-room-info":
      void openRoomInfo();
      break;

    case "open-room-settings":
      void openRoomSettings();
      break;

    case "open-space-settings":
      void openSpaceSettings();
      break;

    case "open-debug":
      void openDebugViewer();
      break;

    case "edit-status":
      editStatus();
      break;

    case "close":
      AppState.close();
      break;

    default:
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action } }));
      break;
  }
}

// ── Shortcode autocomplete ──────────────────────────────────────────────────

/** Cached custom emoji entries from server packs (refreshed per room). */
let _customEmoji: ShortcodeEntry[] = [];
let _customEmojiRoomId: string | null = null;

/**
 * Refresh the custom emoji cache when the room changes.
 * Falls back silently to an empty list on error.
 */
async function refreshCustomEmoji(): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (roomId === _customEmojiRoomId) return;
  _customEmojiRoomId = roomId;

  try {
    const packs = await getEmojiPacks(roomId ?? undefined);
    _customEmoji = [];
    for (const pack of packs) {
      for (const entry of pack.emojis) {
        if (!entry.usage.includes("emoticon")) continue;
        // Don't set imageUrl to a bare mxc:// URL — browsers can't load those
        // and the shortcode preview would show a broken image. Leave it unset
        // until the thumbnail is resolved, then replace in-place.
        const customEntry: ShortcodeEntry = {
          key: `:${entry.shortcode}:`,
          shortcode: entry.shortcode,
          imageUrl: entry.url.startsWith("mxc://") ? undefined : entry.url,
        };
        _customEmoji.push(customEntry);
        if (entry.url.startsWith("mxc://")) {
          // Capture by object reference to avoid stale-index bugs if the room
          // switches (and _customEmoji is rebuilt) before the download finishes.
          const captured = customEntry;
          getThumbnail(entry.url, 32, 32).then((dl) => {
            const i = _customEmoji.indexOf(captured);
            if (i >= 0) {
              _customEmoji[i] = {
                ...captured,
                imageUrl: `data:${dl.mime_type};base64,${dl.data_base64}`,
              };
            }
          }).catch(() => { /* non-critical */ });
        }
      }
    }
  } catch {
    _customEmoji = [];
  }
}

/** All available shortcode entries (built-in + custom). */
function allShortcodes(): ShortcodeEntry[] {
  return [..._customEmoji, ...BUILTIN_EMOJI];
}

/**
 * Extract the active shortcode query from the input value.
 * Returns the query text (without the colon) if the cursor is in a `:query` span,
 * or null if no shortcode is being typed.
 */
function extractShortcodeQuery(value: string): string | null {
  // Find the last unmatched colon
  const lastColon = value.lastIndexOf(":");
  if (lastColon < 0) return null;

  const query = value.slice(lastColon + 1);
  // Must have at least 1 character after the colon and no spaces
  if (query.length < 1 || /\s/.test(query)) return null;
  // Don't trigger if the colon is preceded by another colon (already closed like :foo:)
  // Check that this colon isn't the closing colon of a previous shortcode
  const beforeColon = value.slice(0, lastColon);
  const prevColon = beforeColon.lastIndexOf(":");
  if (prevColon >= 0) {
    const between = beforeColon.slice(prevColon + 1);
    // If the text between the two colons has no spaces, the last colon closes a shortcode
    if (between.length > 0 && !/\s/.test(between)) return null;
  }

  return query;
}

// ── Mention autocomplete ──────────────────────────────────────────────────────

/** Cached member list for the current room. */
let _roomMembers: MentionEntry[] = [];
let _roomMembersRoomId: string | null = null;

async function refreshRoomMembers(): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId || roomId === _roomMembersRoomId) return;
  _roomMembersRoomId = roomId;
  try {
    const members = await getRoomMembers(roomId);
    _roomMembers = members.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name ?? m.user_id,
      avatarUrl: undefined, // resolved lazily below if needed
    }));
  } catch {
    _roomMembers = [];
  }
}

/**
 * Extract the active @mention query from the input value.
 * Returns the query text (without @) or null.
 */
function extractMentionQuery(value: string): string | null {
  const lastAt = value.lastIndexOf("@");
  if (lastAt < 0) return null;
  // The character before @ must be a space or start of string
  if (lastAt > 0 && !/\s/.test(value[lastAt - 1])) return null;
  const query = value.slice(lastAt + 1);
  // Must have no spaces (a space ends the mention query)
  if (/\s/.test(query)) return null;
  return query;
}

// ── Insert mode keyboard handlers ─────────────────────────────────────────────

function handleInsertKeydown(e: KeyboardEvent, components: AppComponents): void {
  const { input, shortcodePreview, mentionPreview } = components;

  // Mention autocomplete intercepts first
  if (mentionPreview.isVisible()) {
    const consumed = mentionPreview.handleKeydown(e);
    if (consumed) return;
  }

  // Shortcode autocomplete intercepts next
  if (shortcodePreview.isVisible()) {
    const consumed = shortcodePreview.handleKeydown(e);
    if (consumed) return;
  }

  // Ctrl-e → emoji picker
  if (e.ctrlKey && e.key === "e") {
    e.preventDefault();
    openEmojiPicker();
    return;
  }

  // Ctrl-g → GIF picker
  if (e.ctrlKey && e.key === "g") {
    e.preventDefault();
    openGifPicker();
    return;
  }

  // Enter → send message, reply, or commit an inline edit
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    shortcodePreview.hide();
    const body = input.getValue().trim();
    if (body) {
      const editingId = AppState.get("editingEventId");
      if (editingId) {
        AppState.set("editingEventId", null);
        components.replyPreview.hide();
        input.setValue("");
        void editMessage(editingId, body);
      } else {
        void sendMessage(body);
      }
    }
    return;
  }

  // Tab → trigger shortcode autocomplete (handled via input event elsewhere)
  if (e.key === "Tab") {
    e.preventDefault();
    // Shortcode autocomplete trigger — just cycle if visible
    return;
  }

  // Escape already handled globally

  // If focus escaped the compose box (e.g. user clicked elsewhere), redirect
  // printable characters back to it so typing always works in Insert mode.
  const field = input.getFieldElement();
  if (document.activeElement !== field && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    input.focus();
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    field.value = field.value.slice(0, start) + e.key + field.value.slice(end);
    field.selectionStart = field.selectionEnd = start + 1;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// ── User rc application ───────────────────────────────────────────────────────

const MAP_TYPE_TO_CONTEXT: Readonly<Record<string, KeyContext>> = {
  normal: "global",
  insert: "insert",
  timeline: "timeline",
  roomlist: "roomlist",
  picker: "picker",
  command: "command",
  visual: "visual",
};

function applySetOptions(cfg: AppConfig, sets: Array<{ name: string; value: boolean | number | string }>): AppConfig {
  const updated: AppConfig = {
    general: { ...cfg.general },
    sync: { ...cfg.sync },
    media: { ...cfg.media },
    gif: { ...cfg.gif },
    emoji: { ...cfg.emoji },
  };

  for (const { name, value } of sets) {
    switch (name) {
      // general
      case "theme":           if (typeof value === "string")  updated.general.theme = value; break;
      case "notifications":   if (typeof value === "boolean") updated.general.notifications = value; break;
      case "confirm_redact":  if (typeof value === "boolean") updated.general.confirm_redact = value; break;
      case "icon_radius":     if (typeof value === "string")  updated.general.icon_radius = value; break;
      case "vim_mode":        if (typeof value === "boolean") updated.general.vim_mode = value; break;
      // sync
      case "sliding_sync":    if (typeof value === "boolean") updated.sync.sliding_sync = value; break;
      case "timeline_limit":  if (typeof value === "number")  updated.sync.timeline_limit = value; break;
      // media
      case "auto_load_images":  if (typeof value === "boolean") updated.media.auto_load_images = value; break;
      case "max_image_width":   if (typeof value === "number")  updated.media.max_image_width = value; break;
      case "max_image_height":  if (typeof value === "number")  updated.media.max_image_height = value; break;
      case "sticker_max_size":  if (typeof value === "number")  updated.media.sticker_max_size = value; break;
      case "cache_size_mb":     if (typeof value === "number")  updated.media.cache_size_mb = value; break;
      // gif
      case "gif_provider":      if (typeof value === "string")  updated.gif.provider = value as "tenor" | "giphy"; break;
      case "gif_rating":        if (typeof value === "string")  updated.gif.rating = value as "g" | "pg" | "pg-13" | "r"; break;
      case "gif_api_key":       if (typeof value === "string")  updated.gif.api_key = value; break;
      case "gif_cache_results": if (typeof value === "boolean") updated.gif.cache_results = value; break;
      // emoji
      case "shortcode_autocomplete": if (typeof value === "boolean") updated.emoji.shortcode_autocomplete = value; break;
      case "autocomplete_min_chars": if (typeof value === "number")  updated.emoji.autocomplete_min_chars = value; break;
      default:
        console.warn(`[quarkrc] unknown set option: "${name}"`);
    }
  }

  return updated;
}

async function applyRcDirectives(rc: ParsedRc): Promise<void> {
  for (const directive of rc.directives) {
    if (directive.type === "map") {
      const context = MAP_TYPE_TO_CONTEXT[directive.map_type];
      if (context) keymapManager.map(context, directive.key, directive.action, directive.noremap);
    } else if (directive.type === "unmap") {
      const context = MAP_TYPE_TO_CONTEXT[directive.map_type];
      if (context) keymapManager.unmap(context, directive.key);
    } else if (directive.type === "let" && directive.name === "mapleader") {
      keymapManager.setLeaderKey(directive.value);
    } else if (directive.type === "colorscheme") {
      void loadTheme(directive.name);
    }
  }
  if (rc.errors.length > 0) {
    console.warn("[quarkrc] parse errors:", rc.errors);
  }

  const setDirectives = rc.directives.filter(
    (d): d is Extract<typeof d, { type: "set" }> => d.type === "set"
  );
  if (setDirectives.length === 0) return;

  try {
    const cfg = await getAppConfig();
    const updated = applySetOptions(cfg, setDirectives);
    await setAppConfig(updated);
  } catch (err) {
    console.warn("[quarkrc] failed to apply set directives:", err);
  }
}

// ── Global keydown handler ────────────────────────────────────────────────────

export function setupKeyboard(components: AppComponents): void {
  const { input, commandBar, shortcodePreview, mentionPreview, timeline,
          emojiPicker, gifPicker, verification, helpDialog, quickReactPicker, profileDialog, devicePicker,
          settingsDialog, roomInfoDialog, pinnedMessagesDialog, roomDirectoryDialog,
          roomSettingsDialog, spaceSettingsDialog, debugViewer, revisionHistoryDialog,
          roomHeader, imageLightbox, quickNavPalette, contextMenu,
          spaceStrip, roomList } = components;

  registerDefaultBindings();

  // Load vim mode preference from persisted config
  void getAppConfig().then((cfg) => {
    AppState.set("vimMode", cfg.general.vim_mode);
    // Apply immediately — the state listener won't fire if the value matches the default
    input.setVimMode(cfg.general.vim_mode);
    if (!cfg.general.vim_mode) {
      modeManager.transition(Mode.Insert);
      input.focus();
    }
  }).catch(() => { /* use default (true) */ });

  // React to vim mode toggling at runtime (e.g. from Settings)
  AppState.on("vimMode", (_key, enabled) => {
    if (enabled) {
      modeManager.transition(Mode.Normal);
      input.blur();
    } else {
      modeManager.transition(Mode.Insert);
      input.focus();
    }
    input.setVimMode(enabled);
  });

  // Member count in the header toggles the member list sidebar
  roomHeader.setMemberCountClickHandler(() => toggleMemberList());

  // Pinned messages button in the header opens the pinned messages dialog
  roomHeader.setPinnedClickHandler(() => void openPinnedMessages());

  // Clicking a pinned message jumps to it in the timeline
  pinnedMessagesDialog.onJumpToMessage((eventId) => void jumpToMessage(eventId));

  // Reply preview jumps to the original when message is not loaded
  timeline.onJumpToMessage((eventId) => void jumpToMessage(eventId));

  // "Jump to latest" button
  timeline.onJumpToLatest(() => void jumpToLatest());

  // Image lightbox — wire timeline image clicks
  timeline.onImageClick((src, alt) => {
    imageLightbox.show(src, alt);
  });

  // Revision history — wire (edited) marker clicks
  timeline.onShowRevisionHistory((eventId, originalBody) => {
    revisionHistoryDialog.show(eventId, originalBody);
  });

  // Right-click context menu for messages
  timeline.onContextMenu((eventId, x, y) => {
    const events = AppState.get("currentTimeline");
    const evt = events.find((ev) => ev.event_id === eventId);
    contextMenu.show(x, y, [
      {
        label: "Reply",
        hint: "r",
        action: () => {
          if (evt) {
            startReply(eventId, evt.sender, evt.body.slice(0, 80));
            input.focus();
          }
        },
      },
      {
        label: "React",
        hint: "e",
        action: () => openQuickReactPicker(eventId),
      },
      { separator: true },
      {
        label: "Copy message text",
        hint: "y",
        action: () => {
          const text = evt?.body ?? "";
          void navigator.clipboard.writeText(text);
        },
      },
      {
        label: "View raw event",
        action: () => void openDebugViewerForEvent(eventId),
      },
    ]);
  });

  // Right-click context menu for rooms in the room list
  roomList.onContextMenu((roomId, x, y) => {
    const rooms = AppState.get("roomListCache");
    const room = rooms.find((r) => r.room_id === roomId);
    contextMenu.show(x, y, [
      {
        label: "Open",
        action: () => void selectRoom(roomId),
      },
      { separator: true },
      {
        label: "Room settings",
        action: () => void selectRoom(roomId).then(() => openRoomSettings()),
      },
      {
        label: "Room info",
        action: () => void selectRoom(roomId).then(() => openRoomInfo()),
      },
      ...(room && room.unread_count > 0 ? [
        { separator: true } as const,
        {
          label: "Mark as read",
          action: () => void selectRoom(roomId),
        },
      ] : []),
    ]);
  });

  // Right-click context menu for subspace section labels in the room list
  roomList.onSectionContextMenu((spaceId, x, y) => {
    contextMenu.show(x, y, [
      {
        label: "Space settings",
        action: () => void openSpaceSettings(spaceId),
      },
    ]);
  });

  // Right-click context menu for spaces in the space strip
  spaceStrip.onContextMenu((spaceId, x, y) => {
    contextMenu.show(x, y, [
      {
        label: "Space settings",
        action: () => void openSpaceSettings(spaceId),
      },
    ]);
  });

  // ── User keybindings ──────────────────────────────────────────────────────
  void loadQuarkrc().then(applyRcDirectives).catch(() => { /* no rc file is fine */ });

  // Wire quick nav palette → selectRoom
  quickNavPalette.onSelect((roomId) => {
    void selectRoom(roomId);
  });

  // Wire quick react picker → sendReaction
  quickReactPicker.onReact((eventId, key) => {
    void sendReaction(eventId, key);
  });

  // Track activePanel when focus lands on the space strip
  components.spaceStrip.getElement().addEventListener("quark:space-focused", () => {
    AppState.set("activePanel", "spaces");
  });

  // Clicking the input field while not in Insert mode switches to Insert mode
  input.onFocusEnterInsert(() => {
    if (AppState.get("vimMode") && modeManager.current !== Mode.Insert) {
      modeManager.transition(Mode.Insert);
      input.focus();
    }
  });

  // Wire compose box action buttons
  input.onEmojiPickerClick(() => {
    modeManager.transition(Mode.Insert);
    input.focus();
    openEmojiPicker();
  });

  input.onAttachClick(() => {
    input.openFilePicker();
  });

  input.onFilePick((file) => {
    void handleFilePick(file);
  });

  // Wire image paste in compose field
  input.onImagePaste((blob) => {
    void handleImagePaste(blob);
  });

  // Wire reaction chip clicks (bubbling custom events) → sendReaction
  setupReactionChipHandler();
  // Wire hover action bar button clicks → react / reply
  setupMessageActionHandlers();
  setupStatusBar();

  // Sync mode indicators + blur/focus on mode change
  modeManager.on((_from, to) => {
    input.setMode(to);

    if (to === Mode.Normal) {
      // Blur the input so normal-mode keys don't type into the textbox
      input.blur();
      shortcodePreview.hide();
      mentionPreview.hide();
    }
  });

  // Command bar wiring
  commandBar.onExecute((parsed) => {
    modeManager.transition(Mode.Normal);
    void executeCommand(parsed);
  });

  commandBar.onCancel(() => {
    modeManager.transition(Mode.Normal);
  });

  // Reply preview dismiss → cancel reply
  components.replyPreview.onDismiss(() => {
    cancelReply();
    cancelEdit();
  });

  // Thread view close → closeThread (sidebar fallback)
  components.threadView.onClose(() => {
    closeThread();
  });

  // Inline thread close callback (the [x] button inside the panel)
  components.timeline.onInlineThreadClose(() => {
    closeThread();
  });

  // ── Shortcode preview wiring ────────────────────────────────────────────
  shortcodePreview.onSelect((entry) => {
    const value = input.getValue();
    const lastColon = value.lastIndexOf(":");
    if (lastColon >= 0) {
      // Replace :query with the emoji
      const before = value.slice(0, lastColon);
      const replacement = entry.imageUrl ? `:${entry.shortcode}: ` : `${entry.key} `;
      input.setValue(before + replacement);
    }
    input.focus();
  });

  // ── Mention preview wiring ───────────────────────────────────────────────
  mentionPreview.onSelect((entry) => {
    const value = input.getValue();
    const lastAt = value.lastIndexOf("@");
    if (lastAt >= 0) {
      const before = value.slice(0, lastAt);
      // Insert display name as the visible text, user ID as the Matrix mention pill
      input.setValue(`${before}@${entry.displayName} `);
    }
    input.focus();
  });

  input.onInput((value) => {
    if (modeManager.current !== Mode.Insert) return;

    // Mention autocomplete (@name) — takes precedence over shortcodes if active
    const mentionQuery = extractMentionQuery(value);
    if (mentionQuery !== null) {
      shortcodePreview.hide();
      const matches = filterMembers(_roomMembers, mentionQuery);
      if (matches.length > 0) {
        mentionPreview.show(matches);
      } else {
        mentionPreview.hide();
      }
      return;
    }
    mentionPreview.hide();

    // Shortcode autocomplete
    const query = extractShortcodeQuery(value);
    if (query) {
      const all = allShortcodes();
      const matches = filterShortcodes(all, query);
      console.debug("[shortcode]", { value, query, allCount: all.length, matchCount: matches.length });
      if (matches.length > 0) {
        shortcodePreview.show(matches);
      } else {
        shortcodePreview.hide();
      }
    } else {
      shortcodePreview.hide();
    }
  });

  // Refresh custom emoji and room members when room changes
  AppState.on("currentRoomId", () => {
    void refreshCustomEmoji();
    void refreshRoomMembers();
  });

  // ── quark:action events from UI components ───────────────────────────────
  // Components that can't import actions.ts dispatch quark:action custom events.
  document.addEventListener("quark:action" as keyof DocumentEventMap, (e: Event) => {
    const detail = (e as CustomEvent<{ action: string }>).detail;
    if (detail?.action) {
      dispatchAction(detail.action, components);
    }
  });

  // ── Global keydown ──────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    const mode = modeManager.current;

    // Modal overlays with their own input (QuickReactPicker, etc.) handle all
    // their own keys with stopPropagation. The check here is a belt-and-
    // suspenders guard for the case where focus escapes the overlay element.
    if (quickReactPicker.isVisible()) return;
    if (mentionPreview.isVisible()) return;
    if (emojiPicker.isVisible()) {
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        e.preventDefault();
        emojiPicker.hide();
      }
      return;
    }
    if (gifPicker.isVisible() || verification.isVisible() || helpDialog.isVisible() ||
        profileDialog.isVisible() || devicePicker.isVisible() ||
        settingsDialog.isVisible() || roomInfoDialog.isVisible() ||
        pinnedMessagesDialog.isVisible() || roomDirectoryDialog.isVisible() ||
        roomSettingsDialog.isVisible() || spaceSettingsDialog.isVisible() ||
        debugViewer.isVisible() || revisionHistoryDialog.isVisible() ||
        contextMenu.isVisible()) return;

    // Quick nav palette — Ctrl+K opens from any mode (except when already open)
    if (e.ctrlKey && e.key === "k" && !quickNavPalette.isVisible()) {
      if (AppState.get("loggedIn")) {
        e.preventDefault();
        quickNavPalette.show();
        return;
      }
    }

    if (quickNavPalette.isVisible()) return;

    // Escape (or Ctrl+[) always resets to Normal (if not already) and clears sequences.
    // When vim mode is disabled, Escape just closes overlays — don't leave Insert mode.
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      if (AppState.get("vimMode")) {
        modeManager.transition(Mode.Normal);
        keymapManager.resetSequence();
        commandBar.hide();
      }
      AppState.close();
      return;
    }

    // Only intercept when logged in
    if (!AppState.get("loggedIn")) return;

    if (mode === Mode.Insert) {
      handleInsertKeydown(e, components);
      return;
    }

    // When vim mode is disabled we should never reach Normal/Visual/Command,
    // but guard just in case — treat everything as Insert.
    if (!AppState.get("vimMode")) {
      handleInsertKeydown(e, components);
      return;
    }

    if (mode === Mode.Command) {
      // Command bar handles its own keydown — nothing to do here
      return;
    }

    // Normal / Visual — resolve through keymap
    const panel = AppState.get("activePanel");
    const activeContext: KeyContext = panel === "timeline" ? "timeline"
      : panel === "roomlist" ? "roomlist"
      : "global";

    // Quark's keymap encodes only bare keys — feeding Ctrl+C into resolveKey
    // would match the `c` (edit) action and preventDefault, stealing the
    // browser's native copy/cut/paste/select-all. Ctrl+K and Ctrl+[ are the
    // app-level Ctrl combos and are intercepted above this block.
    if (e.ctrlKey || e.metaKey) {
      keymapManager.resetSequence();
      return;
    }

    const result = keymapManager.resolveKey(e.key, activeContext);

    if (result.kind === "action") {
      e.preventDefault();
      e.stopPropagation();
      dispatchAction(result.action, components);
    } else if (result.kind === "partial") {
      e.preventDefault();
      e.stopPropagation();
    } else {
      // "none" — in Normal mode, prevent any key from reaching a focused input
      if (mode === Mode.Normal || mode === Mode.Visual) {
        // Allow modifier-only keys, function keys, and browser shortcuts through
        const passthrough = e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey;
        if (!passthrough) {
          e.preventDefault();
        }
      }
    }
  });
}
