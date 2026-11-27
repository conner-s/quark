// Room-list tabs: keeping the strip and list in step with the tab set, the
// tab menu's actions, hand ordering, and room tags.

import { AppState } from "../state.js";
import { isMobile } from "../mobile.js";
import {
  FAVOURITE_TAG,
  GROUP_OPTIONS,
  LOW_PRIORITY_TAG,
  SORT_OPTIONS,
  SORT_SHORT,
  isBuiltinView,
  matchesView,
  mergeManualOrder,
  newShortcutView,
  newView,
  normalizeTag,
  parseGroupBy,
  parseSort,
  sortRooms,
  tagLabel,
} from "../room_views.js";
import {
  addView,
  allViews,
  defaultViewId,
  deleteView,
  getView,
  prepareViews,
  resetView,
  setViewHidden,
  updateView,
  viewContext,
  visibleViews,
} from "../view_store.js";
import { downloadMedia, getRoomMembers, setRoomTag } from "../../ipc/index.js";
import type { RoomInfo } from "../../ipc/types.js";
import { showError, showSuccess, showToast } from "../../ui/NotificationToast.js";
import { askConfirm } from "../../ui/ConfirmDialog.js";
import type { ContextMenuEntry } from "../../ui/ContextMenu.js";
import { _dmUserByRoom, _mediaToBlobUrl, getComponents } from "./context.js";
import { rerenderViewList, selectSpace } from "./rooms.js";

/**
 * Keep the strip and list current as the tab set changes — from here, or from
 * another device via sync. Returns an unbind function. The store itself is
 * wired to the backend from the start (`view_store.ts`), so a room-list load
 * before this runs still reads the account's tabs.
 */
export function bindRoomViews(): () => void {
  // The first tab change then needn't wait for the account's set.
  void prepareViews();
  const { spaceStrip } = getComponents();
  spaceStrip.setViews(visibleViews());
  resolveShortcutAvatars();
  // Which room each shortcut tab opened before this change.
  let shortcutRooms = new Map(allViews().map((v) => [v.id, v.roomId]));
  const offViews = AppState.on("roomViews", () => {
    spaceStrip.setViews(visibleViews());
    resolveShortcutAvatars();
    const before = shortcutRooms;
    shortcutRooms = new Map(allViews().map((v) => [v.id, v.roomId]));
    const id = AppState.get("currentSpaceId");
    const view = id ? getView(id) : undefined;
    if (!id || !view) {
      // Nothing selected (startup) or a space: the strip is all that changed,
      // unless the startup list is a tab's.
      if (!id) rerenderViewList();
      return;
    }
    if (view.hidden) {
      void selectSpace(defaultViewId(), { skipRoomRestore: true });
      return;
    }
    // Home switched between canvas and list: select it again to swap.
    if ((view.canvas && !isMobile()) !== AppState.get("homeViewActive")) {
      void selectSpace(id, { skipRoomRestore: true });
      return;
    }
    // The tab being viewed now opens another room: go there.
    if (view.roomId && view.roomId !== before.get(id)) {
      void selectSpace(id);
      return;
    }
    rerenderViewList();
  });
  // A room's avatar can arrive (or change) with any refresh.
  const offRooms = AppState.on("roomListCache", resolveShortcutAvatars);
  return () => {
    offViews();
    offRooms();
  };
}

// ── Shortcut tabs ────────────────────────────────────────────────────────────

/**
 * Put a room (or DM) on the strip as its own tab, which opens it. A room that
 * already has one gets that tab shown again rather than a second.
 */
export async function pinRoomTab(roomId: string): Promise<void> {
  const room = AppState.get("roomListCache").find((r) => r.room_id === roomId);
  if (!room) {
    showError("That room isn't in your room list");
    return;
  }
  const existing = allViews().find((v) => v.roomId === roomId);
  if (existing) {
    if (existing.hidden) await setViewHidden(existing.id, false);
    showSuccess(`${existing.label} is already a tab`);
    return;
  }
  const view = newShortcutView(room, allViews().map((v) => v.id));
  await addView(view);
  if (getView(view.id)) showSuccess(`Added ${view.label} to the strip`);
}

/**
 * The avatar a shortcut tab draws for its room: a DM's other person's profile
 * picture, falling back to the room's own avatar, and a room's avatar.
 */
async function shortcutAvatarMxc(room: RoomInfo): Promise<string | null> {
  if (!room.is_direct) return room.avatar_url;
  const members = await getRoomMembers(room.room_id);
  const ownUserId = AppState.get("ownUserId");
  const known = _dmUserByRoom.get(room.room_id);
  const partner = members.find((m) => m.user_id === known)
    ?? members.find((m) => m.user_id !== ownUserId);
  return partner?.avatar_url ?? room.avatar_url;
}

/**
 * The last avatar lookup per room, keyed by the room's `avatar_url` at the
 * time. Without it a DM with no picture would be looked up again on every
 * room-list write (one per incoming message); with it, only once its avatar
 * changes, or once the strip has dropped a picture it found (the tab was
 * deleted and the room pinned again).
 */
const _shortcutAvatarLookups = new Map<string, { avatarUrl: string | null; state: "pending" | "none" | "found" }>();

/** Fetch the avatar of each shown shortcut tab's room that isn't drawn yet. */
function resolveShortcutAvatars(): void {
  const { spaceStrip } = getComponents();
  const rooms = new Map(AppState.get("roomListCache").map((r) => [r.room_id, r]));
  for (const v of visibleViews()) {
    const room = v.roomId && v.avatar ? rooms.get(v.roomId) : undefined;
    if (!room) continue;
    const roomId = room.room_id;
    const last = _shortcutAvatarLookups.get(roomId);
    if (last && last.avatarUrl === room.avatar_url && (last.state !== "found" || spaceStrip.hasRoomAvatar(roomId))) {
      continue;
    }
    const lookup = { avatarUrl: room.avatar_url, state: "pending" as "pending" | "none" | "found" };
    _shortcutAvatarLookups.set(roomId, lookup);
    void shortcutAvatarMxc(room)
      .then(async (mxc) => {
        if (!mxc) {
          lookup.state = "none";
          return;
        }
        const dl = await downloadMedia(mxc);
        lookup.state = "found";
        spaceStrip.setRoomAvatar(roomId, _mediaToBlobUrl(dl.mime_type, dl.data_base64));
      })
      .catch((err) => {
        // Non-fatal: the tab keeps its icon. Forget the lookup so a later
        // refresh tries again.
        if (_shortcutAvatarLookups.get(roomId) === lookup) _shortcutAvatarLookups.delete(roomId);
        console.warn(`Failed to resolve the avatar for tab room ${roomId}:`, err);
      });
  }
}

// ── The room list header ─────────────────────────────────────────────────────

/** A space's name for the header, or "Rooms" when it isn't known yet. */
function spaceTitle(spaceId: string): string {
  return AppState.get("topLevelSpaces").find((s) => s.id === spaceId)?.name
    ?? AppState.get("roomListCache").find((r) => r.room_id === spaceId)?.name
    ?? "Rooms";
}

/**
 * Keep the room list header naming what is listed — the tab's label or the
 * space's name — and, for a tab, showing its sort. Returns an unbind function.
 */
export function bindRoomListHeader(): () => void {
  const { roomList } = getComponents();
  const update = (): void => {
    // Nothing selected yet is the startup list, which is the default tab's.
    const id = AppState.get("currentSpaceId") ?? defaultViewId();
    const view = getView(id);
    roomList.setTitle(view ? view.label : spaceTitle(id));
    // A shortcut tab's one room has nothing to sort.
    roomList.setSortLabel(view && !view.roomId ? SORT_SHORT[view.sort] : null);
  };
  update();
  const unbind = [
    AppState.on("currentSpaceId", update),
    AppState.on("roomViews", update),
    AppState.on("topLevelSpaces", update),
  ];
  return () => unbind.forEach((off) => off());
}

/**
 * The header's sort menu for a tab: each sort, each grouping (the current
 * ones ticked), and the tab's editor for the rest.
 */
export function tabSortMenu(viewId: string): ContextMenuEntry[] {
  const view = getView(viewId);
  if (!view) return [];
  const tick = (on: boolean) => (on ? { hint: "✓" } : {});
  return [
    ...SORT_OPTIONS.map(([sort, label]): ContextMenuEntry => ({
      label: `sort: ${label}`,
      ...tick(view.sort === sort),
      action: () => void updateView(viewId, { sort }),
    })),
    { separator: true },
    ...GROUP_OPTIONS.map(([groupBy, label]): ContextMenuEntry => ({
      label: `group: ${label}`,
      ...tick(view.groupBy === groupBy),
      action: () => void updateView(viewId, { groupBy }),
    })),
    { separator: true },
    { label: "Edit tab…", action: () => openTabEditor(viewId) },
  ];
}

/** `:sort <how>` on the tab being viewed. */
export function sortTab(typed: string): void {
  const sort = parseSort(typed);
  if (!sort) {
    showError("Usage: :sort recent|unread|name|hand");
    return;
  }
  withCurrentTab((id) => updateView(id, { sort }));
}

/** `:group <how>` on the tab being viewed. */
export function groupTab(typed: string): void {
  const groupBy = parseGroupBy(typed);
  if (!groupBy) {
    showError("Usage: :group none|kind|space|tag");
    return;
  }
  withCurrentTab((id) => updateView(id, { groupBy }));
}

// ── The tab menu ─────────────────────────────────────────────────────────────

/** The tab being viewed, which the keyboard forms of the tab actions act on. */
export function currentTabId(): string | null {
  const id = AppState.get("currentSpaceId");
  return id && getView(id) ? id : null;
}

/** Run `fn` on the tab being viewed, or say there isn't one. */
export function withCurrentTab(fn: (viewId: string) => unknown): void {
  const id = currentTabId();
  if (id) void fn(id);
  else showError("No tab selected — pick one on the strip, or use :tabs");
}

export function resetTab(viewId: string): void {
  if (!isBuiltinView(viewId)) {
    showError("Only a built-in tab can be reset");
    return;
  }
  void resetView(viewId);
}

export function openTabEditor(viewId?: string): void {
  getComponents().tabsDialog.show(viewId);
}

/**
 * Add a tab and open it in the editor. The tab is there at once and the save
 * follows, except for a session's first change, which waits for the read of
 * the account's tabs (`view_store.ts`); the editor opens once it is there.
 */
export function createTab(label?: string): void {
  const view = newView(label ?? "", allViews().map((v) => v.id));
  const added = addView(view);
  const open = (): void => {
    if (getView(view.id)) getComponents().tabsDialog.show(view.id);
  };
  if (getView(view.id)) open();
  else void added.then(open);
}

export function hideTab(viewId: string): void {
  void setViewHidden(viewId, true);
  const view = getView(viewId);
  if (view) showSuccess(`Hid ${view.label} — bring it back from :tabs`);
}

export async function deleteTab(viewId: string): Promise<void> {
  const view = getView(viewId);
  if (!view || isBuiltinView(viewId)) return;
  const ok = await askConfirm({
    title: "Delete tab",
    message: `Delete the tab "${view.label}"? Its rooms stay where they are.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (ok) await deleteView(viewId);
}

// ── Hand ordering ────────────────────────────────────────────────────────────

/**
 * Put one section of a tab in `sectionIds` order: at once in the list, then
 * in the tab's stored order (see `mergeManualOrder`).
 *
 * A tab sorted any other way becomes hand-sorted, starting from the order it
 * was showing — so the one room moved is the only thing that changes.
 */
export function applyViewOrder(viewId: string, orderKey: string, sectionIds: string[]): Promise<void> {
  const view = getView(viewId);
  if (!view) return Promise.resolve();
  getComponents().roomList.applySectionOrder(orderKey, sectionIds);
  const rooms = AppState.get("roomListCache");
  const ctx = viewContext();
  const shown = sortRooms(view, rooms.filter((r) => matchesView(view, r, ctx))).map((r) => r.room_id);
  const order = mergeManualOrder(view, shown, sectionIds, new Set(rooms.map((r) => r.room_id)));
  if (view.sort !== "manual") {
    showToast(`${view.label} is now sorted by hand — change it back in :tabs`, "info");
  }
  return updateView(viewId, { sort: "manual", order });
}

// ── Room tags ────────────────────────────────────────────────────────────────

/** The room's tags, from the room-list cache. */
export function roomTags(roomId: string): string[] {
  return AppState.get("roomListCache").find((r) => r.room_id === roomId)?.tags ?? [];
}

/** Every tag on any joined room, for suggestions. */
export function knownTags(): string[] {
  const all = new Set<string>([FAVOURITE_TAG, LOW_PRIORITY_TAG]);
  for (const r of AppState.get("roomListCache")) for (const t of r.tags ?? []) all.add(t);
  return [...all].sort();
}

/**
 * Add or remove a tag, locally at once and then on the server. A failure puts
 * the room's tags back. Accepts what the user typed (`work`, `favourite`).
 */
export async function setTag(roomId: string, typed: string, on: boolean): Promise<void> {
  const tag = normalizeTag(typed);
  if (!tag) {
    showError("Usage: :tag <name>");
    return;
  }
  const before = roomTags(roomId);
  const exclusive = tag === FAVOURITE_TAG ? LOW_PRIORITY_TAG : tag === LOW_PRIORITY_TAG ? FAVOURITE_TAG : null;
  const next = new Set(before);
  if (on) {
    next.add(tag);
    if (exclusive) next.delete(exclusive);
  } else {
    next.delete(tag);
  }
  patchTags(roomId, [...next].sort());
  try {
    await setRoomTag(roomId, tag, on);
    showSuccess(on ? `Tagged ${tagLabel(tag)}` : `Removed ${tagLabel(tag)}`);
  } catch (err) {
    patchTags(roomId, before);
    showError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Make a room's tags exactly `tags`: one request per tag added or removed.
 * Throws on the first failure, with the room's tags re-read on the next
 * refresh; the field that called it shows the error.
 */
export async function replaceRoomTags(roomId: string, tags: string[]): Promise<void> {
  const before = roomTags(roomId);
  const wanted = new Set(tags);
  // Favourite and low priority exclude each other: keep whichever the list names last.
  if (wanted.has(FAVOURITE_TAG) && wanted.has(LOW_PRIORITY_TAG)) {
    wanted.delete(tags.lastIndexOf(FAVOURITE_TAG) > tags.lastIndexOf(LOW_PRIORITY_TAG) ? LOW_PRIORITY_TAG : FAVOURITE_TAG);
  }
  const removed = before.filter((t) => !wanted.has(t));
  const added = [...wanted].filter((t) => !before.includes(t));
  for (const t of removed) await setRoomTag(roomId, t, false);
  for (const t of added) await setRoomTag(roomId, t, true);
  patchTags(roomId, [...wanted].sort());
}

function patchTags(roomId: string, tags: string[]): void {
  AppState.set(
    "roomListCache",
    AppState.get("roomListCache").map((r) => (r.room_id === roomId ? { ...r, tags } : r)),
  );
  rerenderViewList();
}
