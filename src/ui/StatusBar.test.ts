import { describe, it, expect, beforeEach } from "vitest";
import { StatusBar } from "./StatusBar.js";

describe("StatusBar", () => {
  let bar: StatusBar;

  beforeEach(() => {
    bar = new StatusBar();
    document.body.appendChild(bar.getElement());
  });

  afterEach(() => {
    bar.getElement().remove();
  });

  describe("setRoom", () => {
    it("shows — by default", () => {
      const roomEl = bar.getElement().querySelector(".status-bar__room");
      expect(roomEl?.textContent).toBe("—");
    });

    it("updates room name display", () => {
      bar.setRoom("#general:matrix.org");

      const roomEl = bar.getElement().querySelector(".status-bar__room");
      expect(roomEl?.textContent).toBe("#general:matrix.org");
    });

    it("shows — when null is passed", () => {
      bar.setRoom("#general:matrix.org");
      bar.setRoom(null);

      const roomEl = bar.getElement().querySelector(".status-bar__room");
      expect(roomEl?.textContent).toBe("—");
    });
  });

  describe("setEncrypted", () => {
    it("shows lock icon when encrypted", () => {
      bar.setEncrypted(true);

      const encEl = bar.getElement().querySelector(".status-bar__encryption");
      expect(encEl?.textContent).toBe("🔒");
    });

    it("shows unlock icon when not encrypted", () => {
      bar.setEncrypted(false);

      const encEl = bar.getElement().querySelector(".status-bar__encryption");
      expect(encEl?.textContent).toBe("🔓");
    });

    it("adds --on class when encrypted", () => {
      bar.setEncrypted(true);

      const encEl = bar.getElement().querySelector(".status-bar__encryption");
      expect(encEl?.classList.contains("status-bar__encryption--on")).toBe(true);
    });

    it("adds --off class when not encrypted", () => {
      bar.setEncrypted(false);

      const encEl = bar.getElement().querySelector(".status-bar__encryption");
      expect(encEl?.classList.contains("status-bar__encryption--off")).toBe(true);
    });

    it("updates aria-label for encrypted state", () => {
      bar.setEncrypted(true);

      const encEl = bar.getElement().querySelector(".status-bar__encryption");
      expect(encEl?.getAttribute("aria-label")).toBe("End-to-end encrypted");
    });

    it("updates aria-label for unencrypted state", () => {
      bar.setEncrypted(false);

      const encEl = bar.getElement().querySelector(".status-bar__encryption");
      expect(encEl?.getAttribute("aria-label")).toBe("Not encrypted");
    });
  });

  describe("setConnected", () => {
    it("shows offline by default", () => {
      const connEl = bar.getElement().querySelector(".status-bar__connection");
      expect(connEl?.textContent).toBe("offline");
    });

    it("shows online when connected", () => {
      bar.setConnected(true);

      const connEl = bar.getElement().querySelector(".status-bar__connection");
      expect(connEl?.textContent).toBe("online");
    });

    it("shows offline when disconnected", () => {
      bar.setConnected(true);
      bar.setConnected(false);

      const connEl = bar.getElement().querySelector(".status-bar__connection");
      expect(connEl?.textContent).toBe("offline");
    });

    it("adds --online class when connected", () => {
      bar.setConnected(true);

      const connEl = bar.getElement().querySelector(".status-bar__connection");
      expect(connEl?.classList.contains("status-bar__connection--online")).toBe(true);
    });

    it("adds --offline class when disconnected", () => {
      bar.setConnected(false);

      const connEl = bar.getElement().querySelector(".status-bar__connection");
      expect(connEl?.classList.contains("status-bar__connection--offline")).toBe(true);
    });
  });
});
