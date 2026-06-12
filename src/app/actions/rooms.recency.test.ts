import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bumpRoomActivity, resortPseudoSpaceView } from "./rooms.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import { RoomList } from "../../ui/RoomList.js";
import type { AppComponents } from "../../ui/App.js";
import type { RoomInfo } from "../../ipc/types.js";

// bumpRoomActivity keeps the recency-sorted pseudo-space views (Home/DMs/
// Groups) live: a sync message bumps the room's last_activity_ts in the cache
// and re-sorts the visible list after a debounce, preserving keyboard focus.

function makeDm(id: string, ts: number, over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    room_id: id,
    name: id.replace(/[!:].*/g, "") || id,
    topic: null,
    avatar_url: null,
    unread_count: 0,
    notification_count: 0,
    is_direct: true,
    is_encrypted: false,
    member_count: 2,
    last_activity_ts: ts,
    ...over,
  };
}

let roomList: RoomList;

function renderedIds(): string[] {
  return Array.from(
    roomList.getElement().querySelectorAll<HTMLElement>(".room-list__item"),
  ).map((el) => el.dataset.roomId!);
}

beforeEach(() => {
  vi.useFakeTimers();
  roomList = new RoomList();
  document.body.appendChild(roomList.getElement());
  setComponents({ roomList } as unknown as AppComponents);
  AppState.patch({
    roomListCache: [makeDm("!a:x", 300), makeDm("!b:x", 200), makeDm("!c:x", 100)],
    currentSpaceId: "__dms__",
    spaceRoomIds: [],
  });
  resortPseudoSpaceView();
});

afterEach(() => {
  roomList.getElement().remove();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("bumpRoomActivity", () => {
  it("raises last_activity_ts on the matching cached room", () => {
    bumpRoomActivity("!c:x", 400);
    const c = AppState.get("roomListCache").find((r) => r.room_id === "!c:x")!;
    expect(c.last_activity_ts).toBe(400);
  });

  it("ignores out-of-order timestamps older than the cached one", () => {
    bumpRoomActivity("!a:x", 50);
    const a = AppState.get("roomListCache").find((r) => r.room_id === "!a:x")!;
    expect(a.last_activity_ts).toBe(300);
  });

  it("re-sorts the visible pseudo-space view after the debounce", () => {
    expect(renderedIds()).toEqual(["!a:x", "!b:x", "!c:x"]);
    bumpRoomActivity("!c:x", 400);
    expect(renderedIds()).toEqual(["!a:x", "!b:x", "!c:x"]); // not yet — debounced
    vi.runAllTimers();
    expect(renderedIds()).toEqual(["!c:x", "!a:x", "!b:x"]);
  });

  it("coalesces a burst of bumps into a single re-render", () => {
    const spy = vi.spyOn(roomList, "setRooms");
    bumpRoomActivity("!c:x", 400);
    bumpRoomActivity("!b:x", 500);
    vi.runAllTimers();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(renderedIds()).toEqual(["!b:x", "!c:x", "!a:x"]);
  });

  it("restores keyboard focus to the same room across a re-sort", () => {
    roomList.focusRoom("!b:x");
    expect((document.activeElement as HTMLElement).dataset.roomId).toBe("!b:x");
    bumpRoomActivity("!c:x", 400);
    vi.runAllTimers();
    expect((document.activeElement as HTMLElement).dataset.roomId).toBe("!b:x");
  });

  it("does not steal focus when it was outside the list", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    bumpRoomActivity("!c:x", 400);
    vi.runAllTimers();
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("does not re-sort when a real space is selected", () => {
    AppState.set("currentSpaceId", "!space:x");
    roomList.setRooms([
      { id: "!a:x", name: "a" },
      { id: "!b:x", name: "b" },
    ]);
    bumpRoomActivity("!b:x", 999);
    vi.runAllTimers();
    expect(renderedIds()).toEqual(["!a:x", "!b:x"]); // fixed space order untouched
  });

  it("is a no-op for rooms missing from the cache", () => {
    const spy = vi.spyOn(roomList, "setRooms");
    bumpRoomActivity("!nope:x", 999);
    vi.runAllTimers();
    expect(spy).not.toHaveBeenCalled();
  });
});
