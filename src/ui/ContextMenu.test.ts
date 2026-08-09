import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ContextMenu, parseAccel, type ContextMenuEntry } from "./ContextMenu.js";
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
  const key = (k: string, mods: KeyboardEventInit = {}): void => {
    el().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...mods }));
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

    // hide() deregisters the menu before the event finishes bubbling, so an
    // un-stopped Escape would dismiss the menu *and then* run the app's own
    // Escape — leaving Insert mode and closing the panel behind it.
    it("does not leak the keys it handles to the global handler", () => {
      const global = vi.fn();
      document.addEventListener("keydown", global);
      menu.show(0, 0, [
        { label: "One", action: vi.fn() },
        { label: "Two", action: vi.fn() },
      ]);

      key("ArrowDown");
      key("Enter");
      expect(global).not.toHaveBeenCalled();

      menu.show(0, 0, [{ label: "One", action: vi.fn() }]);
      key("Escape");
      expect(global).not.toHaveBeenCalled();

      document.removeEventListener("keydown", global);
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

    it("keeps the original focus target when re-shown while already open", () => {
      const field = document.createElement("textarea");
      document.body.appendChild(field);
      field.focus();

      menu.show(0, 0, [{ label: "One", action: vi.fn() }]);
      // Right-clicking a second target without dismissing the first menu.
      menu.show(0, 0, [{ label: "Two", action: vi.fn() }]);
      menu.hide();

      expect(document.activeElement).toBe(field);
      field.remove();
    });
  });

  // The hint column advertises each row's shortcut, but the menu takes focus
  // when it opens and the global keydown guard swallows every key while a modal
  // is registered — so the menu has to honour its own hints. Right-click a
  // message, press `E`, get the editor.
  describe("hint accelerators", () => {
    it("fires the row whose hint is the pressed key, shift included", () => {
      const onEdit = vi.fn();
      menu.show(0, 0, [
        { label: "React", hint: "e", action: vi.fn() },
        { label: "Edit", hint: "E", action: onEdit },
      ]);

      key("E", { shiftKey: true });

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(menu.isVisible()).toBe(false);
    });

    it("distinguishes the unshifted hint from the shifted one", () => {
      const onReact = vi.fn();
      const onEdit = vi.fn();
      menu.show(0, 0, [
        { label: "React", hint: "e", action: onReact },
        { label: "Edit", hint: "E", action: onEdit },
      ]);

      key("e");

      expect(onReact).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("fires modifier chords, either separator", () => {
      const onCut = vi.fn();
      const onEmoji = vi.fn();
      menu.show(0, 0, [
        { label: "Cut", hint: "Ctrl+X", action: onCut },
        { label: "Emoji…", hint: "Ctrl-e", action: onEmoji },
      ]);
      key("x", { ctrlKey: true });
      expect(onCut).toHaveBeenCalledTimes(1);

      menu.show(0, 0, [
        { label: "Cut", hint: "Ctrl+X", action: onCut },
        { label: "Emoji…", hint: "Ctrl-e", action: onEmoji },
      ]);
      key("e", { ctrlKey: true });
      expect(onEmoji).toHaveBeenCalledTimes(1);
    });

    it("keeps ⇧Ctrl+V distinct from Ctrl+V", () => {
      const onPaste = vi.fn();
      const onPastePlain = vi.fn();
      const entries: ContextMenuEntry[] = [
        { label: "Paste", hint: "Ctrl+V", action: onPaste },
        { label: "Paste as plain text", hint: "⇧Ctrl+V", action: onPastePlain },
      ];

      menu.show(0, 0, entries);
      key("v", { ctrlKey: true });
      expect(onPaste).toHaveBeenCalledTimes(1);
      expect(onPastePlain).not.toHaveBeenCalled();

      menu.show(0, 0, entries);
      key("V", { ctrlKey: true, shiftKey: true });
      expect(onPastePlain).toHaveBeenCalledTimes(1);
      expect(onPaste).toHaveBeenCalledTimes(1);
    });

    it("waits for the whole of a multi-key hint", () => {
      const onDelete = vi.fn();
      menu.show(0, 0, [{ label: "Delete", hint: "dd", action: onDelete }]);

      key("d");
      expect(onDelete).not.toHaveBeenCalled();
      expect(menu.isVisible()).toBe(true);

      key("d");
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("abandons a half-typed sequence when the user navigates instead", () => {
      const onDelete = vi.fn();
      menu.show(0, 0, [{ label: "Delete", hint: "dd", action: onDelete }]);

      key("d");
      key("ArrowDown");
      key("d");

      expect(onDelete).not.toHaveBeenCalled();
    });

    it("claims a disabled row's key rather than leaking it", () => {
      const global = vi.fn();
      const onEdit = vi.fn();
      document.addEventListener("keydown", global);
      menu.show(0, 0, [{ label: "Edit", hint: "E", disabled: true, action: onEdit }]);

      key("E", { shiftKey: true });

      expect(onEdit).not.toHaveBeenCalled();
      expect(menu.isVisible()).toBe(true);
      expect(global).not.toHaveBeenCalled();
      document.removeEventListener("keydown", global);
    });

    it("leaves keys no hint claims to the global handler", () => {
      const global = vi.fn();
      document.addEventListener("keydown", global);
      menu.show(0, 0, [{ label: "Reply", hint: "r", action: vi.fn() }]);

      key("z");

      expect(global).toHaveBeenCalledTimes(1);
      document.removeEventListener("keydown", global);
    });

    describe("parseAccel", () => {
      it("reads the live forms", () => {
        expect(parseAccel("E")).toMatchObject({ key: "E", ctrl: false, shift: false });
        expect(parseAccel(">")).toMatchObject({ key: ">" });
        expect(parseAccel("Ctrl+X")).toMatchObject({ key: "X", ctrl: true, shift: false });
        expect(parseAccel("Ctrl-e")).toMatchObject({ key: "e", ctrl: true });
        expect(parseAccel("⇧Ctrl+V")).toMatchObject({ key: "V", ctrl: true, shift: true });
        expect(parseAccel("dd")).toMatchObject({ key: null, seq: "dd" });
      });

      // A hint may point at a different affordance entirely — the `:` command
      // line, or an arrow meaning "leaves the app". Those are documentation.
      it("returns null for hints that name no keystroke", () => {
        expect(parseAccel(":debug")).toBeNull();
        expect(parseAccel("")).toBeNull();
        expect(parseAccel("Ctrl")).toBeNull();
      });
    });
  });

  describe("formatting chips", () => {
    it("renders one toggle per chip", () => {
      menu.show(0, 0, [
        { chips: [{ label: "B", action: vi.fn() }, { label: "I", action: vi.fn() }] },
      ]);

      expect(chips().map((c) => c.textContent)).toEqual(["B", "I"]);
      expect(el().querySelector(".context-menu__chips")?.getAttribute("role")).toBe("group");
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
