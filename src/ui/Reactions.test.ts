import { describe, it, expect, vi } from "vitest";
import { createReactionBar, updateReactionBar, type ReactionGroup } from "./Reactions.js";

describe("Reactions", () => {
  describe("createReactionBar", () => {
    it("creates a reaction bar element with role group", () => {
      const bar = createReactionBar([]);

      expect(bar.className).toBe("reaction-bar");
      expect(bar.getAttribute("role")).toBe("group");
    });

    it("creates reaction chips with emoji and count", () => {
      const reactions: ReactionGroup[] = [
        { key: "👍", count: 5, own: false },
        { key: "❤️", count: 2, own: false },
      ];

      const bar = createReactionBar(reactions);
      const chips = bar.querySelectorAll<HTMLButtonElement>(".reaction");

      expect(chips).toHaveLength(2);

      const emoji1 = chips[0].querySelector(".reaction__emoji");
      expect(emoji1?.textContent).toBe("👍");

      const count1 = chips[0].querySelector(".reaction__count");
      expect(count1?.textContent).toBe("5");

      const count2 = chips[1].querySelector(".reaction__count");
      expect(count2?.textContent).toBe("2");
    });

    it("own reactions get reaction--own class", () => {
      const reactions: ReactionGroup[] = [
        { key: "👍", count: 1, own: true },
        { key: "❤️", count: 1, own: false },
      ];

      const bar = createReactionBar(reactions);
      const chips = bar.querySelectorAll<HTMLButtonElement>(".reaction");

      expect(chips[0].classList.contains("reaction--own")).toBe(true);
      expect(chips[1].classList.contains("reaction--own")).toBe(false);
    });

    it("own reactions have aria-pressed set to true", () => {
      const bar = createReactionBar([{ key: "👍", count: 1, own: true }]);
      const chip = bar.querySelector<HTMLButtonElement>(".reaction");

      expect(chip?.getAttribute("aria-pressed")).toBe("true");
    });

    it("non-own reactions have aria-pressed set to false", () => {
      const bar = createReactionBar([{ key: "👍", count: 1, own: false }]);
      const chip = bar.querySelector<HTMLButtonElement>(".reaction");

      expect(chip?.getAttribute("aria-pressed")).toBe("false");
    });

    it("custom emoji reactions use img tags instead of text spans", () => {
      const reactions: ReactionGroup[] = [
        {
          key: ":blobwave:",
          count: 3,
          own: false,
          imageUrl: "https://example.com/blobwave.png",
        },
      ];

      const bar = createReactionBar(reactions);
      const img = bar.querySelector<HTMLImageElement>(".reaction__emoji");

      expect(img?.tagName.toLowerCase()).toBe("img");
      expect(img?.src).toBe("https://example.com/blobwave.png");
      expect(img?.alt).toBe(":blobwave:");
    });

    it("unicode emoji reactions use span tags", () => {
      const bar = createReactionBar([{ key: "🎉", count: 1, own: false }]);
      const emojiEl = bar.querySelector(".reaction__emoji");

      expect(emojiEl?.tagName.toLowerCase()).toBe("span");
      expect(emojiEl?.textContent).toBe("🎉");
    });

    it("creates an empty bar when passed an empty array", () => {
      const bar = createReactionBar([]);
      expect(bar.children).toHaveLength(0);
    });

    it("sets aria-label on chips with singular person count", () => {
      const bar = createReactionBar([{ key: "👍", count: 1, own: false }]);
      const chip = bar.querySelector(".reaction");

      expect(chip?.getAttribute("aria-label")).toContain("1 person");
    });

    it("sets aria-label on chips with plural people count", () => {
      const bar = createReactionBar([{ key: "👍", count: 5, own: false }]);
      const chip = bar.querySelector(".reaction");

      expect(chip?.getAttribute("aria-label")).toContain("5 people");
    });
  });

  describe("updateReactionBar", () => {
    it("replaces all reactions in an existing bar", () => {
      const bar = createReactionBar([{ key: "👍", count: 1, own: false }]);

      updateReactionBar(bar, [
        { key: "❤️", count: 2, own: false },
        { key: "😂", count: 4, own: true },
      ]);

      const chips = bar.querySelectorAll(".reaction");
      expect(chips).toHaveLength(2);

      const emoji = Array.from(chips).map((c) =>
        c.querySelector(".reaction__emoji")?.textContent
      );
      expect(emoji).toEqual(["❤️", "😂"]);
    });

    it("clears all reactions when passed empty array", () => {
      const bar = createReactionBar([{ key: "👍", count: 1, own: false }]);
      updateReactionBar(bar, []);

      expect(bar.children).toHaveLength(0);
    });
  });
});
