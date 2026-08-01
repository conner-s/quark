// Right-click / long-press menus.
//
// Split out of keyboard.ts: the converged context-menu design turned four
// flat `contextMenu.show(x, y, [...])` literals into grouped menus with header
// bars, section strips, formatting toggles and enable/disable rules. That is
// menu *content*, not key routing, and it was going to be the largest single
// block in an already 1400-line module.
//
// Two menus carry the design's full shape:
//
//   compose — right-click inside the compose box. The only place formatting
//     appears: you are editing text you own, so the chip row and the markdown
//     groups are in scope.
//   message — right-click (or long-press) a message. Same shell, no
//     formatting: you are not editing text here.
//
// Both wear identical chrome. That is the point — the menu never borrows the
// styling of whatever it was summoned from.

import { modeManager, Mode } from "../vim/mode.js";
import { AppState } from "./state.js";
import { openExternalUrl } from "./links.js";
import { showToast } from "../ui/NotificationToast.js";
import type { AppComponents } from "../ui/App.js";
import type { ContextMenuChip, ContextMenuEntry } from "../ui/ContextMenu.js";
import type { Input } from "../ui/Input.js";
import {
  cancelEdit,
  cancelReply,
  openDebugViewerForEvent,
  openEmojiPicker,
  openGifPicker,
  openQuickReactPicker,
  openRoomInfo,
  openRoomSettings,
  openSpaceSettings,
  openThread,
  redactMessage,
  resolveDisplayName,
  selectRoom,
  startEdit,
  startReply,
} from "./actions.js";

/** Longest query echoed back inside a menu label before it gets an ellipsis. */
const QUERY_LABEL_MAX = 28;

/**
 * The formatting toggles, in the order the design lays them out. `excludes`
 * guards the single-character markers: `*text*` and `**text**` both end in a
 * `*` on each side, so the italic chip must not light up on bold text.
 */
const FORMAT_CHIPS: ReadonlyArray<{
  label: string;
  title: string;
  marker: string;
  closing?: string;
  excludes?: string;
  accent?: boolean;
}> = [
  { label: "B", title: "Bold — **text**", marker: "**" },
  { label: "I", title: "Italic — *text*", marker: "*", excludes: "**" },
  { label: "U", title: "Underline — __text__", marker: "__" },
  { label: "S", title: "Strikethrough — ~~text~~", marker: "~~" },
  { label: "‖", title: "Spoiler — ||text||", marker: "||" },
  { label: "`", title: "Inline code — `text`", marker: "`", accent: true },
];

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

function webSearch(query: string): void {
  openExternalUrl(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
}

function copyToClipboard(text: string, toast: string): void {
  if (!text) return;
  void navigator.clipboard.writeText(text).then(
    () => showToast(toast),
    () => showToast("Clipboard unavailable"),
  );
}

/** Read the clipboard's text flavour, or "" when it holds none / is blocked. */
async function readClipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    showToast("Clipboard unavailable");
    return "";
  }
}

/**
 * Stage the first image on the clipboard, if there is one. Mirrors the compose
 * field's own paste handler so menu-driven Paste behaves like Ctrl+V.
 */
async function pasteClipboardImage(input: Input): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) return false;
  try {
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          input.showImagePreview(await item.getType(type));
          return true;
        }
      }
    }
  } catch {
    // No image flavour, or the read was refused — fall through to text.
  }
  return false;
}

// ── Compose menu ──────────────────────────────────────────────────────────────

function formatChips(input: Input): ContextMenuChip[] {
  return FORMAT_CHIPS.map((spec) => ({
    label: spec.label,
    title: spec.title,
    accent: spec.accent,
    // A predicate, not a snapshot: the chip row stays open across activations
    // so its lit state has to be re-derived after every toggle.
    active: () =>
      input.isSelectionWrapped(spec.marker, spec.closing) &&
      !(spec.excludes && input.isSelectionWrapped(spec.excludes)),
    action: () => input.toggleWrap(spec.marker, spec.closing),
  }));
}

/**
 * Clear the whole in-progress composition: typed text, a pending edit or
 * reply, and any staged image. One undo step restores the text.
 */
function discardDraft(input: Input): void {
  input.pushUndoSnapshot();
  input.setValue("");
  input.discardPendingImage();
  cancelEdit();
  cancelReply();
  showToast("Draft discarded");
}

export function composeEntries(components: AppComponents): ContextMenuEntry[] {
  const { input } = components;
  const selection = input.getSelectedText();
  const hasSelection = selection.length > 0;
  const entries: ContextMenuEntry[] = [];

  // Formatting only makes sense against a selection — with a collapsed caret
  // every toggle would just drop an empty marker pair into the draft.
  if (hasSelection) {
    entries.push({ section: "format" }, { chips: formatChips(input) });
  }

  entries.push(
    { section: "clipboard" },
    {
      label: "Cut",
      hint: "Ctrl+X",
      disabled: !hasSelection,
      action: () => {
        copyToClipboard(input.getSelectedText(), "Cut");
        input.replaceSelection("");
      },
    },
    {
      label: "Copy",
      hint: "Ctrl+C",
      disabled: !hasSelection,
      action: () => copyToClipboard(input.getSelectedText(), "Copied"),
    },
    {
      label: "Paste",
      hint: "Ctrl+V",
      action: () => {
        void pasteClipboardImage(input).then(async (staged) => {
          if (staged) return;
          const text = await readClipboardText();
          if (text) input.replaceSelection(text);
        });
      },
    },
    {
      label: "Paste as plain text",
      hint: "⇧Ctrl+V",
      action: () => {
        void readClipboardText().then((text) => {
          if (text) input.replaceSelection(escapeMarkdown(text));
        });
      },
    },
  );

  if (hasSelection) {
    entries.push(
      { section: "selection" },
      {
        label: `Search web for “${labelQuery(selection)}”`,
        hint: "↗",
        action: () => webSearch(selection),
      },
      {
        label: "Copy as quote",
        hint: ">",
        action: () => copyToClipboard(asQuote(selection), "Copied as quote"),
      },
    );
  }

  entries.push(
    { section: "insert" },
    { label: "Emoji…", hint: "Ctrl-e", action: () => openEmojiPicker() },
    { label: "GIF…", hint: "Ctrl-g", action: () => openGifPicker() },
    { label: "Attach file…", action: () => input.openFilePicker() },
    {
      label: "Mention…",
      hint: "@",
      action: () => {
        // Autocomplete keys off the compose `input` event in Insert mode, and
        // only treats an `@` at a word boundary as the start of a query.
        modeManager.transition(Mode.Insert);
        input.focus();
        const { start } = input.getSelectionRange();
        const prev = input.getValue().slice(0, start).slice(-1);
        input.replaceSelection(prev && !/\s/.test(prev) ? " @" : "@");
      },
    },
    { section: "draft" },
    {
      label: "Undo",
      hint: "u",
      disabled: !input.canUndo(),
      action: () => void input.undo(),
    },
    {
      label: "Discard draft",
      danger: true,
      disabled: input.getValue().length === 0 && !input.hasPendingImage(),
      action: () => discardDraft(input),
    },
  );

  return entries;
}

/** Right-click inside the compose box. */
export function showComposeContextMenu(components: AppComponents, x: number, y: number): void {
  components.contextMenu.show(x, y, composeEntries(components), { title: "compose" });
}

// ── Message menu ──────────────────────────────────────────────────────────────

export function messageEntries(
  components: AppComponents,
  eventId: string,
  selection: string,
): ContextMenuEntry[] {
  const { input, timeline } = components;
  const evt = AppState.get("currentTimeline").find((ev) => ev.event_id === eventId);
  const ownUserId = AppState.get("ownUserId");
  const isOwn = !!evt && !!ownUserId && evt.sender === ownUserId;
  const body = () => timeline.getMessageBodyById(eventId) ?? evt?.body ?? "";

  const entries: ContextMenuEntry[] = [
    { section: "respond" },
    {
      label: "Reply",
      hint: "r",
      action: () => {
        if (!evt) return;
        startReply(eventId, evt.sender, evt.body.slice(0, 80));
        input.focus();
      },
    },
    { label: "React", hint: "e", action: () => openQuickReactPicker(eventId) },
    { label: "Thread", hint: "t", action: () => void openThread(eventId) },

    { section: "clipboard" },
    {
      label: "Copy message text",
      hint: "y",
      action: () => copyToClipboard(evt?.body ?? "", "Copied message"),
    },
    {
      label: "Copy as quote",
      hint: ">",
      action: () => copyToClipboard(asQuote(evt?.body ?? ""), "Copied as quote"),
    },
  ];

  if (selection) {
    entries.push(
      { section: "selection" },
      {
        label: `Search web for “${labelQuery(selection)}”`,
        hint: "↗",
        action: () => webSearch(selection),
      },
      {
        label: "Copy selected text",
        hint: "Ctrl+C",
        action: () => copyToClipboard(selection, "Copied selection"),
      },
    );
  }

  // Edit / Delete stay visible on someone else's message, greyed rather than
  // dropped: a row that simply isn't there reads as a missing feature.
  entries.push(
    { section: "event" },
    {
      label: "View raw event",
      hint: ":debug",
      action: () => void openDebugViewerForEvent(eventId),
    },
    {
      label: "Edit",
      hint: "E",
      disabled: !isOwn,
      action: () => {
        // Prefer the MessageData body (reflects applied edits) over the raw
        // timeline event.
        startEdit(eventId, body());
        modeManager.transition(Mode.Insert);
        input.focus();
      },
    },
    {
      label: "Delete",
      hint: "dd",
      disabled: !isOwn,
      action: () => void redactMessage(eventId),
    },
  );

  return entries;
}

/**
 * Right-click / long-press on a timeline message. Both the desktop menu and
 * the mobile long-press sheet flow through here, so this is the single place
 * that gives finger-input users a way to delete/edit.
 */
export function showMessageContextMenu(
  components: AppComponents,
  eventId: string,
  x: number,
  y: number,
  selection: string,
): void {
  const evt = AppState.get("currentTimeline").find((ev) => ev.event_id === eventId);
  const sender = evt ? resolveDisplayName(evt.sender) : "";
  components.contextMenu.show(x, y, messageEntries(components, eventId, selection), {
    title: sender ? `message · ${sender}` : "message",
  });
}

// ── Room list & space strip ───────────────────────────────────────────────────

/** Right-click a room in the room list. */
export function showRoomContextMenu(
  components: AppComponents,
  roomId: string,
  x: number,
  y: number,
): void {
  const room = AppState.get("roomListCache").find((r) => r.room_id === roomId);
  components.contextMenu.show(
    x,
    y,
    [
      { label: "Open", action: () => void selectRoom(roomId) },
      { separator: true },
      {
        label: "Room settings",
        action: () => void selectRoom(roomId).then(() => openRoomSettings()),
      },
      {
        label: "Room info",
        action: () => void selectRoom(roomId).then(() => openRoomInfo()),
      },
      ...(room && room.unread_count > 0
        ? ([
            { separator: true } as const,
            { label: "Mark as read", action: () => void selectRoom(roomId) },
          ] as ContextMenuEntry[])
        : []),
    ],
    { title: room?.name ? `room · ${room.name}` : "room" },
  );
}

/** Right-click a subspace section label in the room list, or a space icon. */
export function showSpaceContextMenu(
  components: AppComponents,
  spaceId: string,
  x: number,
  y: number,
): void {
  components.contextMenu.show(
    x,
    y,
    [{ label: "Space settings", action: () => void openSpaceSettings(spaceId) }],
    { title: "space" },
  );
}
