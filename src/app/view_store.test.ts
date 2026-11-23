import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppState } from "./state.js";
import {
  ALL_VIEW_ID,
  DMS_VIEW_ID,
  GROUPS_VIEW_ID,
  HOME_VIEW_ID,
  newView,
  parseViews,
  serializeViews,
} from "./room_views.js";
import {
  ECHO_GRACE_MS,
  addView,
  allViews,
  canMoveView,
  defaultViewId,
  deleteView,
  initViewStore,
  loadViews,
  moveView,
  resetView,
  setViewHidden,
  updateView,
  visibleViews,
} from "./view_store.js";

let stored: unknown;
let clock: number;
const ipc = {
  getRoomViews: vi.fn(async () => stored),
  setRoomViews: vi.fn(async (content: Record<string, unknown>) => {
    stored = content;
  }),
};
const onError = vi.fn();

beforeEach(() => {
  stored = null;
  clock = 1_000;
  ipc.getRoomViews.mockClear();
  ipc.setRoomViews.mockClear();
  ipc.setRoomViews.mockImplementation(async (content) => {
    stored = content;
  });
  onError.mockClear();
  AppState.set("roomViews", parseViews(null));
  initViewStore(ipc, onError, () => clock);
});

const ids = () => allViews().map((v) => v.id);

describe("view_store", () => {
  it("saves a change locally at once and to account data", async () => {
    const p = setViewHidden(GROUPS_VIEW_ID, true);
    expect(visibleViews().map((v) => v.id)).not.toContain(GROUPS_VIEW_ID);
    await p;
    expect(ipc.setRoomViews).toHaveBeenCalledTimes(1);
    expect(parseViews(stored).find((v) => v.id === GROUPS_VIEW_ID)!.hidden).toBe(true);
  });

  it("puts the old set back and reports when a save fails", async () => {
    ipc.setRoomViews.mockRejectedValueOnce(new Error("offline"));
    await updateView(HOME_VIEW_ID, { label: "Base" });
    expect(allViews().find((v) => v.id === HOME_VIEW_ID)!.label).toBe("Home");
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });

  it("ignores a stale read while its write waits for the echo", async () => {
    // The server has the write, but the store (what get_room_views reads) has not caught up.
    ipc.setRoomViews.mockImplementation(async () => {});
    await updateView(HOME_VIEW_ID, { label: "Base" });
    await loadViews();
    expect(allViews().find((v) => v.id === HOME_VIEW_ID)!.label).toBe("Base");
  });

  it("accepts the echo, and lets the store win once the grace runs out", async () => {
    ipc.setRoomViews.mockImplementation(async () => {});
    await updateView(HOME_VIEW_ID, { label: "Base" });
    clock += ECHO_GRACE_MS + 1;
    await loadViews();
    expect(allViews().find((v) => v.id === HOME_VIEW_ID)!.label).toBe("Home");
  });

  it("takes another device's change when nothing is pending", async () => {
    const other = parseViews(null);
    other[0] = { ...other[0], label: "Elsewhere" };
    stored = serializeViews(other);
    await loadViews();
    expect(allViews()[0].label).toBe("Elsewhere");
  });

  it("adds and deletes custom tabs, but never deletes a built-in", async () => {
    const v = newView("Work", ids());
    await addView(v);
    expect(ids()).toContain(v.id);
    await deleteView(v.id);
    expect(ids()).not.toContain(v.id);
    await deleteView(HOME_VIEW_ID);
    expect(ids()).toContain(HOME_VIEW_ID);
  });

  it("resets a built-in in place", async () => {
    await moveView(ALL_VIEW_ID, -1);
    await updateView(ALL_VIEW_ID, { label: "Everything", sort: "name" });
    await resetView(ALL_VIEW_ID);
    const all = allViews().find((v) => v.id === ALL_VIEW_ID)!;
    expect(all).toMatchObject({ label: "All Rooms", sort: "recent" });
    expect(ids()[0]).toBe(ALL_VIEW_ID);
  });

  it("moves a tab among the visible tabs of its group", async () => {
    // Bottom group: DMs, Groups. DMs can go down, not up; Home can't go up.
    expect(canMoveView(DMS_VIEW_ID, -1)).toBe(false);
    expect(canMoveView(DMS_VIEW_ID, 1)).toBe(true);
    expect(canMoveView(HOME_VIEW_ID, -1)).toBe(false);
    await moveView(DMS_VIEW_ID, 1);
    expect(ids()).toEqual([HOME_VIEW_ID, ALL_VIEW_ID, GROUPS_VIEW_ID, DMS_VIEW_ID]);
  });

  it("skips hidden tabs when moving", async () => {
    const v = newView("Work", ids());
    await addView(v); // [home, all, dms, groups, work(top)]
    await setViewHidden(ALL_VIEW_ID, true);
    await moveView(v.id, -1);
    expect(visibleViews().map((x) => x.id).slice(0, 2)).toEqual([v.id, HOME_VIEW_ID]);
  });

  it("lands on the first visible tab, or All Rooms when every tab is hidden", async () => {
    expect(defaultViewId()).toBe(HOME_VIEW_ID);
    for (const id of ids()) await setViewHidden(id, true);
    expect(defaultViewId()).toBe(ALL_VIEW_ID);
  });
});
