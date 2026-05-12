// Text-selection submode — orthogonal to vim Normal/Visual modes.
//
// Two targets exist:
//
//   "message" — caret is placed inside a timeline message body via `o`. Users
//     can move the caret with arrows/h/j/k/l, extend selection with `v`, and
//     act on the selection with `y` (copy) or `>` (quote into compose).
//
//   "compose" — caret stays in the compose field when leaving Insert mode while
//     the compose box is non-empty. Users can navigate/select in the compose
//     box and use `p` to paste at the caret position.
//
// Routing is done in keyboard.ts via `handleTextSelectKeydown`. This module
// owns the lifecycle (enter/exit, DOM mutations) and the selection helpers.

import { AppState } from "./state.js";
import { modeManager, Mode } from "../vim/mode.js";
import { showToast } from "../ui/NotificationToast.js";
import type { AppComponents } from "../ui/App.js";

/** The message body element currently in text-select mode (null when on compose). */
let _messageBodyEl: HTMLElement | null = null;
/** Saved attributes restored on exit. */
let _savedContentEditable: string | null = null;
let _savedTabIndex: string | null = null;

/**
 * Enter text-select mode on the given timeline message body.
 *
 * Makes the body contenteditable so the browser maintains a real caret —
 * we trap inserting keys at the keyboard layer, so it's effectively read-only.
 */
export function enterMessageTextSelect(bodyEl: HTMLElement): void {
  // If we're already in some text-select mode, exit it first so state is clean.
  exitTextSelect();

  _messageBodyEl = bodyEl;
  _savedContentEditable = bodyEl.getAttribute("contenteditable");
  _savedTabIndex = bodyEl.getAttribute("tabindex");

  bodyEl.classList.add("message__body--text-select");
  bodyEl.setAttribute("contenteditable", "true");
  bodyEl.setAttribute("tabindex", "0");
  bodyEl.setAttribute("spellcheck", "false");
  bodyEl.focus();

  // Place caret at the start of the body so movement keys work predictably.
  const sel = window.getSelection();
  if (sel && bodyEl.firstChild) {
    const range = document.createRange();
    range.setStart(bodyEl.firstChild, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  AppState.set("textSelectMode", "message");
}

/**
 * Enter text-select mode on the compose box. The caller is expected to have
 * already focused the field — this just records the submode and ensures the
 * vim mode is Normal (so j/k etc. don't get typed into the input).
 */
export function enterComposeTextSelect(): void {
  // Don't blow away an active message-target selection silently.
  if (AppState.get("textSelectMode") === "message") exitTextSelect();
  AppState.set("textSelectMode", "compose");
}

/**
 * Exit text-select mode. Restores the message body's editable/tabindex state,
 * clears the selection, and resets state.
 */
export function exitTextSelect(): void {
  if (AppState.get("textSelectMode") === null) return;

  if (_messageBodyEl) {
    _messageBodyEl.classList.remove("message__body--text-select");
    if (_savedContentEditable === null) {
      _messageBodyEl.removeAttribute("contenteditable");
    } else {
      _messageBodyEl.setAttribute("contenteditable", _savedContentEditable);
    }
    if (_savedTabIndex === null) {
      _messageBodyEl.removeAttribute("tabindex");
    } else {
      _messageBodyEl.setAttribute("tabindex", _savedTabIndex);
    }
    _messageBodyEl.removeAttribute("spellcheck");
    _messageBodyEl.blur();

    // Drop any text selection inside the message so navigation feels clean.
    const sel = window.getSelection();
    if (sel && _messageBodyEl.contains(sel.anchorNode)) {
      sel.removeAllRanges();
    }
    _messageBodyEl = null;
  }

  _savedContentEditable = null;
  _savedTabIndex = null;
  AppState.set("textSelectMode", null);
}

/**
 * Returns the currently selected text within the active text-select target,
 * or an empty string if no selection exists.
 *
 * For "compose" target we read from the input element's selection range so
 * the result is unaffected by anything else focused on the page.
 */
export function getSelectedText(input: HTMLInputElement): string {
  const target = AppState.get("textSelectMode");
  if (target === "message") {
    return window.getSelection()?.toString() ?? "";
  }
  if (target === "compose") {
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    return input.value.slice(start, end);
  }
  return "";
}

/**
 * Copy the current text-selection to the clipboard and show a brief toast.
 * No-op if nothing is selected.
 */
export function copyTextSelection(components: AppComponents): void {
  const text = getSelectedText(components.input.getFieldElement());
  if (!text) {
    showToast("No text selected");
    return;
  }
  void navigator.clipboard.writeText(text).then(() => {
    showToast("Copied selection");
  });
}

/**
 * Insert the current selection into the compose box prefixed with markdown
 * quote markers (one `> ` per line). Exits text-select mode and switches to
 * Insert so the user can continue typing immediately.
 *
 * No-op if nothing is selected.
 */
export function quoteTextSelectionIntoCompose(components: AppComponents): void {
  const { input } = components;
  const text = getSelectedText(input.getFieldElement());
  if (!text) {
    showToast("No text selected");
    return;
  }

  // Prefix each line with "> " — covers multi-line selections cleanly.
  const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");

  const existing = input.getValue();
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  input.setValue(existing + sep + quoted + "\n");

  exitTextSelect();
  modeManager.transition(Mode.Insert);
  input.focus();
  // Move caret to end so the user types after the quote.
  const field = input.getFieldElement();
  const len = field.value.length;
  field.selectionStart = field.selectionEnd = len;
}

/**
 * Paste clipboard text into the compose box at the current caret position.
 * Used by 'p' in Normal+text-select-compose mode.
 */
export async function pasteAtComposeCursor(components: AppComponents): Promise<void> {
  const { input } = components;
  const field = input.getFieldElement();

  let clipboardText = "";
  try {
    clipboardText = await navigator.clipboard.readText();
  } catch {
    showToast("Clipboard read denied");
    return;
  }
  if (!clipboardText) return;

  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  const newValue = field.value.slice(0, start) + clipboardText + field.value.slice(end);
  field.value = newValue;
  const caret = start + clipboardText.length;
  field.selectionStart = field.selectionEnd = caret;
  // Fire input event so any listeners (mention/shortcode autocomplete) update.
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Extend (or move, in Normal) the selection by the given granularity and
 * direction. Used by Visual mode in text-select to grow the selection with
 * h/j/k/l. Only applies to "message" target — compose uses the input's
 * native selection model elsewhere.
 */
export function modifyMessageSelection(
  alter: "move" | "extend",
  direction: "forward" | "backward",
  granularity: "character" | "line" | "word"
): void {
  const sel = window.getSelection();
  if (!sel || !_messageBodyEl) return;
  // Anchor the selection inside our body if it's somehow drifted out.
  if (!sel.anchorNode || !_messageBodyEl.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.setStart(_messageBodyEl.firstChild ?? _messageBodyEl, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  sel.modify(alter, direction, granularity);
}

/**
 * Extend or move the input field's selection by one character/word.
 * Used in compose-box text-select mode for keyboard movement.
 */
export function modifyComposeSelection(
  input: HTMLInputElement,
  alter: "move" | "extend",
  direction: "forward" | "backward",
  granularity: "character" | "word"
): void {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  const value = input.value;

  // Anchor is the side that doesn't move when extending. With selectionDirection
  // = "forward", the anchor is at `start` and the focus is at `end` (and vice
  // versa for "backward"). We compute the new focus position and let the
  // anchor follow only when `alter === "move"`.
  const dir = input.selectionDirection === "backward" ? "backward" : "forward";
  const focusPos = dir === "forward" ? end : start;
  const anchorPos = dir === "forward" ? start : end;

  let newFocus = focusPos;
  if (granularity === "character") {
    newFocus = direction === "forward"
      ? Math.min(value.length, focusPos + 1)
      : Math.max(0, focusPos - 1);
  } else {
    // Word: scan past whitespace then word chars.
    if (direction === "forward") {
      let i = focusPos;
      while (i < value.length && /\s/.test(value[i])) i++;
      while (i < value.length && !/\s/.test(value[i])) i++;
      newFocus = i;
    } else {
      let i = focusPos;
      while (i > 0 && /\s/.test(value[i - 1])) i--;
      while (i > 0 && !/\s/.test(value[i - 1])) i--;
      newFocus = i;
    }
  }

  if (alter === "move") {
    input.selectionStart = input.selectionEnd = newFocus;
  } else {
    // Keep the anchor pinned; the new focus may be on either side of it.
    const lo = Math.min(anchorPos, newFocus);
    const hi = Math.max(anchorPos, newFocus);
    input.selectionStart = lo;
    input.selectionEnd = hi;
    input.selectionDirection = newFocus >= anchorPos ? "forward" : "backward";
  }
}
