import { describe, it, expect, beforeEach } from "vitest";
import { Timeline, type MessageData } from "./Timeline.js";

function makeMsg(overrides: Partial<MessageData> = {}): MessageData {
  return {
    id: "evt1",
    senderName: "Alice",
    timestamp: "2024-01-01T12:00:00Z",
    body: "Hello, world!",
    ...overrides,
  };
}

describe("Timeline", () => {
  let timeline: Timeline;

  beforeEach(() => {
    timeline = new Timeline();
    document.body.appendChild(timeline.getElement());
  });

  afterEach(() => {
    timeline.getElement().remove();
  });

  describe("setMessages", () => {
    it("renders messages with sender and body", () => {
      timeline.setMessages([
        makeMsg({ id: "e1", senderName: "Alice", body: "Hello" }),
        makeMsg({ id: "e2", senderName: "Bob", body: "Hi there" }),
      ]);

      const el = timeline.getElement();
      const senders = el.querySelectorAll(".message__sender");
      const bodies = el.querySelectorAll(".message__body");

      expect(senders).toHaveLength(2);
      expect(senders[0].textContent).toBe("<Alice>");
      expect(senders[1].textContent).toBe("<Bob>");
      expect(bodies[0].textContent).toBe("Hello");
      expect(bodies[1].textContent).toBe("Hi there");
    });

    it("replaces existing messages when called again", () => {
      timeline.setMessages([makeMsg({ id: "e1", body: "First" })]);
      timeline.setMessages([makeMsg({ id: "e2", body: "Second" })]);

      const bodies = timeline.getElement().querySelectorAll(".message__body");
      expect(bodies).toHaveLength(1);
      expect(bodies[0].textContent).toBe("Second");
    });

    it("renders a timestamp on each message", () => {
      timeline.setMessages([makeMsg({ timestamp: "2024-06-15T12:34:00Z" })]);

      const ts = timeline.getElement().querySelector(".message__timestamp");
      // The timestamp is formatted as HH:MM in local time; just verify it's non-empty
      // and has the expected HH:MM shape (two digits, colon, two digits).
      expect(ts?.textContent).toMatch(/^\d{2}:\d{2}$/);
      // The title attribute holds the original ISO string for full datetime
      expect(ts?.getAttribute("title")).toBe("2024-06-15T12:34:00Z");
    });

    it("adds own-sender class when isOwn is true", () => {
      timeline.setMessages([makeMsg({ isOwn: true })]);

      const sender = timeline.getElement().querySelector(".message__sender");
      expect(sender?.classList.contains("message__sender--own")).toBe(true);
    });
  });

  describe("appendMessage", () => {
    it("adds a message to the end", () => {
      timeline.setMessages([makeMsg({ id: "e1", body: "First" })]);
      timeline.appendMessage(makeMsg({ id: "e2", body: "Second" }));

      const bodies = timeline.getElement().querySelectorAll(".message__body");
      expect(bodies).toHaveLength(2);
      expect(bodies[1].textContent).toBe("Second");
    });

    it("does not remove existing messages", () => {
      timeline.setMessages([
        makeMsg({ id: "e1", body: "A" }),
        makeMsg({ id: "e2", body: "B" }),
      ]);
      timeline.appendMessage(makeMsg({ id: "e3", body: "C" }));

      const bodies = timeline.getElement().querySelectorAll(".message__body");
      expect(bodies).toHaveLength(3);
    });
  });

  describe("image messages", () => {
    it("renders an img tag for image type", () => {
      timeline.setMessages([
        makeMsg({
          type: "image",
          mediaUrl: "https://example.com/photo.jpg",
          mediaAlt: "A photo",
        }),
      ]);

      const img = timeline.getElement().querySelector<HTMLImageElement>(".message__image");
      expect(img).not.toBeNull();
      expect(img?.src).toBe("https://example.com/photo.jpg");
      expect(img?.alt).toBe("A photo");
    });

    it("renders an img tag for sticker type", () => {
      timeline.setMessages([
        makeMsg({
          type: "sticker",
          mediaUrl: "https://example.com/sticker.png",
          mediaAlt: "Cool sticker",
        }),
      ]);

      const img = timeline.getElement().querySelector<HTMLImageElement>(".message__sticker");
      expect(img).not.toBeNull();
      expect(img?.src).toBe("https://example.com/sticker.png");
    });

    it("does not render a text body for image messages", () => {
      timeline.setMessages([makeMsg({ type: "image", mediaUrl: "https://x.com/img.png" })]);

      const body = timeline.getElement().querySelector(".message__body");
      expect(body).toBeNull();
    });
  });

  describe("reply messages", () => {
    it("shows reply preview when replyTo is set", () => {
      timeline.setMessages([
        makeMsg({
          replyTo: { eventId: "$evt-orig", senderName: "Charlie", body: "Original message" },
        }),
      ]);

      const reply = timeline.getElement().querySelector(".reply-preview");
      expect(reply).not.toBeNull();

      const replySender = reply?.querySelector(".reply-preview__sender");
      expect(replySender?.textContent).toBe("Charlie");

      const replyBody = reply?.querySelector(".reply-preview__body");
      expect(replyBody?.textContent).toBe("Original message");
    });

    it("does not render reply preview when replyTo is absent", () => {
      timeline.setMessages([makeMsg()]);

      const reply = timeline.getElement().querySelector(".reply-preview");
      expect(reply).toBeNull();
    });
  });

  describe("system messages", () => {
    it("adds system class for system type messages", () => {
      timeline.setMessages([makeMsg({ type: "system", body: "Alice joined the room" })]);

      const msg = timeline.getElement().querySelector(".message");
      expect(msg?.classList.contains("message--system")).toBe(true);
    });

    it("does not render a sender header for system messages", () => {
      timeline.setMessages([makeMsg({ type: "system", body: "System event" })]);

      const header = timeline.getElement().querySelector(".message__header");
      expect(header).toBeNull();
    });
  });

  describe("reactions", () => {
    it("renders reaction bar when reactions are present", () => {
      timeline.setMessages([
        makeMsg({
          reactions: [{ key: "👍", count: 3, own: false }],
        }),
      ]);

      const bar = timeline.getElement().querySelector(".reaction-bar");
      expect(bar).not.toBeNull();
    });

    it("does not render reaction bar when no reactions", () => {
      timeline.setMessages([makeMsg()]);

      const bar = timeline.getElement().querySelector(".reaction-bar");
      expect(bar).toBeNull();
    });
  });
});
