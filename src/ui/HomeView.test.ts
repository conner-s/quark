import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HomeView, relativeAge, type HomeFloater } from "./HomeView.js";

function floater(over: Partial<HomeFloater> = {}): HomeFloater {
  return {
    roomId: "!a:x",
    name: "Alice",
    dmUserId: "@alice:x",
    avatarUrl: null,
    presence: "online",
    snippet: "hello there",
    statusMessage: null,
    lastTs: Date.now() - 5 * 60_000,
    unreadCount: 0,
    ...over,
  };
}

let view: HomeView;

beforeEach(() => {
  view = new HomeView();
  document.body.appendChild(view.getElement());
});

afterEach(() => {
  view.getElement().remove();
});

describe("relativeAge", () => {
  it("formats compact ages", () => {
    const now = 1_000_000_000_000;
    expect(relativeAge(now - 30_000, now)).toBe("now");
    expect(relativeAge(now - 5 * 60_000, now)).toBe("5m");
    expect(relativeAge(now - 3 * 3_600_000, now)).toBe("3h");
    expect(relativeAge(now - 49 * 3_600_000, now)).toBe("2d");
    expect(relativeAge(now + 60_000, now)).toBe("now"); // clock skew → clamp
  });
});

describe("HomeView", () => {
  it("renders one float per DM with name, snippet, and presence", () => {
    view.show(
      { userId: "@me:x", displayName: "Me", avatarUrl: null, statusMessage: null },
      [floater(), floater({ roomId: "!b:x", name: "Bob", presence: "offline" })],
    );
    const floats = view.getElement().querySelectorAll(".home-view__float");
    expect(floats).toHaveLength(2);
    expect(floats[0].querySelector(".home-view__bubble-name")?.textContent).toBe("Alice");
    expect(floats[0].querySelector(".home-view__bubble-text")?.textContent).toBe("hello there");
    expect(floats[0].querySelector(".home-view__presence--online")).toBeTruthy();
    expect(floats[1].querySelector(".home-view__presence--offline")).toBeTruthy();
  });

  it("assigns deterministic slots per room id", () => {
    const items = [floater(), floater({ roomId: "!b:x", name: "Bob" })];
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, items);
    const first = view.getElement().querySelector<HTMLElement>('[data-room-id="\\!a\\:x"]');
    const x1 = first?.style.getPropertyValue("--x");
    view.setFloaters(items);
    const again = view.getElement().querySelector<HTMLElement>('[data-room-id="\\!a\\:x"]');
    expect(again?.style.getPropertyValue("--x")).toBe(x1);
    expect(x1).toBeTruthy();
  });

  it("shows the empty state when there are no DMs", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, []);
    expect(view.getElement().querySelector(".home-view__empty")).toBeTruthy();
  });

  it("updates a bubble in place", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [floater()]);
    view.updateBubble("!a:x", "new message text", Date.now(), false);
    expect(
      view.getElement().querySelector(".home-view__bubble-text")?.textContent,
    ).toBe("new message text");
    expect(
      view.getElement().querySelector(".home-view__bubble-age")?.textContent,
    ).toBe("now");
  });

  it("shows the partner's status message when the chat is caught up", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [
      floater({ statusMessage: "gone fishing", unreadCount: 0 }),
    ]);
    const text = view.getElement().querySelector(".home-view__bubble-text");
    expect(text?.textContent).toBe("gone fishing");
    expect(text?.classList.contains("home-view__bubble-text--status")).toBe(true);
  });

  it("keeps the message preview while there are unreads, despite a status", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [
      floater({ statusMessage: "gone fishing", unreadCount: 2 }),
    ]);
    const text = view.getElement().querySelector(".home-view__bubble-text");
    expect(text?.textContent).toBe("hello there");
    expect(text?.classList.contains("home-view__bubble-text--status")).toBe(false);
  });

  it("flips to the status message when it arrives, and back when cleared", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [floater()]);
    view.updateStatusMessage("@alice:x", "shipping 0.15");
    const text = view.getElement().querySelector(".home-view__bubble-text");
    expect(text?.textContent).toBe("shipping 0.15");
    view.updateStatusMessage("@alice:x", null);
    expect(text?.textContent).toBe("hello there");
  });

  it("flips a status bubble back to the preview on a live partner message", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [
      floater({ statusMessage: "gone fishing" }),
    ]);
    const text = view.getElement().querySelector(".home-view__bubble-text");
    expect(text?.textContent).toBe("gone fishing");
    view.updateBubble("!a:x", "are you around?", Date.now(), true);
    expect(text?.textContent).toBe("are you around?");
    // The partner message also bumps the unread badge live.
    expect(view.getElement().querySelector(".home-view__float-badge")?.textContent).toBe("1");
  });

  it("keeps the status bubble for own message echoes (still caught up)", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [
      floater({ statusMessage: "gone fishing" }),
    ]);
    view.updateBubble("!a:x", "you: see you there", Date.now(), false);
    const text = view.getElement().querySelector(".home-view__bubble-text");
    expect(text?.textContent).toBe("gone fishing");
    expect(view.getElement().querySelector(".home-view__float-badge")).toBeNull();
  });

  it("updates presence dots by user id", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [floater()]);
    view.updatePresence("@alice:x", "unavailable");
    expect(view.getElement().querySelector(".home-view__presence--unavailable")).toBeTruthy();
    expect(view.getElement().querySelector(".home-view__presence--online")).toBeFalsy();
  });

  it("renders an unread badge", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [
      floater({ unreadCount: 12 }),
    ]);
    expect(view.getElement().querySelector(".home-view__float-badge")?.textContent).toBe("9+");
  });

  it("paints a late-resolving avatar", () => {
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [floater()]);
    view.updateFloaterAvatar("!a:x", "blob:fake-url");
    const img = view.getElement().querySelector<HTMLImageElement>(".home-view__float-avatar img");
    expect(img?.src).toContain("blob:fake-url");
  });

  it("cycles focus with navNext/navPrev and opens with Enter", () => {
    const onOpenRoom = vi.fn();
    view.setHandlers({ onOpenRoom, onSaveStatus: vi.fn(), onChangeAvatar: vi.fn() });
    view.show({ userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: null }, [
      floater(),
      floater({ roomId: "!b:x", name: "Bob" }),
    ]);
    view.focusActive();
    expect((document.activeElement as HTMLElement).dataset.roomId).toBe("!a:x");
    view.navNext();
    expect((document.activeElement as HTMLElement).dataset.roomId).toBe("!b:x");
    view.navNext(); // wraps
    expect((document.activeElement as HTMLElement).dataset.roomId).toBe("!a:x");
    view.navPrev(); // wraps backwards
    expect((document.activeElement as HTMLElement).dataset.roomId).toBe("!b:x");
    view.selectFocused();
    expect(onOpenRoom).toHaveBeenCalledExactlyOnceWith("!b:x");
  });

  it("saves the status only when changed, on Enter", () => {
    const onSaveStatus = vi.fn();
    view.setHandlers({ onOpenRoom: vi.fn(), onSaveStatus, onChangeAvatar: vi.fn() });
    view.show(
      { userId: "@me:x", displayName: null, avatarUrl: null, statusMessage: "old status" },
      [],
    );
    const input = view.getElement().querySelector<HTMLInputElement>(".home-view__profile-status")!;
    expect(input.value).toBe("old status");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSaveStatus).not.toHaveBeenCalled(); // unchanged
    input.value = "shipping 0.14.0";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSaveStatus).toHaveBeenCalledExactlyOnceWith("shipping 0.14.0");
  });
});
