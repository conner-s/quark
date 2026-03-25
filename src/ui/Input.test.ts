import { describe, it, expect, beforeEach, vi } from "vitest";
import { Input } from "./Input.js";
import { Mode } from "../vim/mode.js";

describe("Input", () => {
  let input: Input;

  beforeEach(() => {
    input = new Input();
    document.body.appendChild(input.getElement());
  });

  afterEach(() => {
    input.getElement().remove();
  });

  describe("setMode", () => {
    it("shows NOR label in Normal mode", () => {
      input.setMode(Mode.Normal);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.textContent).toBe("NOR");
    });

    it("shows INS label in Insert mode", () => {
      input.setMode(Mode.Insert);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.textContent).toBe("INS");
    });

    it("shows CMD label in Command mode", () => {
      input.setMode(Mode.Command);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.textContent).toBe("CMD");
    });

    it("shows VIS label in Visual mode", () => {
      input.setMode(Mode.Visual);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.textContent).toBe("VIS");
    });

    it("adds insert class in Insert mode", () => {
      input.setMode(Mode.Insert);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.classList.contains("input-bar__mode--insert")).toBe(true);
    });

    it("removes previous mode class when mode changes", () => {
      input.setMode(Mode.Insert);
      input.setMode(Mode.Normal);

      const modeEl = input.getElement().querySelector(".input-bar__mode");
      expect(modeEl?.classList.contains("input-bar__mode--insert")).toBe(false);
    });
  });

  describe("getValue / setValue", () => {
    it("returns empty string by default", () => {
      expect(input.getValue()).toBe("");
    });

    it("setValue updates the field value", () => {
      input.setValue("hello there");
      expect(input.getValue()).toBe("hello there");
    });

    it("getValue reflects the current field content", () => {
      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      if (field) field.value = "typed text";

      expect(input.getValue()).toBe("typed text");
    });
  });

  describe("command mode", () => {
    it("shows command placeholder in Command mode", () => {
      input.setMode(Mode.Command);

      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      expect(field?.placeholder).toBe("command…");
    });

    it("restores default placeholder when leaving command mode", () => {
      input.setMode(Mode.Command);
      input.setMode(Mode.Normal);

      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      expect(field?.placeholder).toBe("…");
    });
  });

  describe("onSubmit", () => {
    it("fires handler with current value on Enter", () => {
      const handler = vi.fn();
      input.onSubmit(handler);
      input.setValue("test message");

      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      field?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(handler).toHaveBeenCalledWith("test message");
    });

    it("does not fire on Shift+Enter", () => {
      const handler = vi.fn();
      input.onSubmit(handler);

      const field = input.getElement().querySelector<HTMLInputElement>(".input-bar__field");
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
      );

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
