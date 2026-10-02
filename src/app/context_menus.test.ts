import { describe, it, expect, beforeEach } from "vitest";
import { keymapManager } from "../vim/keybindings";
import { registerDefaultBindings, type AvailabilityContext } from "./registry";
import { buildMenu, type MenuHandlers } from "./context_menus";
import type { ContextMenuItem } from "../ui/ContextMenu";

const ctx = (over: Partial<AvailabilityContext> = {}): AvailabilityContext => ({
  loggedIn: true,
  roomId: "!room:example.org",
  spaceId: "!space:example.org",
  selectedMessageId: "$evt",
  selectedMessageIsOwn: true,
  isMobile: false,
  ...over,
});

const noop = () => { /* behaviour is irrelevant to these assertions */ };

const MESSAGE_HANDLERS: MenuHandlers = {
  "reply": noop,
  "react": noop,
  "open-thread": noop,
  "copy-message": noop,
  "view-raw-event": noop,
  "edit": noop,
  "redact": noop,
};

/**
 * Labels in order: "──" for a separator, "[title]" for a section header, and
 * "chips(BIU)" for a chip row by glyph.
 */
const shape = (entries: ReturnType<typeof buildMenu>): string[] =>
  entries.map((e) => {
    if ("section" in e) return `[${e.section}]`;
    if ("chips" in e) return `chips(${e.chips.map((c) => c.label).join("")})`;
    return e.separator ? "──" : e.label;
  });

/** The item row with this label, or undefined. */
const item = (entries: ReturnType<typeof buildMenu>, label: string): ContextMenuItem | undefined =>
  entries.find((e): e is ContextMenuItem => "label" in e && e.label === label);

beforeEach(() => {
  for (const entry of keymapManager.getEntries()) {
    keymapManager.unmap(entry.context, entry.sequence);
  }
  registerDefaultBindings();
});

describe("buildMenu", () => {
  it("heads each message-menu group with its section title", () => {
    expect(shape(buildMenu("message", ctx(), MESSAGE_HANDLERS))).toEqual([
      "[respond]", "Reply", "React", "Thread",
      "[clipboard]", "Copy message text",
      "[event]", "View raw event", "Edit", "Delete",
    ]);
  });

  // A row that silently isn't there reads as a missing feature, so the
  // registry marks these two as greyed rather than hidden.
  it("greys own-message rows on someone else's message instead of dropping them", () => {
    const entries = buildMenu("message", ctx({ selectedMessageIsOwn: false }), MESSAGE_HANDLERS);
    expect(shape(entries)).toContain("Edit");
    expect(item(entries, "Edit")?.disabled).toBe(true);
    expect(item(entries, "Delete")?.disabled).toBe(true);
    expect(item(entries, "Reply")?.disabled).toBeUndefined();
  });

  it("drops rows the caller supplies no handler for", () => {
    const entries = buildMenu("message", ctx(), { "reply": noop, "redact": noop });
    expect(shape(entries)).toEqual(["[respond]", "Reply", "[event]", "Delete"]);
  });

  it("marks destructive rows", () => {
    expect(item(buildMenu("message", ctx(), MESSAGE_HANDLERS), "Delete")?.danger).toBe(true);
  });

  // A group emptied by filtering must not leave its heading or rule behind.
  it("never emits an empty section, or a leading, trailing or doubled separator", () => {
    for (const [surface, handlers] of [
      ["message", MESSAGE_HANDLERS],
      ["message", { "reply": noop }],
      ["message", { "redact": noop }],
      ["room", { "open-room": noop, "mark-room-read": noop }],
      ["room", { "mark-room-read": noop }],
      ["message", {}],
    ] as const) {
      const s = shape(buildMenu(surface, ctx(), handlers as MenuHandlers));
      expect(s[0]).not.toBe("──");
      expect(s[s.length - 1] ?? "").not.toMatch(/^(──|\[)/);
      for (let i = 1; i < s.length; i++) {
        expect(/^(──|\[)/.test(s[i]) && /^(──|\[)/.test(s[i - 1])).toBe(false);
      }
    }
  });

  it("returns nothing when no handler is supplied", () => {
    expect(buildMenu("message", ctx(), {})).toEqual([]);
  });

  it("labels rows with the live keybinding, not the registry default", () => {
    const hintFor = (label: string) => item(buildMenu("message", ctx(), MESSAGE_HANDLERS), label)?.hint;
    expect(hintFor("Delete")).toBe("dd");

    keymapManager.unmap("global", "dd");
    keymapManager.map("global", "xx", "redact", false);
    expect(hintFor("Delete")).toBe("xx");
  });

  it("omits the hint for an action with no binding", () => {
    const raw = item(buildMenu("message", ctx(), MESSAGE_HANDLERS), "View raw event");
    expect(raw).toBeDefined();
    expect(raw?.hint).toBeUndefined();
  });

  it("falls back to the registry's fixed hint for a platform-owned key", () => {
    const entries = buildMenu("message", ctx(), { "copy-selection": noop });
    expect(item(entries, "Copy selected text")?.hint).toBe("Ctrl-c");
  });

  it("lets a caller relabel a row that echoes its target", () => {
    const entries = buildMenu("message", ctx(), {
      "search-web": { label: "Search web for “quark”", action: noop },
    });
    expect(shape(entries)).toEqual(["[selection]", "Search web for “quark”"]);
  });
});

describe("compose menu", () => {
  const ALL: MenuHandlers = {
    "format-bold": noop, "format-italic": noop, "format-underline": noop,
    "format-strikethrough": noop, "format-spoiler": noop, "format-code": noop,
    "cut": noop, "copy-selection": noop, "paste": noop, "paste-plain": noop,
    "search-web": noop, "copy-as-quote": noop,
    "open-emoji-picker": noop, "open-gif-picker": noop, "attach-file": noop, "insert-mention": noop,
    "compose-undo": noop, "discard-draft": noop,
  };
  const composeCtx = () => ctx({ selectedMessageId: null, selectedMessageIsOwn: false });

  it("lays out the converged design", () => {
    expect(shape(buildMenu("compose", composeCtx(), ALL))).toEqual([
      "[format]", "chips(BIUS‖`)",
      "[clipboard]", "Cut", "Copy", "Paste", "Paste as plain text",
      "[selection]", "Search web", "Copy as quote",
      "[insert]", "Emoji…", "GIF…", "Attach file…", "Mention…",
      "[draft]", "Undo", "Discard draft",
    ]);
  });

  it("titles each chip with its markdown and live binding", () => {
    const entries = buildMenu("compose", composeCtx(), { "format-bold": noop, "format-code": noop });
    const row = entries.find((e) => "chips" in e);
    expect(row && "chips" in row ? row.chips.map((c) => c.title) : []).toEqual([
      "Bold — **text**  Ctrl-b",
      "Inline code — `text`",
    ]);
    expect(row && "chips" in row ? row.chips[1].accent : false).toBe(true);
  });

  it("passes a chip's active predicate through", () => {
    const active = () => true;
    const entries = buildMenu("compose", composeCtx(), { "format-bold": { action: noop, active } });
    const row = entries.find((e) => "chips" in e);
    expect(row && "chips" in row ? row.chips[0].active : undefined).toBe(active);
  });

  it("greys a row its caller marks disabled", () => {
    const entries = buildMenu("compose", composeCtx(), { "cut": { action: noop, disabled: true } });
    expect(item(entries, "Cut")).toMatchObject({ disabled: true, hint: "Ctrl-x" });
  });
});

describe("other surfaces", () => {

  it("offers Mark as read only when the caller passes its handler", () => {
    const base: MenuHandlers = {
      "open-room": noop,
      "open-room-settings": noop,
      "open-room-info": noop,
    };
    expect(shape(buildMenu("room", ctx(), base))).toEqual([
      "Open", "──", "Room settings", "Room info",
    ]);
    expect(shape(buildMenu("room", ctx(), { ...base, "mark-room-read": noop }))).toEqual([
      "Open", "──", "Room settings", "Room info", "──", "Mark as read",
    ]);
  });

  it("evaluates requirements against the menu's target, not the open room", () => {
    // The room menu passes the room under the cursor; with none supplied, the
    // room-scoped rows drop out rather than opening settings for nothing.
    const entries = buildMenu("room", ctx({ roomId: null }), {
      "open-room": noop,
      "open-room-settings": noop,
    });
    expect(shape(entries)).toEqual(["Open"]);
  });
});

// #79: mute and unmute are separate registry entries at the same slot, so the
// caller offers exactly the one that applies. The old room menu had neither,
// and the old info dialog was the only place either could be reached.
describe("room menu mute rows", () => {
  const base: MenuHandlers = { "open-room": noop };

  it("offers Mute for an unmuted room", () => {
    const rows = shape(buildMenu("room", ctx(), { ...base, "mute-room": noop }));
    expect(rows).toContain("Mute");
    expect(rows).not.toContain("Unmute");
  });

  it("offers Unmute for a muted room", () => {
    const rows = shape(buildMenu("room", ctx(), { ...base, "unmute-room": noop }));
    expect(rows).toContain("Unmute");
    expect(rows).not.toContain("Mute");
  });

  it("puts Leave below them, on its own", () => {
    const rows = shape(buildMenu("room", ctx(), {
      ...base,
      "mute-room": noop,
      "leave-room-confirm": noop,
    }));
    expect(rows).toEqual(["Open", "──", "Mute", "──", "Leave room"]);
  });
});
