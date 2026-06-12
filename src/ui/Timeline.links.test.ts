import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Linkification regression guard for the "links opened twice on desktop" fix
// (145ea6f). The bug: anchors carried target="_blank", which makes wry open the
// URL in the system browser by itself — and the click handler ALSO calls
// openExternalUrl(), so every link opened twice. The fix sets target="_blank"
// on mobile only. Nothing tested this path, so it could silently regress.
//
// These live in their own file because they mock ../app/mobile.js and
// ../ipc/invoke.js module-wide; keeping them out of Timeline.test.ts avoids
// perturbing the rendering tests there.

vi.mock("../app/mobile.js", async (importActual) => {
  const actual = await importActual<typeof import("../app/mobile.js")>();
  return { ...actual, isMobile: vi.fn(() => false) };
});

vi.mock("../ipc/invoke.js", async (importActual) => {
  const actual = await importActual<typeof import("../ipc/invoke.js")>();
  return { ...actual, invoke: vi.fn(() => Promise.resolve(undefined)) };
});

import { Timeline, type MessageData } from "./Timeline.js";
import { isMobile } from "../app/mobile.js";
import { invoke } from "../ipc/invoke.js";

const mockIsMobile = vi.mocked(isMobile);
const mockInvoke = vi.mocked(invoke);

function makeMsg(overrides: Partial<MessageData> = {}): MessageData {
  return {
    id: "evt1",
    senderName: "Alice",
    timestamp: "2024-01-01T12:00:00Z",
    body: "",
    ...overrides,
  };
}

function clickEvent(): MouseEvent {
  return new MouseEvent("click", { bubbles: true, cancelable: true });
}

/**
 * Calls to invoke("open_external_url", …) only. The timeline also fires
 * `get_url_preview` on render, so we filter to the open command — counting it
 * is the precise expression of the "opened twice" regression.
 */
function openCalls(): Array<Record<string, unknown> | undefined> {
  return mockInvoke.mock.calls
    .filter((c) => c[0] === "open_external_url")
    .map((c) => c[1] as Record<string, unknown> | undefined);
}

describe("Timeline linkification", () => {
  let timeline: Timeline;

  beforeEach(() => {
    mockIsMobile.mockReturnValue(false); // desktop by default
    mockInvoke.mockClear();
    timeline = new Timeline();
    document.body.appendChild(timeline.getElement());
  });

  afterEach(() => {
    timeline.getElement().remove();
  });

  function links(): HTMLAnchorElement[] {
    return Array.from(timeline.getElement().querySelectorAll<HTMLAnchorElement>("a.message__link"));
  }

  describe("plain-text bodies", () => {
    it("renders http(s) URLs as anchors with the URL as href and text", () => {
      timeline.setMessages([makeMsg({ body: "see https://example.com/page for more" })]);
      const as = links();
      expect(as).toHaveLength(1);
      expect(as[0].getAttribute("href")).toBe("https://example.com/page");
      expect(as[0].textContent).toBe("https://example.com/page");
    });

    it("on DESKTOP, link has NO target=_blank (this is the double-open fix)", () => {
      mockIsMobile.mockReturnValue(false);
      timeline.setMessages([makeMsg({ body: "https://example.com" })]);
      expect(links()[0].hasAttribute("target")).toBe(false);
    });

    it("on MOBILE, link gets target=_blank", () => {
      mockIsMobile.mockReturnValue(true);
      timeline.setMessages([makeMsg({ body: "https://example.com" })]);
      expect(links()[0].getAttribute("target")).toBe("_blank");
    });

    it("clicking a link opens it exactly ONCE via openExternalUrl, and prevents default navigation", () => {
      timeline.setMessages([makeMsg({ body: "go https://example.com/x" })]);
      const a = links()[0];
      const evt = clickEvent();
      a.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
      expect(openCalls()).toEqual([{ url: "https://example.com/x" }]);
    });

    it("strips trailing sentence punctuation from the linked URL", () => {
      timeline.setMessages([makeMsg({ body: "visit https://example.com/page." })]);
      const a = links()[0];
      expect(a.getAttribute("href")).toBe("https://example.com/page");
    });

    it("sets rel=noopener noreferrer for safety", () => {
      timeline.setMessages([makeMsg({ body: "https://example.com" })]);
      expect(links()[0].rel).toBe("noopener noreferrer");
    });

    it("linkifies multiple URLs and leaves surrounding text intact", () => {
      timeline.setMessages([
        makeMsg({ body: "a https://one.test b https://two.test c" }),
      ]);
      const as = links();
      expect(as.map((a) => a.getAttribute("href"))).toEqual([
        "https://one.test",
        "https://two.test",
      ]);
      const bodyText = timeline.getElement().querySelector(".message__body")?.textContent;
      expect(bodyText).toContain("a ");
      expect(bodyText).toContain(" b ");
      expect(bodyText).toContain(" c");
    });

    it("leaves a body with no URLs as plain text (no anchors)", () => {
      timeline.setMessages([makeMsg({ body: "just a normal message" })]);
      expect(links()).toHaveLength(0);
    });
  });

  describe("HTML bodies (htmlBody)", () => {
    it("on DESKTOP, http anchors in HTML get no target=_blank but still route through openExternalUrl", () => {
      mockIsMobile.mockReturnValue(false);
      timeline.setMessages([
        makeMsg({ body: "x", htmlBody: '<a href="https://example.com/y">link</a>' }),
      ]);
      const a = timeline.getElement().querySelector<HTMLAnchorElement>(".message__body a[href]");
      expect(a).not.toBeNull();
      expect(a!.hasAttribute("target")).toBe(false);

      const evt = clickEvent();
      a!.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
      expect(openCalls()).toEqual([{ url: "https://example.com/y" }]);
    });

    it("on MOBILE, http anchors in HTML get target=_blank", () => {
      mockIsMobile.mockReturnValue(true);
      timeline.setMessages([
        makeMsg({ body: "x", htmlBody: '<a href="https://example.com/y">link</a>' }),
      ]);
      const a = timeline.getElement().querySelector<HTMLAnchorElement>(".message__body a[href]");
      expect(a!.getAttribute("target")).toBe("_blank");
    });

    it("neutralises non-http hrefs (no navigation target, marked role=link)", () => {
      timeline.setMessages([
        makeMsg({ body: "x", htmlBody: '<a href="javascript:alert(1)">x</a>' }),
      ]);
      const a = timeline.getElement().querySelector<HTMLAnchorElement>(".message__body a");
      expect(a!.hasAttribute("href")).toBe(false);
      expect(a!.getAttribute("role")).toBe("link");
    });
  });
});
