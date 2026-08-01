import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  asQuote,
  composeEntries,
  escapeMarkdown,
  labelQuery,
  messageEntries,
} from "./context_menus.js";
import { AppState } from "./state.js";
import { Input } from "../ui/Input.js";
import type { AppComponents } from "../ui/App.js";
import type { ContextMenuChipRow, ContextMenuEntry, ContextMenuItem } from "../ui/ContextMenu.js";

// The converged design splits the menu in two: formatting only appears inside
// the compose box (you are editing text you own), and both menus group their
// rows under section headers instead of bare separators.

const sections = (entries: ContextMenuEntry[]): string[] =>
  entries.filter((e): e is { section: string } => "section" in e).map((e) => e.section);

const labels = (entries: ContextMenuEntry[]): string[] =>
  entries.filter((e): e is ContextMenuItem => "label" in e).map((e) => e.label);

const item = (entries: ContextMenuEntry[], label: string): ContextMenuItem | undefined =>
  entries.find((e): e is ContextMenuItem => "label" in e && e.label.startsWith(label));

const chipRow = (entries: ContextMenuEntry[]): ContextMenuChipRow | undefined =>
  entries.find((e): e is ContextMenuChipRow => "chips" in e);

describe("context menu text helpers", () => {
  it("labelQuery collapses whitespace and clips long selections", () => {
    expect(labelQuery("  sliding\n  sync  ")).toBe("sliding sync");
    expect(labelQuery("x".repeat(40))).toBe(`${"x".repeat(28)}…`);
  });

  it("asQuote prefixes every line", () => {
    expect(asQuote("one\ntwo")).toBe("> one\n> two");
  });

  it("escapeMarkdown neutralises inline emphasis and block markers", () => {
    expect(escapeMarkdown("**bold** and `code`")).toBe("\\*\\*bold\\*\\* and \\`code\\`");
    expect(escapeMarkdown("- item\n> quote")).toBe("\\- item\n\\> quote");
  });

  it("escapeMarkdown leaves ordinary prose alone", () => {
    expect(escapeMarkdown("rooms hydrate in 400ms")).toBe("rooms hydrate in 400ms");
  });
});

describe("compose context menu", () => {
  let input: Input;
  let components: AppComponents;

  const field = (): HTMLTextAreaElement =>
    input.getElement().querySelector<HTMLTextAreaElement>(".input-bar__field")!;

  const select = (text: string, start: number, end: number): void => {
    input.setValue(text);
    field().setSelectionRange(start, end);
  };

  beforeEach(() => {
    input = new Input();
    document.body.appendChild(input.getElement());
    components = { input } as unknown as AppComponents;
  });

  it("groups every row under a section header", () => {
    select("the branch is green", 4, 10);
    expect(sections(composeEntries(components))).toEqual([
      "format",
      "clipboard",
      "selection",
      "insert",
      "draft",
    ]);
  });

  it("drops the formatting and selection groups when nothing is selected", () => {
    select("the branch is green", 4, 4);
    const entries = composeEntries(components);

    expect(sections(entries)).toEqual(["clipboard", "insert", "draft"]);
    expect(chipRow(entries)).toBeUndefined();
  });

  it("offers one toggle per markdown marker", () => {
    select("branch", 0, 6);
    expect(chipRow(composeEntries(components))?.chips.map((c) => c.label)).toEqual([
      "B", "I", "U", "S", "‖", "`",
    ]);
  });

  it("lights the toggle whose marker is already applied", () => {
    select("**branch**", 2, 8);
    const chips = chipRow(composeEntries(components))!.chips;
    const active = (label: string): boolean => {
      const chip = chips.find((c) => c.label === label)!;
      return typeof chip.active === "function" ? chip.active() : !!chip.active;
    };

    expect(active("B")).toBe(true);
    // `*text*` and `**text**` both end in a `*` per side — italic must not lie.
    expect(active("I")).toBe(false);
    expect(active("S")).toBe(false);
  });

  it("applies and re-applies formatting through the chip action", () => {
    select("branch", 0, 6);
    const bold = chipRow(composeEntries(components))!.chips[0];

    bold.action();
    expect(input.getValue()).toBe("**branch**");
    bold.action();
    expect(input.getValue()).toBe("branch");
  });

  it("greys Cut and Copy with a collapsed caret", () => {
    select("draft", 5, 5);
    const entries = composeEntries(components);

    expect(item(entries, "Cut")?.disabled).toBe(true);
    expect(item(entries, "Copy")?.disabled).toBe(true);
    // Paste doesn't need a selection.
    expect(item(entries, "Paste")?.disabled).toBeFalsy();
  });

  it("echoes the selection into the search label", () => {
    select("the sliding sync branch", 4, 16);
    expect(item(composeEntries(components), "Search web")?.label)
      .toBe("Search web for “sliding sync”");
  });

  it("greys Undo until there is history, and Discard until there is a draft", () => {
    select("", 0, 0);
    let entries = composeEntries(components);
    expect(item(entries, "Undo")?.disabled).toBe(true);
    expect(item(entries, "Discard draft")?.disabled).toBe(true);

    select("branch", 0, 6);
    input.toggleWrap("**");
    entries = composeEntries(components);
    expect(item(entries, "Undo")?.disabled).toBe(false);
    expect(item(entries, "Discard draft")?.disabled).toBe(false);
    expect(item(entries, "Discard draft")?.danger).toBe(true);
  });

  it("keeps the insert group reachable regardless of selection", () => {
    select("", 0, 0);
    expect(labels(composeEntries(components))).toEqual(
      expect.arrayContaining(["Emoji…", "GIF…", "Attach file…", "Mention…"]),
    );
  });
});

describe("message context menu", () => {
  const components = {
    input: { focus: vi.fn() },
    timeline: { getMessageBodyById: () => null },
  } as unknown as AppComponents;

  beforeEach(() => {
    AppState.patch({
      ownUserId: "@ada:example.org",
      currentTimeline: [
        { event_id: "$own", sender: "@ada:example.org", body: "mine" },
        { event_id: "$other", sender: "@bob:example.org", body: "theirs" },
      ] as never,
    });
  });

  it("groups the rows keyboard.ts already built under the new headers", () => {
    const entries = messageEntries(components, "$own", "");

    expect(sections(entries)).toEqual(["respond", "clipboard", "event"]);
    expect(labels(entries)).toEqual([
      "Reply", "React", "Thread",
      "Copy message text", "Copy as quote",
      "View raw event", "Edit", "Delete",
    ]);
  });

  it("never offers formatting — you are not editing text here", () => {
    expect(chipRow(messageEntries(components, "$own", "highlighted"))).toBeUndefined();
  });

  it("enables Edit and Delete on your own message", () => {
    const entries = messageEntries(components, "$own", "");

    expect(item(entries, "Edit")?.disabled).toBe(false);
    expect(item(entries, "Delete")?.disabled).toBe(false);
  });

  it("greys — rather than omits — Edit and Delete on someone else's", () => {
    const entries = messageEntries(components, "$other", "");

    expect(labels(entries)).toContain("Edit");
    expect(item(entries, "Edit")?.disabled).toBe(true);
    expect(item(entries, "Delete")?.disabled).toBe(true);
  });

  it("adds the selection group only when text is highlighted in that message", () => {
    expect(sections(messageEntries(components, "$own", ""))).not.toContain("selection");

    const entries = messageEntries(components, "$own", "sliding sync");
    expect(sections(entries)).toContain("selection");
    expect(item(entries, "Search web")?.label).toBe("Search web for “sliding sync”");
    expect(labels(entries)).toContain("Copy selected text");
  });
});
