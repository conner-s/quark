// Keyboard orchestration — wires vim mode + keymaps to action dispatcher

import { modeManager, Mode } from "../vim/mode.js";
import { keymapManager } from "../vim/keybindings.js";
import type { AppComponents } from "../ui/App.js";
import {
  sendMessage,
  sendReaction,
  cancelReply,
  closeThread,
  openEmojiPicker,
  openGifPicker,
  openProfileDialog,
  executeCommand,
  toggleMemberList,
  startReply,
  redactMessage,
  openThread,
  openQuickReactPicker,
  setupReactionChipHandler,
  handleImagePaste,
} from "./actions.js";
import { AppState } from "./state.js";
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
  keymapManager.nmap("gg", "jump-top");
  keymapManager.nmap("G", "jump-bottom");
  keymapManager.nmap("r", "reply");
  keymapManager.nmap("e", "react");
  keymapManager.nmap("dd", "redact");
  keymapManager.nmap("E", "edit");
  keymapManager.nmap("t", "open-thread");
  keymapManager.nmap("m", "toggle-members");
  keymapManager.nmap("P", "open-profile");

  // Timeline context — tmap
  keymapManager.tmap("j", "nav-down");
  keymapManager.tmap("k", "nav-up");
  keymapManager.tmap("gg", "jump-top");
  keymapManager.tmap("G", "jump-bottom");
  keymapManager.tmap("r", "reply");
  keymapManager.tmap("e", "react");
  keymapManager.tmap("dd", "redact");
  keymapManager.tmap("E", "edit");
  keymapManager.tmap("t", "open-thread");

  // Room list context — rmap
  keymapManager.rmap("j", "nav-down");
  keymapManager.rmap("k", "nav-up");
  keymapManager.rmap("Enter", "select-room");
}

// ── Action dispatcher ─────────────────────────────────────────────────────────

function dispatchAction(action: string, components: AppComponents): void {
  const { input, commandBar, timeline, roomList } = components;

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

    // ── Navigation — routed by active panel ────────────────────────────
    case "nav-down":
      if (AppState.get("activePanel") === "roomlist") {
        roomList.navDown();
      } else {
        timeline.selectNext();
      }
      break;

    case "nav-up":
      if (AppState.get("activePanel") === "roomlist") {
        roomList.navUp();
      } else {
        timeline.selectPrev();
      }
      break;

    case "jump-top":
      if (AppState.get("activePanel") !== "roomlist") timeline.selectFirst();
      break;

    case "jump-bottom":
      if (AppState.get("activePanel") !== "roomlist") timeline.selectLast();
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
      const msgId = timeline.selectedMessageId;
      if (msgId) void openThread(msgId);
      break;
    }

    case "react": {
      const msgId = timeline.selectedMessageId;
      if (msgId) openQuickReactPicker(msgId);
      break;
    }

    case "edit":
    case "select-room":
      // Emit custom event for context-specific handlers that need more UI
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action } }));
      break;

    case "toggle-members":
      toggleMemberList();
      break;

    case "open-profile":
      void openProfileDialog();
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
        const idx = _customEmoji.length;
        _customEmoji.push({
          key: `:${entry.shortcode}:`,
          shortcode: entry.shortcode,
          imageUrl: entry.url, // may be mxc://, replaced below if so
        });
        if (entry.url.startsWith("mxc://")) {
          getThumbnail(entry.url, 32, 32).then((dl) => {
            if (_customEmoji[idx]) {
              _customEmoji[idx] = {
                ..._customEmoji[idx],
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

// ── Global keydown handler ────────────────────────────────────────────────────

export function setupKeyboard(components: AppComponents): void {
  registerDefaultBindings();

  // Wire quick react picker → sendReaction
  components.quickReactPicker.onReact((eventId, key) => {
    void sendReaction(eventId, key);
  });

  // Wire compose box action buttons
  components.input.onEmojiPickerClick(() => {
    modeManager.transition(Mode.Insert);
    components.input.focus();
    openEmojiPicker();
  });

  components.input.onAttachClick(() => {
    showToast("Upload: not yet implemented", "info");
  });

  // Wire image paste in compose field
  components.input.onImagePaste((blob) => {
    void handleImagePaste(blob);
  });

  // Wire reaction chip clicks (bubbling custom events) → sendReaction
  setupReactionChipHandler();

  const { input, commandBar, shortcodePreview, timeline,
          emojiPicker, gifPicker, stickerPicker, verification, helpDialog, quickReactPicker, profileDialog } = components;

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

  // Thread view close → closeThread
  components.threadView.onClose(() => {
    AppState.set("threadRootEventId", null);
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
    if (components.quickReactPicker.isVisible()) return;

    // Escape (or Ctrl+[) always resets to Normal (if not already) and clears sequences
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      modeManager.transition(Mode.Normal);
      keymapManager.resetSequence();
      commandBar.hide();
      emojiPicker.hide();
      gifPicker.hide();
      stickerPicker.hide();
      verification.hide();
      helpDialog.hide();
      quickReactPicker.hide();
      profileDialog.hide();
      timeline.clearSelection();
      cancelReply();
      closeThread();
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

    // Left/Right arrows switch focus between panels
    if (e.key === "ArrowLeft" && AppState.get("activePanel") === "timeline") {
      e.preventDefault();
      AppState.set("activePanel", "roomlist");
      components.roomList.focusActive();
      return;
    }
    if (e.key === "ArrowRight" && AppState.get("activePanel") === "roomlist") {
      e.preventDefault();
      AppState.set("activePanel", "timeline");
      return;
    }

    // Normal / Visual — resolve through keymap
    const activeContext = AppState.get("activePanel") === "timeline" ? "timeline" as const
      : AppState.get("activePanel") === "roomlist" ? "roomlist" as const
      : "global" as const;

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
