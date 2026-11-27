import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TabsDialog } from "./TabsDialog.js";
import { AppState } from "../app/state.js";
import { ALL_VIEW_ID, HOME_VIEW_ID, parseViews } from "../app/room_views.js";
import { allViews, getView, initViewStore, prepareViews } from "../app/view_store.js";

const setRoomViews = vi.fn(async () => {});
let dlg: TabsDialog;

beforeEach(async () => {
  setRoomViews.mockClear();
  AppState.set("roomViews", parseViews(null));
  AppState.set("topLevelSpaces", [{ id: "!work:x", name: "Work" }, { id: "!play:x", name: "Play" }]);
  initViewStore({ getRoomViews: async () => null, fetchRoomViews: async () => null, setRoomViews }, vi.fn());
  await prepareViews();
  dlg = new TabsDialog();
  document.body.appendChild(dlg.getElement());
});

afterEach(() => {
  dlg.hide();
  dlg.getElement().remove();
});

const root = () => dlg.getElement();
const item = (id: string) => root().querySelector<HTMLElement>(`.tabs-dialog__item[data-view-id="${id}"]`)!;
const selectEl = (label: string) =>
  [...root().querySelectorAll<HTMLElement>(".tabs-dialog__editor .settings-dialog__row")]
    .find((r) => r.querySelector(".settings-dialog__label")?.textContent === label)!
    .querySelector("select")!;
const input = (aria: string) => root().querySelector<HTMLInputElement>(`input[aria-label="${aria}"]`)!;
const button = (text: string) => [...root().querySelectorAll("button")].find((b) => b.textContent === text)!;
const change = (el: HTMLInputElement | HTMLSelectElement, value?: string) => {
  if (value !== undefined) el.value = value;
  el.dispatchEvent(new Event("change"));
};

describe("TabsDialog", () => {
  it("lists every tab, hidden ones included, and opens on the one asked for", () => {
    AppState.set("roomViews", parseViews(null).map((v) => (v.id === ALL_VIEW_ID ? { ...v, hidden: true } : v)));
    dlg.show(ALL_VIEW_ID);
    expect(root().querySelectorAll(".tabs-dialog__item")).toHaveLength(4);
    expect(item(ALL_VIEW_ID).classList).toContain("tabs-dialog__item--hidden");
    expect(item(ALL_VIEW_ID).classList).toContain("tabs-dialog__item--selected");
    expect(input("Tab name").value).toBe("All Rooms");
  });

  it("shows and hides a tab from its checkbox", async () => {
    dlg.show();
    const box = item(ALL_VIEW_ID).querySelector<HTMLInputElement>("input[type=checkbox]")!;
    box.checked = false;
    change(box);
    expect(getView(ALL_VIEW_ID)!.hidden).toBe(true);
    await vi.waitFor(() => expect(setRoomViews).toHaveBeenCalled());
  });

  it("saves a choice at once", () => {
    dlg.show(ALL_VIEW_ID);
    change(selectEl("sort"), "name");
    change(selectEl("group"), "tag");
    expect(getView(ALL_VIEW_ID)).toMatchObject({ sort: "name", groupBy: "tag" });
  });

  it("saves a renamed tab when the field commits, keeping a default icon in step", () => {
    dlg.show();
    button("[+ new]").click();
    const id = allViews()[allViews().length - 1].id;
    change(input("Tab name"), "Work");
    expect(getView(id)).toMatchObject({ label: "Work", icon: "W" });
    expect(input("Tab icon").value).toBe("W");
  });

  it("reads typed tags as tag names", () => {
    dlg.show(ALL_VIEW_ID);
    change(input("Only rooms with one of these tags"), "work, favourites");
    expect(getView(ALL_VIEW_ID)!.tags).toEqual(["u.work", "m.favourite"]);
    expect(input("Only rooms with one of these tags").value).toBe("work, Favourites");
  });

  it("offers the space checklist only for rooms in chosen spaces", () => {
    dlg.show(ALL_VIEW_ID);
    const spaces = () => root().querySelector<HTMLElement>(".tabs-dialog__spaces")!.parentElement!;
    expect(spaces().hidden).toBe(true);
    change(selectEl("rooms"), "spaces");
    expect(spaces().hidden).toBe(false);
    const work = [...spaces().querySelectorAll("label")].find((l) => l.textContent?.trim() === "Work")!;
    const box = work.querySelector("input")!;
    box.checked = true;
    change(box);
    expect(getView(ALL_VIEW_ID)).toMatchObject({ rooms: "spaces", spaces: ["!work:x"] });
  });

  it("offers the canvas only on Home, reset on built-ins and delete on custom tabs", () => {
    const onDelete = vi.fn();
    dlg.onDelete(onDelete);
    dlg.show(HOME_VIEW_ID);
    expect(root().textContent).toContain("open the DM canvas");
    expect(button("[reset]")).toBeDefined();
    expect(button("[delete]")).toBeUndefined();

    item(ALL_VIEW_ID).click();
    expect(root().textContent).not.toContain("open the DM canvas");

    button("[+ new]").click();
    const id = allViews()[allViews().length - 1].id;
    button("[delete]").click();
    expect(onDelete).toHaveBeenCalledWith(id);
  });

  it("moves the selected tab and disables a move with nowhere to go", () => {
    dlg.show(HOME_VIEW_ID);
    expect(button("[↑]").disabled).toBe(true);
    button("[↓]").click();
    expect(allViews().map((v) => v.id).slice(0, 2)).toEqual([ALL_VIEW_ID, HOME_VIEW_ID]);
  });

  describe("shortcut tabs", () => {
    const cache = [
      { room_id: "!dm:x", name: "Alice", topic: null, avatar_url: null, unread_count: 0, notification_count: 0, is_direct: true, is_encrypted: true, member_count: 2 },
      { room_id: "!dev:x", name: "Dev", topic: null, avatar_url: null, unread_count: 0, notification_count: 0, is_direct: false, is_encrypted: false, member_count: 9 },
    ];
    beforeEach(() => {
      AppState.set("roomListCache", cache);
      AppState.set("currentRoomId", "!dev:x");
    });
    afterEach(() => {
      AppState.set("roomListCache", []);
      AppState.set("currentRoomId", null);
    });
    const newTab = () => {
      dlg.show();
      button("[+ new]").click();
      return allViews()[allViews().length - 1].id;
    };

    it("aren't offered on built-in tabs", () => {
      dlg.show(ALL_VIEW_ID);
      expect(root().querySelector("select[aria-label='Tab opens']")).toBeNull();
    });

    it("open the room being viewed, take its name, and trade the list rows for a room picker", () => {
      const id = newTab();
      selectEl("opens").focus();
      change(selectEl("opens"), "room");
      expect(getView(id)).toMatchObject({ roomId: "!dev:x", label: "Dev", icon: "D", avatar: true });
      expect(input("Tab name").value).toBe("Dev");
      expect(selectEl("room").value).toBe("!dev:x");
      expect(root().textContent).toContain("show the room's avatar");
      expect(root().textContent).not.toContain("direct messages");
      expect(root().querySelector("select[aria-label='Tab opens']")).toBe(document.activeElement);
    });

    it("follow a new room's name only while the name is still the old room's", () => {
      const id = newTab();
      change(selectEl("opens"), "room");
      change(selectEl("room"), "!dm:x");
      expect(getView(id)).toMatchObject({ roomId: "!dm:x", label: "Alice" });
      expect(root().textContent).toContain("show their profile picture");

      change(input("Tab name"), "Bestie");
      change(selectEl("room"), "!dev:x");
      expect(getView(id)).toMatchObject({ roomId: "!dev:x", label: "Bestie" });
    });

    it("turn the picture off, and go back to being a list", () => {
      const id = newTab();
      change(selectEl("opens"), "room");
      const pic = [...root().querySelectorAll<HTMLInputElement>(".tabs-dialog__editor input[type=checkbox]")].slice(-1)[0];
      pic.checked = false;
      change(pic);
      expect(getView(id)?.avatar).toBe(false);
      change(selectEl("opens"), "list");
      expect(getView(id)?.roomId).toBeNull();
      expect(root().textContent).toContain("direct messages");
    });
  });
});
