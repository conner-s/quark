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
import { setRoomTag } from "../../ipc/index.js";
import { showError, showSuccess, showToast } from "../../ui/NotificationToast.js";
import { askConfirm } from "../../ui/ConfirmDialog.js";
import type { ContextMenuEntry } from "../../ui/ContextMenu.js";
import { getComponents } from "./context.js";
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
  return AppState.on("roomViews", () => {
    spaceStrip.setViews(visibleViews());
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
    rerenderViewList();
  });
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
    roomList.setSortLabel(view ? SORT_SHORT[view.sort] : null);
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
