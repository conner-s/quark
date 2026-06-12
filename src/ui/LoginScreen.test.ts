import { describe, it, expect, beforeEach, vi } from "vitest";
import { LoginScreen } from "./LoginScreen.js";

describe("LoginScreen", () => {
  let screen: LoginScreen;

  beforeEach(() => {
    screen = new LoginScreen();
    document.body.appendChild(screen.getElement());
  });

  afterEach(() => {
    screen.getElement().remove();
  });

  describe("rendering", () => {
    it("renders homeserver input field", () => {
      const el = screen.getElement();
      const hs = el.querySelector<HTMLInputElement>("#login-homeserver");
      expect(hs).not.toBeNull();
      expect(hs?.type).toBe("url");
    });

    it("renders username input field", () => {
      const el = screen.getElement();
      const user = el.querySelector<HTMLInputElement>("#login-username");
      expect(user).not.toBeNull();
      expect(user?.type).toBe("text");
    });

    it("renders password input field", () => {
      const el = screen.getElement();
      const pass = el.querySelector<HTMLInputElement>("#login-password");
      expect(pass).not.toBeNull();
      expect(pass?.type).toBe("password");
    });

    it("renders a submit button", () => {
      const btn = screen.getElement().querySelector<HTMLButtonElement>(".login-screen__submit");
      expect(btn).not.toBeNull();
      expect(btn?.type).toBe("submit");
    });

    it("pre-fills homeserver with https://matrix.org", () => {
      const hs = screen.getElement().querySelector<HTMLInputElement>("#login-homeserver");
      expect(hs?.value).toBe("https://matrix.org");
    });

    it("renders an ASCII banner", () => {
      const banner = screen.getElement().querySelector(".login-screen__banner");
      expect(banner).not.toBeNull();
      // Banner is block-character art — verify it is non-empty and contains
      // the block-drawing characters used to spell the logo.
      expect(banner?.textContent?.length).toBeGreaterThan(0);
      expect(banner?.textContent).toContain("██");
    });
  });

  describe("onLogin callback", () => {
    it("fires with correct homeserver, username and password on submit", async () => {
      const callback = vi.fn();
      screen.onLogin(callback);

      const hs = screen.getElement().querySelector<HTMLInputElement>("#login-homeserver");
      const user = screen.getElement().querySelector<HTMLInputElement>("#login-username");
      const pass = screen.getElement().querySelector<HTMLInputElement>("#login-password");
      const form = screen.getElement().querySelector<HTMLFormElement>("form");

      if (hs) hs.value = "https://my.server.org";
      if (user) user.value = "@bob:my.server.org";
      if (pass) pass.value = "s3cr3t";

      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      // Allow async handler to run
      await new Promise((r) => setTimeout(r, 0));

      expect(callback).toHaveBeenCalledWith(
        "https://my.server.org",
        "@bob:my.server.org",
        "s3cr3t"
      );
    });

    it("does not fire when homeserver is empty", async () => {
      const callback = vi.fn();
      screen.onLogin(callback);

      const hs = screen.getElement().querySelector<HTMLInputElement>("#login-homeserver");
      if (hs) hs.value = "";

      const form = screen.getElement().querySelector<HTMLFormElement>("form");
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      await new Promise((r) => setTimeout(r, 0));

      expect(callback).not.toHaveBeenCalled();
    });

    it("does not fire when username is empty", async () => {
      const callback = vi.fn();
      screen.onLogin(callback);

      const user = screen.getElement().querySelector<HTMLInputElement>("#login-username");
      if (user) user.value = "";

      const form = screen.getElement().querySelector<HTMLFormElement>("form");
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      await new Promise((r) => setTimeout(r, 0));

      expect(callback).not.toHaveBeenCalled();
    });

    it("does not fire when password is empty", async () => {
      const callback = vi.fn();
      screen.onLogin(callback);

      const hs = screen.getElement().querySelector<HTMLInputElement>("#login-homeserver");
      const user = screen.getElement().querySelector<HTMLInputElement>("#login-username");
      const pass = screen.getElement().querySelector<HTMLInputElement>("#login-password");

      if (hs) hs.value = "https://matrix.org";
      if (user) user.value = "@alice:matrix.org";
      if (pass) pass.value = "";

      const form = screen.getElement().querySelector<HTMLFormElement>("form");
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      await new Promise((r) => setTimeout(r, 0));

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("status messages", () => {
    it("setStatus displays the message with a > prefix", () => {
      screen.setStatus("connecting to server", "info");

      const statusEl = screen.getElement().querySelector(".login-screen__status");
      expect(statusEl?.textContent).toBe("> connecting to server");
    });

    it("setStatus adds the correct CSS modifier class for error", () => {
      screen.setStatus("invalid credentials", "error");

      const statusEl = screen.getElement().querySelector(".login-screen__status");
      expect(statusEl?.classList.contains("login-screen__status--error")).toBe(true);
    });

    it("setStatus adds the correct CSS modifier class for success", () => {
      screen.setStatus("logged in!", "success");

      const statusEl = screen.getElement().querySelector(".login-screen__status");
      expect(statusEl?.classList.contains("login-screen__status--success")).toBe(true);
    });

    it("shows validation error when homeserver is missing", async () => {
      const hs = screen.getElement().querySelector<HTMLInputElement>("#login-homeserver");
      if (hs) hs.value = "";

      const form = screen.getElement().querySelector<HTMLFormElement>("form");
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

      await new Promise((r) => setTimeout(r, 0));

      const statusEl = screen.getElement().querySelector(".login-screen__status");
      expect(statusEl?.textContent).toContain("homeserver");
    });
  });

  describe("setLoading", () => {
    it("disables the submit button when loading", () => {
      screen.setLoading(true);

      const btn = screen.getElement().querySelector<HTMLButtonElement>(".login-screen__submit");
      expect(btn?.disabled).toBe(true);
    });

    it("re-enables the submit button when done loading", () => {
      screen.setLoading(true);
      screen.setLoading(false);

      const btn = screen.getElement().querySelector<HTMLButtonElement>(".login-screen__submit");
      expect(btn?.disabled).toBe(false);
    });

    it("changes button text while loading", () => {
      screen.setLoading(true);

      const btn = screen.getElement().querySelector<HTMLButtonElement>(".login-screen__submit");
      expect(btn?.textContent).toContain("CONNECTING");
    });
  });
});
