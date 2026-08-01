import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu.js";
import { modalManager } from "./ModalManager.js";

// The converged context-menu design: a header bar, section-header strips in
// place of bare separators, a chip row of formatting toggles that stays open
// across activations, and disabled rows shown greyed rather than omitted.

describe("ContextMenu", () => {
  let menu: ContextMenu;

  const el = (): HTMLElement => menu.getElement();
  const items = (): HTMLElement[] =>
    Array.from(el().querySelectorAll<HTMLElement>(".context-menu__item"));
  const chips = (): HTMLElement[] =>
    Array.from(el().querySelectorAll<HTMLElement>(".context-menu__chip"));
  const key = (k: string): void => {
    el().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  };

  beforeEach(() => {
    menu = new ContextMenu();
  });

  afterEach(() => {
    menu.hide();
    el().remove();
  });

  describe("shell", () => {
    it("renders a header bar with the title and an esc affordance", () => {
      menu.show(0, 0, [{ label: "Reply", action: vi.fn() }], { title: "message · ada" });

      expect(el().querySelector(".context-menu__title")?.textContent).toBe("message · ada");
      expect(el().querySelector(".context-menu__esc")?.textContent).toBe("esc");
    });

    it("omits the header when no title is given", () => {
      menu.show(0, 0, [{ label: "Open", action: vi.fn() }]);

      expect(el().querySelector(".context-menu__header")).toBeNull();
    });

    it("renders section headers", () => {
      menu.show(0, 0, [
        { section: "respond" },
        { label: "Reply", action: vi.fn() },
        { section: "clipboard" },
        { label: "Copy message text", action: vi.fn() },
      ]);

      const sections = Array.from(
        el().querySelectorAll<HTMLElement>(".context-menu__section"),
      ).map((s) => s.textContent);
      expect(sections).toEqual(["respond", "clipboard"]);
    });

    it("still renders plain separators for menus that use them", () => {
      menu.show(0, 0, [
        { label: "Open", action: vi.fn() },
        { separator: true },
        { label: "Room settings", action: vi.fn() },
      ]);

      expect(el().querySelectorAll(".context-menu__separator")).toHaveLength(1);
    });

    it("is focusable so it owns arrow keys the moment it opens", () => {
      expect(el().getAttribute("tabindex")).toBe("-1");
    });

    it("registers and deregisters with the modal manager", () => {
      menu.show(0, 0, [{ label: "Reply", action: vi.fn() }]);
      expect(modalManager.isAnyOpen).toBe(true);

      menu.hide();
      expect(modalManager.isAnyOpen).toBe(false);
    });
  });

  describe("disabled rows", () => {
    const entries = (onEdit: () => void): ContextMenuEntry[] => [
      { label: "View raw event", action: vi.fn() },
      { label: "Edit", disabled: true, action: onEdit },
    ];

    it("renders them greyed rather than omitting them", () => {
      menu.show(0, 0, entries(vi.fn()));

      const edit = items()[1];
      expect(edit.classList.contains("context-menu__item--disabled")).toBe(true);
      expect(edit.getAttribute("aria-disabled")).toBe("true");
    });

    it("does not fire on click", () => {
      const onEdit = vi.fn();
      menu.show(0, 0, entries(onEdit));

      items()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(onEdit).not.toHaveBeenCalled();
      expect(menu.isVisible()).toBe(true);
    });

    it("is skipped by keyboard navigation", () => {
      menu.show(0, 0, [
        { label: "One", action: vi.fn() },
        { label: "Two", disabled: true, action: vi.fn() },
        { label: "Three", action: vi.fn() },
      ]);

      key("ArrowDown");
      key("ArrowDown");

      expect(items()[2].classList.contains("context-menu__item--active")).toBe(true);
      expect(items()[1].classList.contains("context-menu__item--active")).toBe(false);
    });
  });

  describe("item activation", () => {
    it("hides the menu before running the action, so the action wins any focus race", () => {
      let visibleDuringAction: boolean | null = null;
      menu.show(0, 0, [
        { label: "Reply", action: () => { visibleDuringAction = menu.isVisible(); } },
      ]);

      items()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(visibleDuringAction).toBe(false);
      expect(menu.isVisible()).toBe(false);
    });

    it("activates the highlighted row on Enter", () => {
      const onReply = vi.fn();
      menu.show(0, 0, [{ label: "Reply", action: onReply }]);

      key("ArrowDown");
      key("Enter");

      expect(onReply).toHaveBeenCalledTimes(1);
    });

    it("closes on Escape without running anything", () => {
      const onReply = vi.fn();
      menu.show(0, 0, [{ label: "Reply", action: onReply }]);

      key("Escape");

      expect(menu.isVisible()).toBe(false);
      expect(onReply).not.toHaveBeenCalled();
    });

    it("returns focus to whatever summoned it", () => {
      const field = document.createElement("textarea");
      document.body.appendChild(field);
      field.focus();

      menu.show(0, 0, [{ label: "Reply", action: vi.fn() }]);
      menu.hide();

      expect(document.activeElement).toBe(field);
      field.remove();
    });
  });

  describe("formatting chips", () => {
    it("lays the row out to fill the menu width", () => {
      menu.show(0, 0, [
        { chips: [{ label: "B", action: vi.fn() }, { label: "I", action: vi.fn() }] },
      ]);

      const row = el().querySelector<HTMLElement>(".context-menu__chips");
      expect(row?.style.getPropertyValue("--context-menu-chip-cols")).toBe("2");
      expect(chips()).toHaveLength(2);
    });

    it("reflects an active predicate", () => {
      let bold = false;
      menu.show(0, 0, [{ chips: [{ label: "B", active: () => bold, action: vi.fn() }] }]);

      expect(chips()[0].classList.contains("context-menu__chip--active")).toBe(false);

      bold = true;
      chips()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(chips()[0].classList.contains("context-menu__chip--active")).toBe(true);
      expect(chips()[0].getAttribute("aria-checked")).toBe("true");
    });

    it("stays open on activation so formatting can be applied more than once", () => {
      const onBold = vi.fn();
      menu.show(0, 0, [{ chips: [{ label: "B", action: onBold }] }]);

      chips()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      chips()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(menu.isVisible()).toBe(true);
      expect(onBold).toHaveBeenCalledTimes(2);
    });

    it("steps between chips with left/right and leaves the row with down", () => {
      menu.show(0, 0, [
        {
          chips: [
            { label: "B", action: vi.fn() },
            { label: "I", action: vi.fn() },
          ],
        },
        { label: "Cut", action: vi.fn() },
      ]);

      key("ArrowDown"); // into the chip row
      expect(chips()[0].classList.contains("context-menu__chip--focus")).toBe(true);

      key("ArrowRight");
      expect(chips()[1].classList.contains("context-menu__chip--focus")).toBe(true);

      key("ArrowDown");
      expect(items()[0].classList.contains("context-menu__item--active")).toBe(true);
    });

    it("skips an empty chip row entirely", () => {
      menu.show(0, 0, [{ chips: [] }, { label: "Cut", action: vi.fn() }]);

      expect(el().querySelector(".context-menu__chips")).toBeNull();
      key("ArrowDown");
      expect(items()[0].classList.contains("context-menu__item--active")).toBe(true);
    });
  });

  describe("dismissal", () => {
    // Outside-click/scroll listeners are registered on a deferred tick so the
    // triggering mousedown doesn't immediately close the menu.
    const openAndArm = (): void => {
      vi.useFakeTimers();
      menu.show(0, 0, [{ label: "Reply", action: vi.fn() }]);
      vi.runAllTimers();
      vi.useRealTimers();
    };

    it("ignores scrolling inside its own body — a long menu scrolls itself", () => {
      openAndArm();

      el().dispatchEvent(new Event("scroll", { bubbles: true }));

      expect(menu.isVisible()).toBe(true);
    });

    it("still closes when the page behind it scrolls", () => {
      openAndArm();

      document.body.dispatchEvent(new Event("scroll", { bubbles: true }));

      expect(menu.isVisible()).toBe(false);
    });

    it("closes on a click outside", () => {
      openAndArm();

      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(menu.isVisible()).toBe(false);
    });
  });
});
