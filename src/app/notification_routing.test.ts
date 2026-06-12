import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy module graphs before importing the unit under test.
vi.mock("@tauri-apps/plugin-notification", () => ({
  onAction: vi.fn(),
  registerActionTypes: vi.fn(),
}));
vi.mock("../ipc/index.js", () => ({
  getPlatform: vi.fn(async () => "android"),
  sendMessage: vi.fn(async () => "$sent"),
  markRoomRead: vi.fn(async () => undefined),
}));
vi.mock("../ipc/notifications.js", () => ({
  clearRoomNotificationsIpc: vi.fn(async () => undefined),
  takePendingNotificationAction: vi.fn(async () => null),
}));
vi.mock("./actions.js", () => ({
  selectRoom: vi.fn(async () => undefined),
}));
vi.mock("../ui/NotificationToast.js", () => ({
  showError: vi.fn(),
}));

import { routeNotificationAction } from "./notification_routing.js";
import { sendMessage, markRoomRead } from "../ipc/index.js";
import { clearRoomNotificationsIpc } from "../ipc/notifications.js";
import { selectRoom } from "./actions.js";
import { showError } from "../ui/NotificationToast.js";

const ROOM = "!room:example.com";
const withRoom = (over: Record<string, unknown> = {}) => ({
  notification: { extra: { room_id: ROOM } },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("routeNotificationAction", () => {
  it("opens the room on tap", async () => {
    await routeNotificationAction(withRoom({ actionId: "tap" }));
    expect(selectRoom).toHaveBeenCalledExactlyOnceWith(ROOM);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("treats a missing actionId as a tap", async () => {
    await routeNotificationAction(withRoom());
    expect(selectRoom).toHaveBeenCalledExactlyOnceWith(ROOM);
  });

  it("opens the room for unknown action ids", async () => {
    await routeNotificationAction(withRoom({ actionId: "mystery" }));
    expect(selectRoom).toHaveBeenCalledExactlyOnceWith(ROOM);
  });

  it("does nothing without a room_id in the payload", async () => {
    await routeNotificationAction({ actionId: "tap", notification: { extra: {} } });
    await routeNotificationAction({ actionId: "tap", notification: null });
    await routeNotificationAction({ actionId: "tap" });
    expect(selectRoom).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends an inline reply, marks read, and dismisses — without opening the room", async () => {
    await routeNotificationAction(withRoom({ actionId: "reply", inputValue: "  hi there " }));
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(ROOM, "hi there");
    expect(markRoomRead).toHaveBeenCalledExactlyOnceWith(ROOM);
    expect(clearRoomNotificationsIpc).toHaveBeenCalledExactlyOnceWith(ROOM);
    expect(selectRoom).not.toHaveBeenCalled();
  });

  it("falls back to opening the room when the reply text is empty", async () => {
    await routeNotificationAction(withRoom({ actionId: "reply", inputValue: "   " }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(selectRoom).toHaveBeenCalledExactlyOnceWith(ROOM);
  });

  it("surfaces a failed reply and opens the room for retry", async () => {
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error("M_FORBIDDEN"));
    await routeNotificationAction(withRoom({ actionId: "reply", inputValue: "hi" }));
    expect(showError).toHaveBeenCalledOnce();
    expect(selectRoom).toHaveBeenCalledExactlyOnceWith(ROOM);
  });

  it("marks read and dismisses on mark_read — without opening the room", async () => {
    await routeNotificationAction(withRoom({ actionId: "mark_read" }));
    expect(markRoomRead).toHaveBeenCalledExactlyOnceWith(ROOM);
    expect(clearRoomNotificationsIpc).toHaveBeenCalledExactlyOnceWith(ROOM);
    expect(selectRoom).not.toHaveBeenCalled();
  });
});
