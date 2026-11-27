import { describe, it, expect, beforeEach, vi } from "vitest";

// Shortcut tabs: a tab that opens one room or DM, drawn with its avatar.

vi.mock("../../ipc/index.js", () => ({
  markRoomRead: vi.fn().mockResolvedValue(undefined),
  openRoomTimeline: vi.fn(),
  getRoomMembers: vi.fn().mockResolvedValue([]),
  getRoomReceipts: vi.fn().mockResolvedValue([]),
  downloadMedia: vi.fn().mockResolvedValue({ mime_type: "image/png", data_base64: "AA==" }),
  getTimeline: vi.fn().mockResolvedValue({ events: [], prev_batch: null }),
  loadOlderTimeline: vi.fn().mockResolvedValue({ events: [], reached_start: true }),
  paginateForward: vi.fn().mockResolvedValue({ events: [], next_batch: null }),
  getEventContext: vi.fn(),
  getRooms: vi.fn().mockResolvedValue([]),
  getSpaceChildren: vi.fn().mockResolvedValue([]),
  getUserSpaces: vi.fn().mockResolvedValue([]),
  setRoomTag: vi.fn(),
}));
vi.mock("../../ipc/notifications.js", () => ({ clearRoomNotificationsIpc: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../mobile.js", () => ({ isMobile: () => false, closeDrawer: vi.fn() }));
vi.mock("./threads.js", () => ({ closeThread: vi.fn(), openThread: vi.fn(), openThreadEvents: vi.fn() }));
vi.mock("./messages.js", () => ({ cancelReply: vi.fn(), cancelEdit: vi.fn() }));
vi.mock("./dialogs.js", () => ({ openRoomSettings: vi.fn() }));
vi.mock("./profile.js", () => ({ openProfileForUser: vi.fn() }));
vi.mock("../../ui/NotificationToast.js", () => ({ showError: vi.fn(), showSuccess: vi.fn(), showToast: vi.fn() }));
vi.mock("./context.js", async (importActual) => {
  const actual = await importActual<typeof import("./context.js")>();
  return {
    ...actual,
    _mediaToBlobUrl: (mime: string) => `blob:${mime}`,
    _downloadMessageImages: vi.fn(),
    _downloadReactionEmoji: vi.fn(),
    _downloadInlineEmoji: vi.fn(),
    _downloadMemberAvatars: vi.fn(),
    ensureSenderAvatarDownloaded: vi.fn(),
  };
});

const { selectSpace } = await import("./rooms.js");
const { bindRoomViews, pinRoomTab } = await import("./views.js");
const { setComponents } = await import("./context.js");
const { AppState } = await import("../state.js");
const { RoomList } = await import("../../ui/RoomList.js");
const { SpaceStrip } = await import("../../ui/SpaceStrip.js");
const { newShortcutView, parseViews, serializeViews } = await import("../room_views.js");
const { allViews, getView, initViewStore, prepareViews } = await import("../view_store.js");
const ipc = await import("../../ipc/index.js");
const { showError, showSuccess } = await import("../../ui/NotificationToast.js");
import type { AppComponents } from "../../ui/App.js";
import type { RoomInfo } from "../../ipc/types.js";

const room = (id: string, over: Partial<RoomInfo> = {}): RoomInfo => ({
  room_id: id, name: id.slice(1, id.indexOf(":")), topic: null, avatar_url: null,
  unread_count: 0, notification_count: 0, is_direct: false, is_encrypted: false, member_count: 3,
  ...over,
});

let roomList: InstanceType<typeof RoomList>;
let spaceStrip: InstanceType<typeof SpaceStrip>;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.clearAllMocks();
  const stub = () => new Proxy({}, { get: () => vi.fn() });
  const typingIndicator = document.createElement("div");
  const txt = document.createElement("span");
  txt.className = "typing-indicator__text";
  typingIndicator.appendChild(txt);
  roomList = new RoomList();
  spaceStrip = new SpaceStrip();
  setComponents({
    roomList, spaceStrip, typingIndicator,
    roomHeader: stub(), timeline: stub(), memberList: stub(), statusBar: stub(), mobileTopBar: stub(), input: stub(),
  } as unknown as AppComponents);
  AppState.patch({
    currentSpaceId: null,
    currentRoomId: null,
    homeViewActive: false,
    ownUserId: "@me:x",
    roomViews: parseViews(null),
    roomListCache: [room("!dev:x"), room("!alice:x", { is_direct: true, name: "Alice" })],
    spaceMembers: {},
  });
  const current = async () => serializeViews(AppState.get("roomViews"));
  initViewStore({ getRoomViews: current, fetchRoomViews: current, setRoomViews: vi.fn(async () => {}) }, vi.fn());
  await prepareViews();
});

const addShortcut = (roomId: string, name: string, over = {}) => {
  const v = { ...newShortcutView({ room_id: roomId, name }, allViews().map((x) => x.id)), ...over };
  AppState.set("roomViews", [...allViews(), v]);
  return v;
};

describe("selecting a shortcut tab", () => {
  it("opens its room and lists that room alone", async () => {
    const v = addShortcut("!dev:x", "dev");
    await selectSpace(v.id);
    expect(AppState.get("currentRoomId")).toBe("!dev:x");
    expect(AppState.get("activePanel")).toBe("timeline");
    const listed = [...roomList.getElement().querySelectorAll<HTMLElement>(".room-list__item")].map((e) => e.dataset.roomId);
    expect(listed).toEqual(["!dev:x"]);
  });

  it("says so when its room was left, and leaves no other room open", async () => {
    const v = addShortcut("!gone:x", "gone");
    AppState.set("currentRoomId", "!dev:x");
    await selectSpace(v.id);
    expect(AppState.get("currentRoomId")).toBeNull();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("any more"));
  });

  it("goes to the new room when the tab being viewed is pointed elsewhere", async () => {
    const unbind = bindRoomViews();
    const v = addShortcut("!dev:x", "dev");
    await selectSpace(v.id);
    AppState.set("roomViews", allViews().map((x) => (x.id === v.id ? { ...x, roomId: "!alice:x" } : x)));
    await flush();
    expect(AppState.get("currentRoomId")).toBe("!alice:x");
    unbind();
  });
});

describe("pinRoomTab", () => {
  it("adds a tab named after the room that opens it", async () => {
    await pinRoomTab("!alice:x");
    const v = allViews().find((x) => x.roomId === "!alice:x");
    expect(v).toMatchObject({ label: "Alice", avatar: true, position: "top", hidden: false });
    expect(showSuccess).toHaveBeenCalledWith("Added Alice to the strip");
  });

  it("shows the room's existing tab again rather than adding a second", async () => {
    const v = addShortcut("!alice:x", "Alice", { hidden: true });
    const before = allViews().length;
    await pinRoomTab("!alice:x");
    expect(allViews()).toHaveLength(before);
    expect(getView(v.id)?.hidden).toBe(false);
  });
});

describe("shortcut avatars", () => {
  const img = (viewId: string) =>
    spaceStrip.getElement().querySelector<HTMLImageElement>(`[data-space-id="${viewId}"] img`);

  it("draws a DM partner's profile picture, looked up once however often the list changes", async () => {
    vi.mocked(ipc.getRoomMembers).mockResolvedValue([
      { user_id: "@me:x", display_name: "Me", avatar_url: "mxc://x/me", power_level: "user", presence: null },
      { user_id: "@alice:x", display_name: "Alice", avatar_url: "mxc://x/alice", power_level: "user", presence: null },
    ] as never);
    // A DM no earlier test has looked up (the lookups outlive a test).
    AppState.set("roomListCache", [room("!bob:x", { is_direct: true, name: "Alice" })]);
    const unbind = bindRoomViews();
    const v = addShortcut("!bob:x", "Alice");
    await flush();
    expect(ipc.getRoomMembers).toHaveBeenCalledWith("!bob:x");
    expect(ipc.downloadMedia).toHaveBeenCalledWith("mxc://x/alice");
    expect(img(v.id)?.getAttribute("src")).toBe("blob:image/png");
    // Every incoming message rewrites the room list.
    AppState.set("roomListCache", [...AppState.get("roomListCache")]);
    AppState.set("roomListCache", [...AppState.get("roomListCache")]);
    await flush();
    expect(ipc.getRoomMembers).toHaveBeenCalledTimes(1);
    unbind();
  });

  it("draws a room's own avatar, and nothing for a tab with the picture off", async () => {
    AppState.set("roomListCache", [room("!dev:x", { avatar_url: "mxc://x/dev" })]);
    const unbind = bindRoomViews();
    const on = addShortcut("!dev:x", "dev");
    const off = addShortcut("!dev:x", "dev too", { avatar: false });
    await flush();
    expect(ipc.getRoomMembers).not.toHaveBeenCalled();
    expect(ipc.downloadMedia).toHaveBeenCalledWith("mxc://x/dev");
    expect(img(on.id)).not.toBeNull();
    expect(img(off.id)).toBeNull();
    unbind();
  });
});
