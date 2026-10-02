import { describe, it, expect, beforeEach } from "vitest";
import { asQuote, composeMenuHandlers, escapeMarkdown, labelQuery } from "./compose_menu.js";
import { buildMenu } from "./context_menus.js";
import type { AvailabilityContext } from "./registry.js";
import { Input } from "../ui/Input.js";
import type { ContextMenuChipRow, ContextMenuEntry, ContextMenuItem } from "../ui/ContextMenu.js";

const ctx: AvailabilityContext = {
  loggedIn: true,
  roomId: "!room:example.org",
  spaceId: null,
  selectedMessageId: null,
  selectedMessageIsOwn: false,
  isMobile: false,
};

const sections = (entries: ContextMenuEntry[]): string[] =>
  entries.filter((e): e is { section: string } => "section" in e).map((e) => e.section);

const labels = (entries: ContextMenuEntry[]): string[] =>
  entries.filter((e): e is ContextMenuItem => "label" in e).map((e) => e.label);

const item = (entries: ContextMenuEntry[], label: string): ContextMenuItem | undefined =>
  entries.find((e): e is ContextMenuItem => "label" in e && e.label.startsWith(label));

const chipRow = (entries: ContextMenuEntry[]): ContextMenuChipRow | undefined =>
  entries.find((e): e is ContextMenuChipRow => "chips" in e);

describe("compose menu text helpers", () => {
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

describe("compose menu", () => {
  let input: Input;

  const field = (): HTMLTextAreaElement =>
    input.getElement().querySelector<HTMLTextAreaElement>(".input-bar__field")!;

  const select = (text: string, start: number, end: number): void => {
    input.setValue(text);
    field().setSelectionRange(start, end);
  };

  const menu = (): ContextMenuEntry[] => buildMenu("compose", ctx, composeMenuHandlers(input));

  beforeEach(() => {
    input = new Input();
    document.body.appendChild(input.getElement());
  });

  it("groups every row under a section header", () => {
    select("the branch is green", 4, 10);
    expect(sections(menu())).toEqual(["format", "clipboard", "selection", "insert", "draft"]);
  });

  it("drops the formatting and selection groups when nothing is selected", () => {
    select("the branch is green", 4, 4);
    const entries = menu();

    expect(sections(entries)).toEqual(["clipboard", "insert", "draft"]);
    expect(chipRow(entries)).toBeUndefined();
  });

  it("offers one toggle per markdown marker", () => {
    select("branch", 0, 6);
    expect(chipRow(menu())?.chips.map((c) => c.label)).toEqual(["B", "I", "U", "S", "‖", "`"]);
  });

  it("lights the toggle whose marker is already applied", () => {
    select("**branch**", 2, 8);
    const chips = chipRow(menu())!.chips;
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
    const bold = chipRow(menu())!.chips[0];

    bold.action();
    expect(input.getValue()).toBe("**branch**");
    bold.action();
    expect(input.getValue()).toBe("branch");
  });

  it("greys Cut and Copy with a collapsed caret", () => {
    select("draft", 5, 5);
    const entries = menu();

    expect(item(entries, "Cut")?.disabled).toBe(true);
    expect(item(entries, "Copy")?.disabled).toBe(true);
    // Paste doesn't need a selection.
    expect(item(entries, "Paste")?.disabled).toBeFalsy();
  });

  it("echoes the selection into the search label", () => {
    select("the sliding sync branch", 4, 16);
    expect(item(menu(), "Search web")?.label).toBe("Search web for “sliding sync”");
  });

  it("greys Undo until there is history, and Discard until there is a draft", () => {
    select("", 0, 0);
    let entries = menu();
    expect(item(entries, "Undo")?.disabled).toBe(true);
    expect(item(entries, "Discard draft")?.disabled).toBe(true);

    select("branch", 0, 6);
    input.toggleWrap("**");
    entries = menu();
    expect(item(entries, "Undo")?.disabled).toBeFalsy();
    expect(item(entries, "Discard draft")?.disabled).toBeFalsy();
    expect(item(entries, "Discard draft")?.danger).toBe(true);
  });

  it("offers Discard for a staged attachment alone", () => {
    select("", 0, 0);
    input.stageAttachment(new Blob(["x"], { type: "text/plain" }), "notes.txt");
    expect(item(menu(), "Discard draft")?.disabled).toBeFalsy();
  });

  it("keeps the insert group reachable regardless of selection", () => {
    select("", 0, 0);
    expect(labels(menu())).toEqual(
      expect.arrayContaining(["Emoji…", "GIF…", "Attach file…", "Mention…"]),
    );
  });

  it("types a mention marker, spaced off a preceding word", () => {
    select("hi", 2, 2);
    item(menu(), "Mention")!.action();
    expect(input.getValue()).toBe("hi @");
  });
});
