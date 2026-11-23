import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The room list header names what is listed and, for a tab, offers its sort.

vi.mock("../../ui/NotificationToast.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/NotificationToast.js")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn(), showToast: vi.fn() };
});

const { bindRoomListHeader, groupTab, sortTab, tabSortMenu } = await import("./views.js");
const { setComponents } = await import("./context.js");
const { AppState } = await import("../state.js");
const { RoomList } = await import("../../ui/RoomList.js");
const { showError } = await import("../../ui/NotificationToast.js");
const { ALL_VIEW_ID, DMS_VIEW_ID, newView, parseViews, serializeViews } = await import("../room_views.js");
const { getView, initViewStore, prepareViews } = await import("../view_store.js");
type ContextMenuItem = import("../../ui/ContextMenu.js").ContextMenuItem;

let roomList: InstanceType<typeof RoomList>;
let unbind: () => void;
const title = () => roomList.getHeaderElement().querySelector(".room-list__header-label")!.textContent;
const sortBtn = () => roomList.getHeaderElement().querySelector<HTMLButtonElement>(".room-list__header-sort")!;

beforeEach(async () => {
  vi.clearAllMocks();
  roomList = new RoomList();
  setComponents({ roomList } as never);
  AppState.patch({
    currentSpaceId: null,
    roomViews: parseViews(null),
    topLevelSpaces: [{ id: "!work:x", name: "Work" }],
    roomListCache: [],
  });
  const current = async () => serializeViews(AppState.get("roomViews"));
  initViewStore({ getRoomViews: current, fetchRoomViews: current, setRoomViews: vi.fn(async () => {}) }, vi.fn());
  await prepareViews();
  unbind = bindRoomListHeader();
});

afterEach(() => unbind());

describe("the room list header", () => {
  it("names the startup list after the default tab", () => {
    expect(title()).toBe("Home");
    expect(sortBtn().hidden).toBe(false);
  });

  it("follows the selected tab, its sort included", () => {
    AppState.set("currentSpaceId", DMS_VIEW_ID);
    expect(title()).toBe(getView(DMS_VIEW_ID)!.label);
    expect(sortBtn().textContent).toBe("recent ▾");
  });

  it("names a space and hides the sort, which is the space's own", () => {
    AppState.set("currentSpaceId", "!work:x");
    expect(title()).toBe("Work");
    expect(sortBtn().hidden).toBe(true);
  });

  it("follows a tab renamed or re-sorted, here or elsewhere", () => {
    const mine = { ...newView("Mine", []), sort: "name" as const };
    AppState.patch({ roomViews: [...parseViews(null), mine], currentSpaceId: mine.id });
    expect(title()).toBe("Mine");
    expect(sortBtn().textContent).toBe("a–z ▾");
    AppState.set("roomViews", AppState.get("roomViews").map((v) => (v.id === mine.id ? { ...v, label: "Ours" } : v)));
    expect(title()).toBe("Ours");
  });

  it("opens the sort menu without bubbling to the header", () => {
    const onSort = vi.fn();
    const onHeader = vi.fn();
    roomList.onSortClick(onSort);
    roomList.getHeaderElement().addEventListener("click", onHeader);
    sortBtn().click();
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(onHeader).not.toHaveBeenCalled();
  });
});

describe("the sort menu", () => {
  const items = () => tabSortMenu(ALL_VIEW_ID).filter((e): e is ContextMenuItem => !("separator" in e && e.separator));

  it("ticks the tab's sort and grouping", () => {
    const ticked = items().filter((i) => i.hint === "✓").map((i) => i.label);
    const all = getView(ALL_VIEW_ID)!;
    expect(ticked).toHaveLength(2);
    expect(ticked[0]).toMatch(/^sort: /);
    expect(ticked[1]).toMatch(/^group: /);
    expect(all.sort).toBe("recent");
    expect(ticked[0]).toBe("sort: recent activity");
  });

  it("re-sorts and regroups the tab", () => {
    items().find((i) => i.label === "sort: name")!.action();
    items().find((i) => i.label === "group: by tag")!.action();
    expect(getView(ALL_VIEW_ID)).toMatchObject({ sort: "name", groupBy: "tag" });
  });
});

describe(":sort and :group", () => {
  it("act on the tab being viewed", () => {
    AppState.set("currentSpaceId", ALL_VIEW_ID);
    sortTab("hand");
    groupTab("space");
    expect(getView(ALL_VIEW_ID)).toMatchObject({ sort: "manual", groupBy: "space" });
    expect(sortBtn().textContent).toBe("by hand ▾");
  });

  it("refuse a word they don't know", () => {
    AppState.set("currentSpaceId", ALL_VIEW_ID);
    sortTab("sideways");
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("Usage: :sort"));
    expect(getView(ALL_VIEW_ID)!.sort).toBe("recent");
  });

  it("say so in a space", () => {
    AppState.set("currentSpaceId", "!work:x");
    sortTab("name");
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("No tab selected"));
  });
});
