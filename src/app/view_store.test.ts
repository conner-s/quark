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
  prepareViews,
  resetView,
  setViewHidden,
  updateView,
  visibleViews,
} from "./view_store.js";

// `stored` is what the sync store holds, `server` what the homeserver does. A
// write reaches the server, and by default echoes into the store at once.
let stored: unknown;
let server: unknown;
let clock: number;
const ipc = {
  getRoomViews: vi.fn(async () => stored),
  fetchRoomViews: vi.fn(async () => server),
  setRoomViews: vi.fn(async (content: Record<string, unknown>) => {
    server = content;
    stored = content;
  }),
};
const onError = vi.fn();

beforeEach(() => {
  stored = null;
  server = null;
  clock = 1_000;
  ipc.getRoomViews.mockClear();
  ipc.fetchRoomViews.mockClear();
  ipc.fetchRoomViews.mockImplementation(async () => server);
  ipc.setRoomViews.mockClear();
  ipc.setRoomViews.mockImplementation(async (content) => {
    server = content;
    stored = content;
  });
  onError.mockClear();
  AppState.set("roomViews", parseViews(null));
  initViewStore(ipc, onError, () => clock);
});

const ids = () => allViews().map((v) => v.id);

describe("view_store", () => {
  it("saves a change locally at once and to account data, once the server has been read", async () => {
    await prepareViews();
    const p =setViewHidden(GROUPS_VIEW_ID, true);
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

  it("recognises its echo with the keys in another order, and then takes later changes", async () => {
    // What serde_json::Value hands back: every object's keys sorted.
    const sortKeys = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(sortKeys)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
          : v;
    ipc.setRoomViews.mockImplementation(async (content) => {
      stored = sortKeys(content);
    });
    await updateView(HOME_VIEW_ID, { label: "Base" });
    await loadViews(); // the echo: clears the pending write
    const other = allViews().map((v) => (v.id === HOME_VIEW_ID ? { ...v, label: "Elsewhere" } : v));
    stored = sortKeys(serializeViews(other));
    await loadViews(); // another device's change, well inside the grace
    expect(allViews().find((v) => v.id === HOME_VIEW_ID)!.label).toBe("Elsewhere");
  });

  it("lets the store win once the grace runs out", async () => {
    // The write never echoes: another device wrote over it.
    ipc.setRoomViews.mockImplementation(async () => {});
    await updateView(HOME_VIEW_ID, { label: "Base" });
    const other = parseViews(null);
    other[0] = { ...other[0], label: "Elsewhere" };
    stored = serializeViews(other);
    await loadViews();
    expect(allViews().find((v) => v.id === HOME_VIEW_ID)!.label).toBe("Base");
    clock += ECHO_GRACE_MS + 1;
    await loadViews();
    expect(allViews().find((v) => v.id === HOME_VIEW_ID)!.label).toBe("Elsewhere");
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

describe("a session's first change", () => {
  const mine = newView("Work", []);
  const withMine = () => serializeViews([...parseViews(null), mine]);

  it("starts from the server's set, not the defaults shown before the store was read", async () => {
    // A restart: nothing read yet, the defaults on screen, the account's set on the server.
    server = withMine();
    const extra = newView("Play", ids());
    await addView(extra);
    expect(ids()).toEqual(expect.arrayContaining([mine.id, extra.id]));
    expect(parseViews(server).map((v) => v.id)).toEqual(expect.arrayContaining([mine.id, extra.id]));
  });

  it("starts from the server's set when the store hasn't caught up (a new device)", async () => {
    server = withMine();
    stored = null;
    await updateView(HOME_VIEW_ID, { label: "Base" });
    expect(parseViews(server).map((v) => v.id)).toContain(mine.id);
    expect(ipc.fetchRoomViews).toHaveBeenCalledTimes(1);
  });

  it("is refused, and says so, when the server can't be read; the next change retries", async () => {
    server = withMine();
    ipc.fetchRoomViews.mockRejectedValueOnce(new Error("offline"));
    await setViewHidden(GROUPS_VIEW_ID, true);
    expect(ipc.setRoomViews).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("offline"));
    expect(ids()).not.toContain(mine.id);
    await setViewHidden(GROUPS_VIEW_ID, true);
    expect(ipc.setRoomViews).toHaveBeenCalledTimes(1);
    expect(parseViews(server).map((v) => v.id)).toContain(mine.id);
  });

  it("reads the server once a session, however many changes follow", async () => {
    await prepareViews();
    await updateView(HOME_VIEW_ID, { label: "Base" });
    await updateView(HOME_VIEW_ID, { label: "Base 2" });
    expect(ipc.fetchRoomViews).toHaveBeenCalledTimes(1);
  });

  it("keeps changes made while the read is under way, in order", async () => {
    server = withMine();
    const a = updateView(mine.id, { label: "One" });
    const b = updateView(mine.id, { label: "Two" });
    await Promise.all([a, b]);
    expect(parseViews(server).find((v) => v.id === mine.id)!.label).toBe("Two");
  });

  it("is reported by the change, not by a quiet prepareViews", async () => {
    ipc.fetchRoomViews.mockRejectedValueOnce(new Error("offline"));
    expect(await prepareViews()).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("an empty store", () => {
  it("doesn't undo a set already seen this session", async () => {
    const mine = newView("Work", []);
    server = serializeViews([...parseViews(null), mine]);
    await prepareViews();
    stored = null; // the store hasn't heard of it yet
    clock += ECHO_GRACE_MS + 1;
    await loadViews();
    expect(ids()).toContain(mine.id);
  });

  it("is the defaults when nothing was ever saved", async () => {
    await loadViews();
    expect(ids()).toEqual(parseViews(null).map((v) => v.id));
  });
});
