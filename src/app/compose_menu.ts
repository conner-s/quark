// Behaviour behind the compose-box context menu, and the clipboard and
// selection helpers the message menu shares with it.
//
// The rows themselves — labels, grouping, the formatting chips — are the
// registry's (see the "compose" surface there); this module only says what
// each id does to the compose box.

import { modeManager, Mode } from "../vim/mode.js";
import { openExternalUrl } from "./links.js";
import { showToast } from "../ui/NotificationToast.js";
import type { Input } from "../ui/Input.js";
import type { MenuHandlers, MenuRow } from "./context_menus.js";
import { cancelEdit, cancelReply, openEmojiPicker, openGifPicker } from "./actions.js";

/** Longest query echoed back inside a menu label before it gets an ellipsis. */
const QUERY_LABEL_MAX = 28;

/**
 * Markdown markers per formatting action. `excludes` guards the
 * single-character markers: `*text*` and `**text**` both end in a `*` on each
 * side, so the italic chip must not light up on bold text.
 */
export const FORMAT_MARKERS: Readonly<Record<string, { marker: string; excludes?: string }>> = {
  "format-bold": { marker: "**" },
  "format-italic": { marker: "*", excludes: "**" },
  "format-underline": { marker: "__" },
  "format-strikethrough": { marker: "~~" },
  "format-spoiler": { marker: "||" },
  "format-code": { marker: "`" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collapse whitespace and clip, for echoing a selection inside a menu label. */
export function labelQuery(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > QUERY_LABEL_MAX ? `${flat.slice(0, QUERY_LABEL_MAX)}…` : flat;
}

/** Prefix every line with a markdown quote marker. */
export function asQuote(text: string): string {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}

/**
 * Escape the markdown a pasted string would otherwise be parsed as. Backs
 * "Paste as plain text": the same characters, but arriving literally instead
 * of turning half the paste into emphasis.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\`*_~|])/g, "\\$1")
    .replace(/^([>#\-+])/gm, "\\$1");
}

export function copyToClipboard(text: string, toast: string): void {
  if (!text) return;
  void navigator.clipboard.writeText(text).then(
    () => showToast(toast),
    () => showToast("Clipboard unavailable"),
  );
}

/** The "Search web for …" row, labelled with the query it will run. */
export function searchWebRow(selection: string): MenuRow {
  return {
    label: `Search web for “${labelQuery(selection)}”`,
    action: () => openExternalUrl(`https://duckduckgo.com/?q=${encodeURIComponent(selection)}`),
  };
}

/**
 * Clear the whole in-progress composition: typed text, a pending edit or
 * reply, and any staged attachments. One undo step restores the text.
 */
function discardDraft(input: Input): void {
  input.pushUndoSnapshot();
  input.setValue("");
  input.discardStagedAttachments();
  cancelEdit();
  cancelReply();
  showToast("Draft discarded");
}

// ── Compose menu ──────────────────────────────────────────────────────────────

/** Handlers for the compose surface, read against the box's state right now. */
export function composeMenuHandlers(input: Input): MenuHandlers {
  const selection = input.getSelectedText();
  const hasSelection = selection.length > 0;
  const handlers: MenuHandlers = {};

  // Formatting only makes sense against a selection — with a collapsed caret
  // every toggle would just drop an empty marker pair into the draft.
  if (hasSelection) {
    for (const [id, { marker, excludes }] of Object.entries(FORMAT_MARKERS)) {
      handlers[id] = {
        action: () => input.toggleWrap(marker),
        active: () =>
          input.isSelectionWrapped(marker) && !(excludes && input.isSelectionWrapped(excludes)),
      };
    }
    handlers["search-web"] = searchWebRow(selection);
    handlers["copy-as-quote"] = () => copyToClipboard(asQuote(selection), "Copied as quote");
  }

  handlers["cut"] = {
    disabled: !hasSelection,
    action: () => {
      copyToClipboard(input.getSelectedText(), "Cut");
      input.replaceSelection("");
    },
  };
  handlers["copy-selection"] = {
    disabled: !hasSelection,
    action: () => copyToClipboard(input.getSelectedText(), "Copied"),
  };
  handlers["paste"] = () => void input.pasteFromClipboard();
  handlers["paste-plain"] = () => {
    void navigator.clipboard.readText().then(
      (text) => { if (text) input.replaceSelection(escapeMarkdown(text)); },
      () => showToast("Clipboard unavailable"),
    );
  };

  handlers["open-emoji-picker"] = () => openEmojiPicker();
  handlers["open-gif-picker"] = () => openGifPicker();
  handlers["attach-file"] = () => input.openFilePicker();
  handlers["insert-mention"] = () => {
    // Autocomplete keys off the compose `input` event in Insert mode, and only
    // treats an `@` at a word boundary as the start of a query.
    modeManager.transition(Mode.Insert);
    input.focus();
    const { start } = input.getSelectionRange();
    const prev = input.getValue().slice(0, start).slice(-1);
    input.replaceSelection(prev && !/\s/.test(prev) ? " @" : "@");
  };

  handlers["compose-undo"] = { disabled: !input.canUndo(), action: () => void input.undo() };
  handlers["discard-draft"] = {
    disabled: input.getValue().length === 0 && !input.hasStagedAttachments(),
    action: () => discardDraft(input),
  };

  return handlers;
}
