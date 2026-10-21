// Resolves how the compose box's Enter key behaves and whether the dedicated
// send button is shown, from the `general.send_key_behavior` preference and the
// current platform (and, for Enter, whether the caret is in a code fence). See
// GeneralConfig.send_key_behavior. Also whether the autocomplete popups may
// open, since an open popup claims Enter before any of this is consulted.

import { AppState } from "./state.js";
import { isMobile } from "./mobile.js";
import { insideCodeFence } from "./markdown.js";

/**
 * Whether pressing Enter (without Shift) sends the message.
 *  - "enter":   always sends.
 *  - "newline": never sends (Enter inserts a newline; send via the button or
 *               Ctrl/Cmd+Enter).
 *  - "auto":    sends on desktop, inserts a newline on mobile.
 */
export function effectiveSendOnEnter(): boolean {
  switch (AppState.get("sendKeyBehavior")) {
    case "enter": return true;
    case "newline": return false;
    case "auto":
    default: return !isMobile();
  }
}

/**
 * Whether a bare Enter sends, for the compose box's text and caret. As
 * {@link effectiveSendOnEnter}, except that with the caret inside an open ```
 * fence Enter always inserts a newline: code runs over many lines, and the
 * Discord/Slack convention is to keep typing it until the fence closes.
 * Ctrl/Cmd+Enter still sends from anywhere (keyboard.ts).
 */
export function enterSends(value: string, caret: number = value.length): boolean {
  return effectiveSendOnEnter() && !insideCodeFence(value, caret);
}

/**
 * Whether the shortcode and mention autocompletes may open. Not in a ```
 * fence: each popup claims Enter while open, and there Enter means a newline
 * ({@link enterSends}) — while `:` and `@` are everyday code characters (a Nix
 * `a:b:a+b`, a decorator), not shortcodes or mentions.
 *
 * Both the caret and the end of the text count. The caret is where Enter
 * lands, but the query is read from the end of the text, and a completion is
 * written there (autocomplete_query.ts, keyboard.ts): with the message ending
 * in an open fence, a popup opened while the caret edits the prose above would
 * rewrite the code at the end.
 */
export function autocompleteAllowed(value: string, caret: number = value.length): boolean {
  return !insideCodeFence(value, caret) && !insideCodeFence(value);
}

/**
 * Whether to show the dedicated send button. Always shown on mobile (touch needs
 * a tap target), and on desktop only when Enter does not send — so "newline"
 * mode always has a visible way to send.
 */
export function shouldShowSendButton(): boolean {
  return isMobile() || !effectiveSendOnEnter();
}
