// Room-list tabs ("views"): the entries above and below the real spaces on the
// space strip.
//
// A view is a filter over the local room cache plus how to group and sort what
// it keeps. Home, All Rooms, Direct Messages and Group Rooms are built-in views
// the user may edit or hide but not delete; the user can add their own. The
// whole set is stored as one global account-data event (`tel.quark.room_views`)
// so it follows the account across devices. The backend treats that content as
// opaque; this module owns its schema, and parses it defensively — another
// device running a newer build may have written fields this one doesn't know.
//
// Pure: no DOM, no IPC, no AppState. `view_store.ts` holds the live set.

import type { RoomInfo } from "../ipc/types.js";

export type ViewPosition = "top" | "bottom";
/** Which non-DM rooms a view lists. DMs are governed by `dms` alone. */
export type RoomScope = "all" | "unspaced" | "spaces" | "none";
export type ViewGroupBy = "none" | "kind" | "space" | "tag";
export type ViewSort = "recent" | "name" | "unread" | "manual";

export interface RoomView {
  id: string;
  label: string;
  /** One or two characters drawn on the strip. */
  icon: string;
  /** Above (top) or below (bottom) the user's real spaces. */
  position: ViewPosition;
  hidden: boolean;
  /** Home only: on desktop, open the DM canvas instead of a room list. */
  canvas: boolean;
  /** List direct messages. */
  dms: boolean;
  rooms: RoomScope;
  /** Top-level space IDs, for `rooms: "spaces"`. */
  spaces: string[];
  /** When non-empty, only rooms carrying at least one of these tags. */
  tags: string[];
  /** Rooms carrying any of these tags are left out. */
  excludeTags: string[];
  unreadOnly: boolean;
  hideMuted: boolean;
  groupBy: ViewGroupBy;
  sort: ViewSort;
  /** Room IDs in hand-made order, for `sort: "manual"`. */
  order: string[];
}

export const HOME_VIEW_ID = "__home__";
export const ALL_VIEW_ID = "__all__";
export const DMS_VIEW_ID = "__dms__";
export const GROUPS_VIEW_ID = "__groups__";

/** Account-data schema version this build writes. */
export const VIEWS_VERSION = 1;

const BASE: Omit<RoomView, "id" | "label" | "icon" | "position"> = {
  hidden: false,
  canvas: false,
  dms: true,
  rooms: "all",
  spaces: [],
  tags: [],
  excludeTags: [],
  unreadOnly: false,
  hideMuted: false,
  groupBy: "none",
  sort: "recent",
  order: [],
};

// `m.direct` is the user's own declaration of what a DM is, so it is the whole
// test — no member-count corroboration. A bridged DM routinely carries a relay
// or bot alongside the two humans, and `:converttodm` exists precisely to let
// the user override the heuristic.
export const BUILTIN_VIEWS: readonly RoomView[] = Object.freeze([
  // DMs wherever they are, plus rooms in no space. On desktop it opens the
  // floating-DM canvas; `canvas: false` makes it a list like any other.
  { ...BASE, id: HOME_VIEW_ID, label: "Home", icon: "⌂", position: "top", canvas: true, rooms: "unspaced" },
  // Every joined room. Before this tab the whole list was only on screen at
  // startup, before a space had been picked.
  { ...BASE, id: ALL_VIEW_ID, label: "All Rooms", icon: "≡", position: "top" },
  { ...BASE, id: DMS_VIEW_ID, label: "Direct Messages", icon: "✉", position: "bottom", rooms: "none" },
  { ...BASE, id: GROUPS_VIEW_ID, label: "Group Rooms", icon: "#", position: "bottom", dms: false, rooms: "unspaced" },
]);

export const isBuiltinView = (id: string): boolean => BUILTIN_VIEWS.some((v) => v.id === id);

export const builtinView = (id: string): RoomView | undefined => {
  const v = BUILTIN_VIEWS.find((b) => b.id === id);
  return v ? cloneView(v) : undefined;
};

/**
 * Whether an ID names a view rather than a Matrix space. Views' IDs all start
 * with `__`; a room ID always starts with `!`.
 */
export const isViewId = (id: string): boolean => id.startsWith("__");

/** A fresh custom view with the given label, listing everything. */
export function newView(label: string, existingIds: Iterable<string>): RoomView {
  const taken = new Set(existingIds);
  let id: string;
  do {
    id = `__view_${Math.random().toString(36).slice(2, 10)}`;
  } while (taken.has(id));
  const name = label.trim() || "New tab";
  return { ...cloneView({ ...BASE, id, label: name, icon: defaultIcon(name), position: "top" }) };
}

export function defaultIcon(label: string): string {
  return [...label.trim()][0]?.toUpperCase() ?? "?";
}

export function cloneView(v: RoomView): RoomView {
  return { ...v, spaces: [...v.spaces], tags: [...v.tags], excludeTags: [...v.excludeTags], order: [...v.order] };
}

// ── Storage ──────────────────────────────────────────────────────────────────

const POSITIONS: readonly ViewPosition[] = ["top", "bottom"];
const SCOPES: readonly RoomScope[] = ["all", "unspaced", "spaces", "none"];
const GROUPS: readonly ViewGroupBy[] = ["none", "kind", "space", "tag"];
const SORTS: readonly ViewSort[] = ["recent", "name", "unread", "manual"];

const oneOf = <T extends string>(allowed: readonly T[], v: unknown, fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const strings = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === "string" && s.length > 0))] : fallback;
const text = (v: unknown, fallback: string, max: number): string => {
  if (typeof v !== "string" || !v.trim()) return fallback;
  return [...v.trim()].slice(0, max).join("");
};

/** One stored view over its defaults. Null when the entry is unusable. */
function parseView(raw: unknown): RoomView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isViewId(r.id)) return null;
  const base = builtinView(r.id) ?? (r.id.startsWith("__view_") ? newViewWithId(r.id) : null);
  if (!base) return null; // an unknown built-in, from a newer build
  return {
    id: base.id,
    label: text(r.label, base.label, 64),
    icon: text(r.icon, base.icon, 2),
    position: oneOf(POSITIONS, r.position, base.position),
    hidden: bool(r.hidden, base.hidden),
    canvas: base.id === HOME_VIEW_ID ? bool(r.canvas, base.canvas) : false,
    dms: bool(r.dms, base.dms),
    rooms: oneOf(SCOPES, r.rooms, base.rooms),
    spaces: strings(r.spaces, base.spaces),
    tags: strings(r.tags, base.tags),
    excludeTags: strings(r.exclude_tags, base.excludeTags),
    unreadOnly: bool(r.unread_only, base.unreadOnly),
    hideMuted: bool(r.hide_muted, base.hideMuted),
    groupBy: oneOf(GROUPS, r.group_by, base.groupBy),
    sort: oneOf(SORTS, r.sort, base.sort),
    order: strings(r.order, base.order),
  };
}

function newViewWithId(id: string): RoomView {
  return cloneView({ ...BASE, id, label: "Tab", icon: "T", position: "top" });
}

/**
 * The views an account-data payload describes, in display order.
 *
 * The stored list's order is the display order. A built-in it doesn't mention
 * — every built-in, for an account that never saved, or one added by a later
 * build — goes in at its default place relative to the built-ins around it, so
 * a new built-in shows up rather than staying invisible until "reset".
 */
export function parseViews(content: unknown): RoomView[] {
  const stored = content && typeof content === "object" ? (content as Record<string, unknown>).views : undefined;
  const out: RoomView[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(stored) ? stored : []) {
    const v = parseView(raw);
    if (v && !seen.has(v.id)) {
      out.push(v);
      seen.add(v.id);
    }
  }
  BUILTIN_VIEWS.forEach((b, i) => {
    if (seen.has(b.id)) return;
    // After the nearest earlier built-in that is listed, else first.
    const prev = BUILTIN_VIEWS.slice(0, i).reverse().find((p) => seen.has(p.id));
    const at = prev ? out.findIndex((v) => v.id === prev.id) + 1 : 0;
    out.splice(at, 0, cloneView(b));
    seen.add(b.id);
  });
  return out;
}

/** The account-data content for a set of views. */
export function serializeViews(views: RoomView[]): Record<string, unknown> {
  return {
    version: VIEWS_VERSION,
    views: views.map((v) => ({
      id: v.id,
      label: v.label,
      icon: v.icon,
      position: v.position,
      hidden: v.hidden,
      ...(v.id === HOME_VIEW_ID ? { canvas: v.canvas } : {}),
      dms: v.dms,
      rooms: v.rooms,
      spaces: v.spaces,
      tags: v.tags,
      exclude_tags: v.excludeTags,
      unread_only: v.unreadOnly,
      hide_muted: v.hideMuted,
      group_by: v.groupBy,
      sort: v.sort,
      order: v.order,
    })),
  };
}

/** Views in strip order: the top ones, then the bottom ones, each in list order. */
export function stripOrder(views: RoomView[]): RoomView[] {
  return [...views.filter((v) => v.position === "top"), ...views.filter((v) => v.position === "bottom")];
}

// ── Filtering ────────────────────────────────────────────────────────────────

/** What a view needs to know about spaces. */
export interface ViewContext {
  /** Rooms (and subspaces) that are a child of any space. */
  spaceRoomIds: Set<string>;
  /** Top-level space ID → the room IDs its list shows. Null until known. */
  spaceMembers: Record<string, string[]> | null;
  /** Top-level spaces in strip order, for grouping by space. */
  spaces: { id: string; name: string }[];
  /**
   * The open room. An unread-only tab keeps listing it: opening a room marks
   * it read, and it would otherwise vanish from under the user.
   */
  openRoomId?: string | null;
}

const isDm = (r: RoomInfo): boolean => r.is_direct;

function inSpaces(roomId: string, spaceIds: string[], ctx: ViewContext): boolean {
  if (!ctx.spaceMembers) return false;
  return spaceIds.some((s) => ctx.spaceMembers![s]?.includes(roomId));
}

export function matchesView(view: RoomView, room: RoomInfo, ctx: ViewContext): boolean {
  if (isDm(room)) {
    if (!view.dms) return false;
  } else {
    switch (view.rooms) {
      case "none":
        return false;
      case "unspaced":
        if (ctx.spaceRoomIds.has(room.room_id)) return false;
        break;
      case "spaces":
        if (!inSpaces(room.room_id, view.spaces, ctx)) return false;
        break;
      case "all":
        break;
    }
  }
  const tags = room.tags ?? [];
  if (view.tags.length > 0 && !view.tags.some((t) => tags.includes(t))) return false;
  if (view.excludeTags.some((t) => tags.includes(t))) return false;
  if (view.hideMuted && room.muted) return false;
  const unread = room.notification_count > 0 || (room.unread_count > 0 && !room.muted);
  if (view.unreadOnly && !unread && room.room_id !== ctx.openRoomId) return false;
  return true;
}

// ── Sorting ──────────────────────────────────────────────────────────────────

const byName = (a: RoomInfo, b: RoomInfo): number =>
  (a.name ?? a.room_id).localeCompare(b.name ?? b.room_id) || a.room_id.localeCompare(b.room_id);

/** Most recent activity, then unread score, then name. */
export function compareRecency(a: RoomInfo, b: RoomInfo): number {
  const aTs = a.last_activity_ts ?? 0;
  const bTs = b.last_activity_ts ?? 0;
  if (bTs !== aTs) return bTs - aTs;
  const aScore = a.notification_count * 2 + a.unread_count;
  const bScore = b.notification_count * 2 + b.unread_count;
  if (bScore !== aScore) return bScore - aScore;
  return (a.name ?? "").localeCompare(b.name ?? "");
}

/** Mentions first, then other unread rooms, each by recency. Muted unread counts as read. */
function compareUnread(a: RoomInfo, b: RoomInfo): number {
  const rank = (r: RoomInfo) => (r.notification_count > 0 ? 2 : r.unread_count > 0 && !r.muted ? 1 : 0);
  return rank(b) - rank(a) || compareRecency(a, b);
}

/** Rooms in the view's order. Hand-ordered views list unplaced rooms last, by recency. */
export function sortRooms(view: RoomView, rooms: RoomInfo[]): RoomInfo[] {
  switch (view.sort) {
    case "name":
      return [...rooms].sort(byName);
    case "unread":
      return [...rooms].sort(compareUnread);
    case "manual": {
      const rank = new Map(view.order.map((id, i) => [id, i]));
      return [...rooms].sort((a, b) => {
        const ra = rank.get(a.room_id);
        const rb = rank.get(b.room_id);
        if (ra !== undefined && rb !== undefined) return ra - rb;
        if (ra !== undefined) return -1;
        if (rb !== undefined) return 1;
        return compareRecency(a, b);
      });
    }
    case "recent":
      return [...rooms].sort(compareRecency);
  }
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export interface ViewSection {
  /** Empty for an unlabelled section. */
  label: string;
  rooms: RoomInfo[];
  /** Set on a section listing one space's rooms (right-click → space settings). */
  spaceId?: string;
  /** Distinguishes the view's sections from each other, for reordering. */
  key: string;
}

export const FAVOURITE_TAG = "m.favourite";
export const LOW_PRIORITY_TAG = "m.lowpriority";

/** How a tag reads in the UI: `u.work` → `work`, the two spec tags by name. */
export function tagLabel(tag: string): string {
  if (tag === FAVOURITE_TAG) return "Favourites";
  if (tag === LOW_PRIORITY_TAG) return "Low priority";
  if (tag.startsWith("u.")) return tag.slice(2);
  return tag;
}

/**
 * How the user types a tag, as stored: a bare word becomes a user tag
 * (`work` → `u.work`), and anything already namespaced is kept.
 */
export function normalizeTag(input: string): string {
  const t = input.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (["favourite", "favourites", "favorite", "favorites", "fav"].includes(lower)) return FAVOURITE_TAG;
  if (["lowpriority", "low priority", "low-priority", "low"].includes(lower)) return LOW_PRIORITY_TAG;
  return t.includes(".") ? t : `u.${t}`;
}

/** Tags as a text field shows them: `u.work`, `m.favourite` → `work, Favourites`. */
export function formatTags(tags: string[]): string {
  return tags.map(tagLabel).join(", ");
}

/** A comma-separated tag field back into tag names (see `normalizeTag`). */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map(normalizeTag).filter(Boolean))];
}

/** Favourites first, low priority last, every other tag by its label. */
function compareTags(a: string, b: string): number {
  const rank = (t: string) => (t === FAVOURITE_TAG ? 0 : t === LOW_PRIORITY_TAG ? 2 : 1);
  return rank(a) - rank(b) || tagLabel(a).localeCompare(tagLabel(b));
}

/**
 * The view's rooms, filtered, grouped and sorted, as the room list draws them.
 * A room in several groups (two spaces, two tags) is listed in each. Empty
 * groups are dropped; a view that keeps nothing is one empty section.
 */
export function buildViewSections(view: RoomView, allRooms: RoomInfo[], ctx: ViewContext): ViewSection[] {
  const rooms = sortRooms(view, allRooms.filter((r) => matchesView(view, r, ctx)));
  const sections: ViewSection[] = [];
  const add = (label: string, list: RoomInfo[], key: string, spaceId?: string) => {
    if (list.length > 0) sections.push({ label, rooms: list, key, ...(spaceId ? { spaceId } : {}) });
  };

  switch (view.groupBy) {
    case "none":
      add("", rooms, "all");
      break;
    case "kind":
      add("Direct messages", rooms.filter(isDm), "kind:dm");
      add("Rooms", rooms.filter((r) => !isDm(r)), "kind:room");
      break;
    case "space": {
      const listed = new Set<string>();
      const spaces = view.rooms === "spaces"
        ? ctx.spaces.filter((s) => view.spaces.includes(s.id))
        : ctx.spaces;
      for (const s of spaces) {
        const members = new Set(ctx.spaceMembers?.[s.id] ?? []);
        const list = rooms.filter((r) => members.has(r.room_id));
        list.forEach((r) => listed.add(r.room_id));
        add(s.name, list, `space:${s.id}`, s.id);
      }
      const rest = rooms.filter((r) => !listed.has(r.room_id));
      add("Direct messages", rest.filter(isDm), "space:-dm");
      add("Other rooms", rest.filter((r) => !isDm(r)), "space:-other");
      break;
    }
    case "tag": {
      const tags = [...new Set(rooms.flatMap((r) => r.tags ?? []))]
        .filter((t) => view.tags.length === 0 || view.tags.includes(t))
        .sort(compareTags);
      const untagged = rooms.filter((r) => !(r.tags ?? []).some((t) => tags.includes(t)));
      for (const t of tags.filter((t) => t !== LOW_PRIORITY_TAG)) {
        add(tagLabel(t), rooms.filter((r) => (r.tags ?? []).includes(t)), `tag:${t}`);
      }
      add(tags.length > 0 ? "Other" : "", untagged, "tag:-none");
      if (tags.includes(LOW_PRIORITY_TAG)) {
        add(tagLabel(LOW_PRIORITY_TAG), rooms.filter((r) => (r.tags ?? []).includes(LOW_PRIORITY_TAG)), `tag:${LOW_PRIORITY_TAG}`);
      }
      break;
    }
  }
  if (sections.length === 0) sections.push({ label: "", rooms: [], key: "all" });
  return sections;
}

// ── Hand ordering ────────────────────────────────────────────────────────────

const ORDER_KEY_PREFIX = "view:";

/**
 * The room list's order key for one section of a hand-sorted view. Distinct
 * from a space's order key (a room ID, `!…`), which is how a drop knows which
 * order to write.
 */
export const viewOrderKey = (viewId: string, sectionKey: string): string =>
  `${ORDER_KEY_PREFIX}${viewId}:${sectionKey}`;

/** The view a section order key belongs to, or null for a space's key. */
export function viewIdFromOrderKey(orderKey: string): string | null {
  if (!orderKey.startsWith(ORDER_KEY_PREFIX)) return null;
  const rest = orderKey.slice(ORDER_KEY_PREFIX.length);
  const end = rest.indexOf(":");
  // View IDs never contain a colon; section keys may (`space:!a:server`).
  return end > 0 ? rest.slice(0, end) : null;
}

/**
 * The view's new `order` after one section was rearranged to `sectionIds`.
 *
 * The section's rooms keep the slots they held in the view's overall order and
 * take them in their new sequence, so moving a room inside one group never
 * shuffles another. Rooms the view placed before but doesn't show right now
 * (an unread-only view, a room muted for a while) keep their place after the
 * shown ones, rather than losing it. `joined` drops rooms that were left.
 */
export function mergeManualOrder(
  view: RoomView,
  shownInOrder: string[],
  sectionIds: string[],
  joined: Set<string>,
): string[] {
  const moving = new Set(sectionIds);
  const queue = [...sectionIds];
  const ranking = [...new Set(shownInOrder)].map((id) => (moving.has(id) ? queue.shift()! : id));
  const shown = new Set(ranking);
  const kept = view.order.filter((id) => !shown.has(id) && joined.has(id));
  return [...ranking, ...kept];
}
