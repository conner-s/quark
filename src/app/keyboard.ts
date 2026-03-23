// Keyboard orchestration — wires vim mode + keymaps to action dispatcher

import { modeManager, Mode } from "../vim/mode.js";
import { keymapManager } from "../vim/keybindings.js";
import type { AppComponents } from "../ui/App.js";
import {
  sendMessage,
  cancelReply,
  openEmojiPicker,
  openGifPicker,
  executeCommand,
  toggleMemberList,
} from "./actions.js";
import { AppState } from "./state.js";

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
  const { input, commandBar } = components;

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

    case "nav-down":
    case "nav-up":
    case "jump-top":
    case "jump-bottom":
    case "reply":
    case "react":
    case "redact":
    case "edit":
    case "open-thread":
    case "select-room":
      // Emit custom event for context-specific handlers to consume
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action } }));
      break;

    case "toggle-members":
      toggleMemberList();
      break;

    default:
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action } }));
      break;
  }
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
    const body = input.getValue().trim();
    if (body) {
      void sendMessage(body);
    }
    modeManager.transition(Mode.Normal);
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

  const { input, commandBar } = components;

  // Sync mode indicators
  modeManager.on((_from, to) => {
    input.setMode(to);
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

  // Global keydown
  document.addEventListener("keydown", (e) => {
    const mode = modeManager.current;

    // Escape always resets to Normal (if not already) and clears sequences
    if (e.key === "Escape") {
      modeManager.transition(Mode.Normal);
      keymapManager.resetSequence();
      commandBar.hide();
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
    const activeContext = AppState.get("activePanel") === "timeline" ? "timeline" as const
      : AppState.get("activePanel") === "roomlist" ? "roomlist" as const
      : "global" as const;

    const result = keymapManager.resolveKey(e.key, activeContext);

    if (result.kind === "action") {
      e.preventDefault();
      dispatchAction(result.action, components);
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
    // "none" — pass through
  });
}
