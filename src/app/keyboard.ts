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
  openPinnedMessages,
  openRoomDirectory,
  executeCommand,
  toggleMemberList,
  startReply,
  redactMessage,
  openThread,
  closeThread,
  openQuickReactPicker,
  setupReactionChipHandler,
  setupMessageActionHandlers,
  handleImagePaste,
  setupStatusBar,
  editStatus,
  jumpToMessage,
  jumpToLatest,
} from "./actions.js";
import { AppState } from "./state.js";
import { loadQuarkrc } from "../ipc/config.js";
import type { ParsedRc } from "../ipc/types.js";
import type { KeyContext } from "../vim/keybindings.js";
import { BUILTIN_EMOJI } from "../data/unicode-emoji.js";
import { showToast } from "../ui/NotificationToast.js";
import { filterShortcodes, type ShortcodeEntry } from "../ui/ShortcodePreview.js";
import { getEmojiPacks } from "../ipc/emoji.js";
import { getThumbnail } from "../ipc/media.js";

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
  keymapManager.nmap("t", "open-thread");
  keymapManager.nmap("m", "toggle-members");
  keymapManager.nmap("P", "open-profile");
  keymapManager.nmap("S", "edit-status");
  keymapManager.nmap("?", "open-settings");
  keymapManager.nmap("I", "open-room-info");

  // select — activates the focused item in panels that support it (roomlist, spaces)
  keymapManager.nmap("Enter", "select");
  keymapManager.nmap("o", "select");

  // close — clears selection / reply / thread for the active panel
  keymapManager.nmap("Escape", "close");
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

function dispatchAction(action: string, components: AppComponents): void {
  const { input, commandBar, timeline, imageLightbox } = components;

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

    case "edit":
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action } }));
      break;

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
        const customEntry: ShortcodeEntry = {
          key: `:${entry.shortcode}:`,
          shortcode: entry.shortcode,
          imageUrl: entry.url, // may be mxc://, replaced below if so
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

// ── Insert mode keyboard handlers ─────────────────────────────────────────────

function handleInsertKeydown(e: KeyboardEvent, components: AppComponents): void {
  const { input, shortcodePreview } = components;

  // Shortcode autocomplete intercepts first
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

  // Enter → send message (or reply)
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    shortcodePreview.hide();
    const body = input.getValue().trim();
    if (body) {
      void sendMessage(body);
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

function applyRcDirectives(rc: ParsedRc): void {
  for (const directive of rc.directives) {
    if (directive.type === "map") {
      const context = MAP_TYPE_TO_CONTEXT[directive.map_type];
      if (context) keymapManager.map(context, directive.key, directive.action, directive.noremap);
    } else if (directive.type === "unmap") {
      const context = MAP_TYPE_TO_CONTEXT[directive.map_type];
      if (context) keymapManager.unmap(context, directive.key);
    } else if (directive.type === "let" && directive.name === "mapleader") {
      keymapManager.setLeaderKey(directive.value);
    }
  }
  if (rc.errors.length > 0) {
    console.warn("[quarkrc] parse errors:", rc.errors);
  }
}

// ── Global keydown handler ────────────────────────────────────────────────────

export function setupKeyboard(components: AppComponents): void {
  const { input, commandBar, shortcodePreview, timeline,
          emojiPicker, gifPicker, verification, helpDialog, quickReactPicker, profileDialog, devicePicker,
          settingsDialog, roomInfoDialog, pinnedMessagesDialog, roomDirectoryDialog,
          roomHeader, imageLightbox } = components;

  registerDefaultBindings();

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

  // ── User keybindings ──────────────────────────────────────────────────────
  void loadQuarkrc().then(applyRcDirectives).catch(() => { /* no rc file is fine */ });

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
    if (modeManager.current !== Mode.Insert) {
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
    showToast("Upload: not yet implemented", "info");
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

  input.onInput((value) => {
    if (modeManager.current !== Mode.Insert) return;

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

  // Refresh custom emoji when room changes
  AppState.on("currentRoomId", () => {
    void refreshCustomEmoji();
  });

  // ── Global keydown ──────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    const mode = modeManager.current;

    // Modal overlays with their own input (QuickReactPicker, etc.) handle all
    // their own keys with stopPropagation. The check here is a belt-and-
    // suspenders guard for the case where focus escapes the overlay element.
    if (quickReactPicker.isVisible()) return;
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
        pinnedMessagesDialog.isVisible() || roomDirectoryDialog.isVisible()) return;

    // Escape (or Ctrl+[) always resets to Normal (if not already) and clears sequences
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      modeManager.transition(Mode.Normal);
      keymapManager.resetSequence();
      commandBar.hide();
      AppState.close();
      return;
    }

    // Only intercept when logged in
    if (!AppState.get("loggedIn")) return;

    if (mode === Mode.Insert) {
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
