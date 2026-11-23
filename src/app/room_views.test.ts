import { describe, it, expect } from "vitest";
import {
  ALL_VIEW_ID,
  BUILTIN_VIEWS,
  DMS_VIEW_ID,
  GROUPS_VIEW_ID,
  HOME_VIEW_ID,
  buildViewSections,
  formatTags,
  parseTags,
  builtinView,
  matchesView,
  mergeManualOrder,
  newView,
  normalizeTag,
  parseViews,
  serializeViews,
  sortRooms,
  stripOrder,
  tagLabel,
  viewIdFromOrderKey,
  viewOrderKey,
  type RoomView,
  type ViewContext,
} from "./room_views.js";
import type { RoomInfo } from "../ipc/types.js";

const room = (id: string, over: Partial<RoomInfo> = {}): RoomInfo => ({
  room_id: id,
  name: over.name ?? id,
  topic: null,
  avatar_url: null,
  unread_count: 0,
  notification_count: 0,
  is_direct: false,
  is_encrypted: false,
  member_count: 5,
  last_activity_ts: null,
  ...over,
});

const ctx = (over: Partial<ViewContext> = {}): ViewContext => ({
  spaceRoomIds: new Set(),
  spaceMembers: {},
  spaces: [],
  ...over,
});

const view = (over: Partial<RoomView> = {}): RoomView => ({ ...newView("Test", []), ...over });
const ids = (rooms: RoomInfo[]) => rooms.map((r) => r.room_id);

describe("built-in views", () => {
  const spaced = ctx({ spaceRoomIds: new Set(["!in"]) });
  const rooms = [room("!in"), room("!out"), room("!dm", { is_direct: true }), room("!spacedm", { is_direct: true })];
  spaced.spaceRoomIds.add("!spacedm");
  const shown = (id: string) => ids(rooms.filter((r) => matchesView(builtinView(id)!, r, spaced)));

  it("Home lists every DM plus rooms in no space", () => {
    expect(shown(HOME_VIEW_ID)).toEqual(["!out", "!dm", "!spacedm"]);
  });

  it("All Rooms lists everything", () => {
    expect(shown(ALL_VIEW_ID)).toEqual(["!in", "!out", "!dm", "!spacedm"]);
  });

  it("Direct Messages lists whatever is marked m.direct, spaced or not", () => {
    expect(shown(DMS_VIEW_ID)).toEqual(["!dm", "!spacedm"]);
  });

  it("Group Rooms lists unspaced rooms that are not DMs", () => {
    expect(shown(GROUPS_VIEW_ID)).toEqual(["!out"]);
  });

  it("only Home opens the canvas", () => {
    expect(BUILTIN_VIEWS.filter((v) => v.canvas).map((v) => v.id)).toEqual([HOME_VIEW_ID]);
  });
});

describe("matchesView", () => {
  it("restricts rooms to chosen spaces, counting subspace rooms, and leaves DMs to `dms`", () => {
    const v = view({ rooms: "spaces", spaces: ["!work"], dms: false });
    const c = ctx({ spaceMembers: { "!work": ["!a", "!sub-room"], "!play": ["!b"] } });
    expect(matchesView(v, room("!a"), c)).toBe(true);
    expect(matchesView(v, room("!sub-room"), c)).toBe(true);
    expect(matchesView(v, room("!b"), c)).toBe(false);
    expect(matchesView(v, room("!dm", { is_direct: true }), c)).toBe(false);
  });

  it("lists no space rooms before membership is known", () => {
    const v = view({ rooms: "spaces", spaces: ["!work"] });
    expect(matchesView(v, room("!a"), ctx({ spaceMembers: null }))).toBe(false);
  });

  it("filters by any-of tags and excluded tags", () => {
    const v = view({ tags: ["m.favourite", "u.work"], excludeTags: ["u.old"] });
    expect(matchesView(v, room("!a", { tags: ["u.work"] }), ctx())).toBe(true);
    expect(matchesView(v, room("!b", { tags: [] }), ctx())).toBe(false);
    expect(matchesView(v, room("!c"), ctx())).toBe(false);
    expect(matchesView(v, room("!d", { tags: ["u.work", "u.old"] }), ctx())).toBe(false);
  });

  it("unread-only keeps mentions and unmuted unread rooms", () => {
    const v = view({ unreadOnly: true });
    expect(matchesView(v, room("!a", { unread_count: 1 }), ctx())).toBe(true);
    expect(matchesView(v, room("!b", { unread_count: 1, muted: true }), ctx())).toBe(false);
    expect(matchesView(v, room("!c", { notification_count: 1, muted: true }), ctx())).toBe(true);
    expect(matchesView(v, room("!d"), ctx())).toBe(false);
  });

  it("can hide muted rooms", () => {
    expect(matchesView(view({ hideMuted: true }), room("!a", { muted: true }), ctx())).toBe(false);
  });
});

describe("sortRooms", () => {
  const rooms = [
    room("!b", { name: "beta", last_activity_ts: 300 }),
    room("!a", { name: "alpha", last_activity_ts: 100, unread_count: 2 }),
    room("!c", { name: "gamma", last_activity_ts: 200, notification_count: 1 }),
  ];

  it("by recent activity", () => {
    expect(ids(sortRooms(view({ sort: "recent" }), rooms))).toEqual(["!b", "!c", "!a"]);
  });

  it("by name", () => {
    expect(ids(sortRooms(view({ sort: "name" }), rooms))).toEqual(["!a", "!b", "!c"]);
  });

  it("mentions, then unread, then the rest", () => {
    expect(ids(sortRooms(view({ sort: "unread" }), rooms))).toEqual(["!c", "!a", "!b"]);
  });

  it("by hand, with unplaced rooms last by recency", () => {
    expect(ids(sortRooms(view({ sort: "manual", order: ["!a"] }), rooms))).toEqual(["!a", "!b", "!c"]);
  });
});

describe("buildViewSections", () => {
  it("one unlabelled section without grouping, and one empty section for an empty view", () => {
    expect(buildViewSections(view(), [room("!a")], ctx()).map((s) => [s.label, ids(s.rooms)])).toEqual([["", ["!a"]]]);
    expect(buildViewSections(view({ dms: false, rooms: "none" }), [room("!a")], ctx())).toEqual([
      { label: "", rooms: [], key: "all" },
    ]);
  });

  it("groups by kind", () => {
    const s = buildViewSections(view({ groupBy: "kind" }), [room("!a"), room("!d", { is_direct: true })], ctx());
    expect(s.map((x) => [x.label, ids(x.rooms)])).toEqual([["Direct messages", ["!d"]], ["Rooms", ["!a"]]]);
  });

  it("groups by space in strip order, listing a room in each space it is in", () => {
    const c = ctx({
      spaces: [{ id: "!s1", name: "One" }, { id: "!s2", name: "Two" }],
      spaceMembers: { "!s1": ["!a", "!both"], "!s2": ["!both"] },
    });
    const rooms = [room("!a"), room("!both"), room("!loose"), room("!d", { is_direct: true })];
    const s = buildViewSections(view({ groupBy: "space", sort: "name" }), rooms, c);
    expect(s.map((x) => [x.label, ids(x.rooms), x.spaceId])).toEqual([
      ["One", ["!a", "!both"], "!s1"],
      ["Two", ["!both"], "!s2"],
      ["Direct messages", ["!d"], undefined],
      ["Other rooms", ["!loose"], undefined],
    ]);
  });

  it("groups by tag: favourites first, low priority last, untagged as Other", () => {
    const rooms = [
      room("!low", { tags: ["m.lowpriority"] }),
      room("!fav", { tags: ["m.favourite"] }),
      room("!work", { tags: ["u.work"] }),
      room("!none"),
    ];
    const s = buildViewSections(view({ groupBy: "tag" }), rooms, ctx());
    expect(s.map((x) => [x.label, ids(x.rooms)])).toEqual([
      ["Favourites", ["!fav"]],
      ["work", ["!work"]],
      ["Other", ["!none"]],
      ["Low priority", ["!low"]],
    ]);
  });

  it("gives every section a distinct key", () => {
    const rooms = [room("!fav", { tags: ["m.favourite"] }), room("!none")];
    const keys = buildViewSections(view({ groupBy: "tag" }), rooms, ctx()).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("mergeManualOrder", () => {
  it("moves rooms only within the slots their section held", () => {
    // Shown order a b c d, where b and d form one section; swap them.
    const v = view({ order: ["!a", "!b", "!c", "!d"] });
    const joined = new Set(["!a", "!b", "!c", "!d"]);
    expect(mergeManualOrder(v, ["!a", "!b", "!c", "!d"], ["!d", "!b"], joined)).toEqual(["!a", "!d", "!c", "!b"]);
  });

  it("keeps placed rooms that aren't shown right now, but drops rooms that were left", () => {
    const v = view({ order: ["!hidden", "!gone", "!a", "!b"] });
    expect(mergeManualOrder(v, ["!a", "!b"], ["!b", "!a"], new Set(["!hidden", "!a", "!b"]))).toEqual([
      "!b",
      "!a",
      "!hidden",
    ]);
  });
});

describe("order keys", () => {
  it("round-trip a view ID through a section key that holds colons", () => {
    expect(viewIdFromOrderKey(viewOrderKey("__view_ab", "space:!s:server"))).toBe("__view_ab");
  });

  it("are not mistaken for a space's key", () => {
    expect(viewIdFromOrderKey("!space:server")).toBeNull();
  });
});

describe("parseViews / serializeViews", () => {
  it("an account that never saved gets the built-ins in their default order", () => {
    expect(parseViews(null).map((v) => v.id)).toEqual(BUILTIN_VIEWS.map((v) => v.id));
    expect(parseViews({ views: "nonsense" }).map((v) => v.id)).toEqual(BUILTIN_VIEWS.map((v) => v.id));
  });

  it("round-trips", () => {
    const custom = view({ label: "Work", groupBy: "space", sort: "manual", order: ["!a"], tags: ["u.work"] });
    const views = [...parseViews(null), custom];
    views[0] = { ...views[0], hidden: true, canvas: false };
    expect(parseViews(serializeViews(views))).toEqual(views);
  });

  it("keeps the stored order and puts a built-in it doesn't mention beside its neighbour", () => {
    const content = { views: [{ id: GROUPS_VIEW_ID }, { id: HOME_VIEW_ID }, { id: DMS_VIEW_ID }] };
    expect(parseViews(content).map((v) => v.id)).toEqual([GROUPS_VIEW_ID, HOME_VIEW_ID, ALL_VIEW_ID, DMS_VIEW_ID]);
  });

  it("drops entries it can't use, duplicates, and unknown built-ins", () => {
    const content = {
      views: [42, { id: "!space:x" }, { id: "__future__" }, { id: HOME_VIEW_ID, label: "Mine" }, { id: HOME_VIEW_ID, label: "Dup" }],
    };
    const views = parseViews(content);
    expect(views.filter((v) => v.id === HOME_VIEW_ID).map((v) => v.label)).toEqual(["Mine"]);
    expect(views.some((v) => v.id === "__future__" || v.id === "!space:x")).toBe(false);
  });

  it("falls back to defaults for bad field values", () => {
    const v = parseViews({ views: [{ id: "__view_x", label: "  ", icon: "toolong", sort: "sideways", spaces: [1, "!s", "!s"] }] })
      .find((x) => x.id === "__view_x");
    expect(v).toMatchObject({ label: "Tab", icon: "to", sort: "recent", spaces: ["!s"] });
  });

  it("only Home may use the canvas", () => {
    const views = parseViews({ views: [{ id: ALL_VIEW_ID, canvas: true }] });
    expect(views.find((v) => v.id === ALL_VIEW_ID)!.canvas).toBe(false);
  });
});

describe("helpers", () => {
  it("strip order is the top views then the bottom ones", () => {
    expect(stripOrder(parseViews(null)).map((v) => v.position)).toEqual(["top", "top", "bottom", "bottom"]);
  });

  it("normalizes typed tags", () => {
    expect(normalizeTag(" work ")).toBe("u.work");
    expect(normalizeTag("Favourite")).toBe("m.favourite");
    expect(normalizeTag("low priority")).toBe("m.lowpriority");
    expect(normalizeTag("com.example.x")).toBe("com.example.x");
    expect(normalizeTag("  ")).toBe("");
  });

  it("formats and parses a tag field, round-tripping the spec tags", () => {
    const tags = ["m.favourite", "u.work", "m.lowpriority"];
    expect(formatTags(tags)).toBe("Favourites, work, Low priority");
    expect(parseTags(formatTags(tags))).toEqual(tags);
    expect(parseTags(" work , ,work,fav")).toEqual(["u.work", "m.favourite"]);
  });

  it("labels tags", () => {
    expect(tagLabel("u.work")).toBe("work");
    expect(tagLabel("m.favourite")).toBe("Favourites");
  });

  it("new views get unique ids that read as views", () => {
    const a = newView("Work", []);
    expect(a.id.startsWith("__view_")).toBe(true);
    expect(a.icon).toBe("W");
    expect(newView("", [a.id]).label).toBe("New tab");
  });
});
