import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ShortcodePreview,
  fuzzyMatch,
  filterShortcodes,
  type ShortcodeEntry,
} from "./ShortcodePreview.js";

// jsdom does not implement scrollIntoView; mock it globally so the
// ShortcodePreview._updateActive call doesn't throw.
Element.prototype.scrollIntoView = vi.fn();

const SAMPLE_ENTRIES: ShortcodeEntry[] = [
  { key: "👍", shortcode: "thumbsup" },
  { key: "❤️", shortcode: "heart" },
  { key: "😂", shortcode: "joy" },
  { key: "🎉", shortcode: "tada" },
  { key: "🔥", shortcode: "fire" },
];

describe("ShortcodePreview", () => {
  let preview: ShortcodePreview;

  beforeEach(() => {
    preview = new ShortcodePreview();
    document.body.appendChild(preview.getElement());
  });

  afterEach(() => {
    preview.getElement().remove();
  });

  describe("show", () => {
    it("shows matching shortcodes in the list", () => {
      preview.show(SAMPLE_ENTRIES);

      const items = preview.getElement().querySelectorAll(".shortcode-preview__item");
      expect(items).toHaveLength(5);
    });

    it("renders shortcode labels with colon wrapping", () => {
      preview.show([{ key: "👍", shortcode: "thumbsup" }]);

      const label = preview
        .getElement()
        .querySelector(".shortcode-preview__label");
      expect(label?.textContent).toBe(":thumbsup:");
    });

    it("makes the element visible when there are entries", () => {
      preview.show(SAMPLE_ENTRIES);

      expect(preview.isVisible()).toBe(true);
      expect(preview.getElement().style.display).not.toBe("none");
    });

    it("hides the element when entries are empty", () => {
      preview.show([]);

      expect(preview.isVisible()).toBe(false);
      expect(preview.getElement().style.display).toBe("none");
    });

    it("resets active index to 0 on each show call", () => {
      preview.show(SAMPLE_ENTRIES);

      // Move selection down
      preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));

      // Show again — active should reset
      preview.show(SAMPLE_ENTRIES);

      const items = preview.getElement().querySelectorAll(".shortcode-preview__item");
      expect(items[0].classList.contains("shortcode-preview__item--active")).toBe(true);
      expect(items[2].classList.contains("shortcode-preview__item--active")).toBe(false);
    });
  });

  describe("hide", () => {
    it("hides the element", () => {
      preview.show(SAMPLE_ENTRIES);
      preview.hide();

      expect(preview.isVisible()).toBe(false);
      expect(preview.getElement().style.display).toBe("none");
    });
  });

  describe("selection navigation", () => {
    it("moves selection down on ArrowDown", () => {
      preview.show(SAMPLE_ENTRIES);

      preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));

      const items = preview.getElement().querySelectorAll(".shortcode-preview__item");
      expect(items[0].classList.contains("shortcode-preview__item--active")).toBe(false);
      expect(items[1].classList.contains("shortcode-preview__item--active")).toBe(true);
    });

    it("moves selection down on Tab", () => {
      preview.show(SAMPLE_ENTRIES);

      preview.handleKeydown(new KeyboardEvent("keydown", { key: "Tab" }));

      const items = preview.getElement().querySelectorAll(".shortcode-preview__item");
      expect(items[1].classList.contains("shortcode-preview__item--active")).toBe(true);
    });

    it("moves selection up on ArrowUp", () => {
      preview.show(SAMPLE_ENTRIES);

      // Move to item 2 first
      preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      // Move back up
      preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowUp" }));

      const items = preview.getElement().querySelectorAll(".shortcode-preview__item");
      expect(items[1].classList.contains("shortcode-preview__item--active")).toBe(true);
    });

    it("wraps around to end when moving up from first item", () => {
      preview.show(SAMPLE_ENTRIES);

      preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowUp" }));

      const items = preview.getElement().querySelectorAll(".shortcode-preview__item");
      expect(
        items[SAMPLE_ENTRIES.length - 1].classList.contains("shortcode-preview__item--active")
      ).toBe(true);
    });

    it("wraps around to first when moving down from last item", () => {
      preview.show(SAMPLE_ENTRIES);

      for (let i = 0; i < SAMPLE_ENTRIES.length; i++) {
        preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      }

      const items = preview.getElement().querySelectorAll(".shortcode-preview__item");
      expect(items[0].classList.contains("shortcode-preview__item--active")).toBe(true);
    });

    it("fires onSelect with the active entry on Enter", () => {
      const handler = vi.fn();
      preview.onSelect(handler);
      preview.show(SAMPLE_ENTRIES);

      // Select item at index 1
      preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      preview.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(handler).toHaveBeenCalledWith(SAMPLE_ENTRIES[1]);
    });

    it("hides the preview after selecting with Enter", () => {
      preview.onSelect(() => {});
      preview.show(SAMPLE_ENTRIES);

      preview.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(preview.isVisible()).toBe(false);
    });

    it("hides on Escape key", () => {
      preview.show(SAMPLE_ENTRIES);
      preview.handleKeydown(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(preview.isVisible()).toBe(false);
    });

    it("returns true for consumed keys when visible", () => {
      preview.show(SAMPLE_ENTRIES);

      expect(preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }))).toBe(true);
      expect(preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowUp" }))).toBe(true);
    });

    it("returns false for non-navigation keys", () => {
      preview.show(SAMPLE_ENTRIES);

      expect(preview.handleKeydown(new KeyboardEvent("keydown", { key: "a" }))).toBe(false);
    });

    it("returns false when not visible", () => {
      expect(preview.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }))).toBe(false);
    });
  });

  describe("custom emoji in list", () => {
    it("renders img for entries with imageUrl", () => {
      preview.show([
        {
          key: ":blobwave:",
          shortcode: "blobwave",
          imageUrl: "https://example.com/blobwave.png",
        },
      ]);

      const img = preview
        .getElement()
        .querySelector<HTMLImageElement>(".shortcode-preview__emoji-img");
      expect(img).not.toBeNull();
      expect(img?.src).toBe("https://example.com/blobwave.png");
    });

    it("renders glyph span for entries without imageUrl", () => {
      preview.show([{ key: "🎉", shortcode: "tada" }]);

      const glyph = preview
        .getElement()
        .querySelector(".shortcode-preview__emoji-glyph");
      expect(glyph).not.toBeNull();
      expect(glyph?.textContent).toBe("🎉");
    });
  });
});

describe("fuzzyMatch", () => {
  it("returns true when query is a prefix of target", () => {
    expect(fuzzyMatch("heart", "heartpulse")).toBe(true);
  });

  it("returns true for exact match", () => {
    expect(fuzzyMatch("tada", "tada")).toBe(true);
  });

  it("returns true for fuzzy match with chars in order", () => {
    expect(fuzzyMatch("hrt", "heart")).toBe(true);
  });

  it("returns false when chars are not in order", () => {
    expect(fuzzyMatch("tad", "data")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("HEART", "heart")).toBe(true);
    expect(fuzzyMatch("heart", "HEART")).toBe(true);
  });

  it("returns true for empty query", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
  });

  it("returns false when query is longer than target", () => {
    expect(fuzzyMatch("abcdefgh", "abc")).toBe(false);
  });
});

describe("filterShortcodes", () => {
  const entries: ShortcodeEntry[] = [
    { key: "👍", shortcode: "thumbsup" },
    { key: "⬆️", shortcode: "thumbsup_tone1" },
    { key: "❤️", shortcode: "heart" },
    { key: "💗", shortcode: "heartpulse" },
    { key: "🔥", shortcode: "fire" },
  ];

  it("returns first maxResults entries for empty query", () => {
    const result = filterShortcodes(entries, "", 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(entries[0]);
  });

  it("prefix matches rank above fuzzy matches", () => {
    // "heart" is a prefix match; "thumbsup" doesn't prefix-match "h" but fuzzy could
    const result = filterShortcodes(entries, "heart");
    const heartIdx = result.findIndex((e) => e.shortcode === "heart");
    const heartpulseIdx = result.findIndex((e) => e.shortcode === "heartpulse");

    expect(heartIdx).toBeLessThan(heartpulseIdx);
  });

  it("returns entries matching the query", () => {
    const result = filterShortcodes(entries, "thumb");
    const shortcodes = result.map((e) => e.shortcode);

    expect(shortcodes).toContain("thumbsup");
    expect(shortcodes).toContain("thumbsup_tone1");
    expect(shortcodes).not.toContain("heart");
  });

  it("respects maxResults limit", () => {
    const result = filterShortcodes(entries, "h", 2);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when nothing matches", () => {
    const result = filterShortcodes(entries, "zzzzz");
    expect(result).toHaveLength(0);
  });
});
