import { describe, it, expect, beforeEach } from "vitest";
import { applyTheme, resetTheme, type Theme } from "./loader.js";

describe("theme/loader", () => {
  let root: HTMLElement;

  beforeEach(() => {
    // Use a fresh element as the root for each test to avoid cross-test pollution
    root = document.createElement("div");
    // Clear any leftover inline styles
    root.removeAttribute("style");
  });

  describe("applyTheme", () => {
    it("sets --bg CSS custom property from colors.background", () => {
      const theme: Theme = { colors: { background: "#1a1a1a" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--bg")).toBe("#1a1a1a");
    });

    it("sets --fg CSS custom property from colors.foreground", () => {
      const theme: Theme = { colors: { foreground: "#c0c0c0" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--fg")).toBe("#c0c0c0");
    });

    it("sets accent primary color", () => {
      const theme: Theme = { colors: { accent: { primary: "#ff6600" } } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--accent-primary")).toBe("#ff6600");
    });

    it("sets accent error color", () => {
      const theme: Theme = { colors: { accent: { error: "#ff0000" } } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--accent-error")).toBe("#ff0000");
    });

    it("sets message colors", () => {
      const theme: Theme = {
        colors: { messages: { own: "#aaffaa", other: "#aaaaff" } },
      };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--msg-own")).toBe("#aaffaa");
      expect(root.style.getPropertyValue("--msg-other")).toBe("#aaaaff");
    });

    it("sets roomlist colors", () => {
      const theme: Theme = {
        colors: { roomlist: { active_bg: "#333", unread: "#ff0" } },
      };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--roomlist-active-bg")).toBe("#333");
      expect(root.style.getPropertyValue("--roomlist-unread")).toBe("#ff0");
    });

    it("sets reaction colors", () => {
      const theme: Theme = {
        colors: { reactions: { background: "#222", own_bg: "#444" } },
      };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--reaction-bg")).toBe("#222");
      expect(root.style.getPropertyValue("--reaction-own-bg")).toBe("#444");
    });

    it("sets typography font-family", () => {
      const theme: Theme = { typography: { font_family: "monospace" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--font-family")).toBe("monospace");
    });

    it("sets typography font-size with px suffix", () => {
      const theme: Theme = { typography: { font_size: 14 } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--font-size")).toBe("14px");
    });

    it("sets typography line-height as string", () => {
      const theme: Theme = { typography: { line_height: 1.5 } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--line-height")).toBe("1.5");
    });

    it("sets border style and associated glyph variables", () => {
      const theme: Theme = { borders: { style: "single" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--border-style")).toBe("single");
      expect(root.style.getPropertyValue("--border-h")).toBeTruthy();
      expect(root.style.getPropertyValue("--border-v")).toBeTruthy();
    });

    it("sets correct glyphs for ascii border style", () => {
      const theme: Theme = { borders: { style: "ascii" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--border-h")).toBe('"-"');
      expect(root.style.getPropertyValue("--border-v")).toBe('"|"');
    });

    it("sets room list width", () => {
      const theme: Theme = { borders: { room_list_width: "200px" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--room-list-width")).toBe("200px");
    });

    it("sets emoji size with px suffix", () => {
      const theme: Theme = { emoji: { size: 24 } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--emoji-size")).toBe("24px");
    });

    it("sets prompt symbol", () => {
      const theme: Theme = { prompt: { symbol: ">>" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--prompt-symbol")).toBe('">>"');
    });

    it("sets mode indicators", () => {
      const theme: Theme = {
        prompt: { normal_indicator: "NOR", insert_indicator: "INS" },
      };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--mode-normal")).toBe('"NOR"');
      expect(root.style.getPropertyValue("--mode-insert")).toBe('"INS"');
    });
  });

  describe("partial theme", () => {
    it("only sets provided values — does not clear other properties", () => {
      // Apply a full theme first
      applyTheme(
        { colors: { background: "#000", foreground: "#fff" } },
        root
      );

      // Apply a partial theme
      applyTheme({ colors: { background: "#111" } }, root);

      // --fg should still be set from the first apply
      expect(root.style.getPropertyValue("--bg")).toBe("#111");
      expect(root.style.getPropertyValue("--fg")).toBe("#fff");
    });

    it("does not set properties for missing sections", () => {
      const theme: Theme = { colors: { background: "#000" } };

      applyTheme(theme, root);

      // Typography was not in the theme — should not be set
      expect(root.style.getPropertyValue("--font-size")).toBe("");
    });

    it("handles completely empty theme object gracefully", () => {
      expect(() => applyTheme({}, root)).not.toThrow();
    });
  });

  describe("resetTheme", () => {
    it("removes all CSS custom properties set by applyTheme", () => {
      const theme: Theme = {
        colors: {
          background: "#1a1a1a",
          foreground: "#c0c0c0",
          accent: { primary: "#ff6600" },
        },
        typography: { font_size: 14 },
      };

      applyTheme(theme, root);

      // Confirm they were set
      expect(root.style.getPropertyValue("--bg")).toBe("#1a1a1a");

      resetTheme(root);

      expect(root.style.getPropertyValue("--bg")).toBe("");
      expect(root.style.getPropertyValue("--fg")).toBe("");
      expect(root.style.getPropertyValue("--accent-primary")).toBe("");
      expect(root.style.getPropertyValue("--font-size")).toBe("");
    });

    it("removes border glyph properties", () => {
      applyTheme({ borders: { style: "single" } }, root);

      resetTheme(root);

      expect(root.style.getPropertyValue("--border-h")).toBe("");
      expect(root.style.getPropertyValue("--border-v")).toBe("");
    });

    it("removes prompt symbol", () => {
      applyTheme({ prompt: { symbol: ">>" } }, root);

      resetTheme(root);

      expect(root.style.getPropertyValue("--prompt-symbol")).toBe("");
    });

    it("does not throw when called on a clean element", () => {
      expect(() => resetTheme(root)).not.toThrow();
    });

    it("removes reaction-related properties", () => {
      applyTheme(
        { colors: { reactions: { background: "#111", own_bg: "#222" } } },
        root
      );

      resetTheme(root);

      expect(root.style.getPropertyValue("--reaction-bg")).toBe("");
      expect(root.style.getPropertyValue("--reaction-own-bg")).toBe("");
    });
  });
});
