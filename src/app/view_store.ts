// The live set of room-list tabs, and every change made to it.
//
// The set lives in `AppState.roomViews`, so the space strip, the room list and
// the badges all redraw from one place. A change applies locally at once and is
// then written to account data, one write at a time and in the order made.
//
// Reads come from the sync store, which only learns of a write when sync echoes
// it back. A room-list refresh landing in between would otherwise read the old
// set and undo the change on screen for a moment, so while a write is waiting
// for its echo, a read that doesn't match it is ignored — for a while: if the
// echo never comes (another device wrote over it), the store wins.

import { AppState } from "./state.js";
import {
  ALL_VIEW_ID,
  builtinView,
  cloneView,
  isBuiltinView,
  parseViews,
  serializeViews,
  stripOrder,
  type RoomView,
  type ViewContext,
} from "./room_views.js";

export interface ViewStoreIpc {
  getRoomViews(): Promise<unknown>;
  setRoomViews(content: Record<string, unknown>): Promise<void>;
}

/** How long a write may wait for its echo before the store's copy wins. */
export const ECHO_GRACE_MS = 60_000;

/**
 * JSON with object keys sorted, for comparing a write with its echo: the
 * backend passes account data through `serde_json::Value`, which (without
 * `preserve_order`) hands objects back with their keys sorted.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

let _ipc: ViewStoreIpc | null = null;
let _onError: (message: string) => void = () => {};
let _pending: { json: string; at: number } | null = null;
let _writeChain: Promise<void> = Promise.resolve();
let _now: () => number = () => Date.now();

/** Wire the store to the backend. Called once at startup (and by tests). */
export function initViewStore(ipc: ViewStoreIpc, onError: (message: string) => void, now?: () => number): void {
  _ipc = ipc;
  _onError = onError;
  _pending = null;
  _writeChain = Promise.resolve();
  if (now) _now = now;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const allViews = (): RoomView[] => AppState.get("roomViews");

export const getView = (id: string): RoomView | undefined => allViews().find((v) => v.id === id);

/** The tabs the strip shows, top ones first. */
export const visibleViews = (): RoomView[] => stripOrder(allViews()).filter((v) => !v.hidden);

/**
 * Where to land when there is no selection to keep: the first tab on the
 * strip. All Rooms when every tab is hidden — it still lists, just unhighlighted.
 */
export const defaultViewId = (): string => visibleViews()[0]?.id ?? ALL_VIEW_ID;

/** The space facts a tab needs, from app state. */
export function viewContext(): ViewContext {
  return {
    spaceRoomIds: new Set(AppState.get("spaceRoomIds")),
    spaceMembers: AppState.get("spaceMembers"),
    spaces: AppState.get("topLevelSpaces"),
    openRoomId: AppState.get("currentRoomId"),
  };
}

/** Re-read the tabs from the store; part of every room-list refresh. */
export async function loadViews(): Promise<void> {
  if (!_ipc) return;
  let content: unknown;
  try {
    content = await _ipc.getRoomViews();
  } catch (err) {
    console.warn("Failed to read room-list tabs:", err);
    return;
  }
  const json = canonicalJson(content);
  if (_pending) {
    if (json === _pending.json) {
      _pending = null;
    } else if (_now() - _pending.at < ECHO_GRACE_MS) {
      return;
    } else {
      _pending = null;
    }
  }
  const next = parseViews(content);
  if (JSON.stringify(next) !== JSON.stringify(allViews())) AppState.set("roomViews", next);
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Show `next` at once and save it. A failed save puts the previous set back. */
export function saveViews(next: RoomView[]): Promise<void> {
  const previous = allViews();
  AppState.set("roomViews", next);
  const content = serializeViews(next);
  _pending = { json: canonicalJson(content), at: _now() };
  _writeChain = _writeChain.then(async () => {
    if (!_ipc) return;
    try {
      await _ipc.setRoomViews(content);
    } catch (err) {
      _pending = null;
      // Only undo if nothing newer has been shown since.
      if (allViews() === next) AppState.set("roomViews", previous);
      _onError(`Couldn't save tabs: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return _writeChain;
}

function replace(id: string, fn: (v: RoomView) => RoomView): Promise<void> {
  const views = allViews();
  if (!views.some((v) => v.id === id)) return Promise.resolve();
  return saveViews(views.map((v) => (v.id === id ? fn(cloneView(v)) : v)));
}

export const updateView = (id: string, patch: Partial<Omit<RoomView, "id">>): Promise<void> =>
  replace(id, (v) => ({ ...v, ...patch }));

export const setViewHidden = (id: string, hidden: boolean): Promise<void> => updateView(id, { hidden });

/** A built-in back to how it ships, keeping its place in the list. */
export function resetView(id: string): Promise<void> {
  const fresh = builtinView(id);
  return fresh ? replace(id, () => fresh) : Promise.resolve();
}

/** Add a tab at the end of its position group. */
export function addView(view: RoomView): Promise<void> {
  return saveViews([...allViews(), cloneView(view)]);
}

/** Delete a custom tab. Built-ins can only be hidden. */
export function deleteView(id: string): Promise<void> {
  if (isBuiltinView(id)) return Promise.resolve();
  return saveViews(allViews().filter((v) => v.id !== id));
}

/**
 * Move a tab one place up or down among the visible tabs of its position
 * group (top or bottom), which is how the strip shows them. Hidden tabs keep
 * their place in the stored list.
 */
export function moveView(id: string, delta: -1 | 1): Promise<void> {
  const views = allViews();
  const view = views.find((v) => v.id === id);
  if (!view) return Promise.resolve();
  const peers = views.filter((v) => v.position === view.position && (!v.hidden || v.id === id));
  const at = peers.findIndex((v) => v.id === id);
  const other = peers[at + delta];
  if (!other) return Promise.resolve();
  const i = views.indexOf(view);
  const j = views.indexOf(other);
  const next = [...views];
  [next[i], next[j]] = [next[j], next[i]];
  return saveViews(next);
}

/** Whether `moveView(id, delta)` would move anything. */
export function canMoveView(id: string, delta: -1 | 1): boolean {
  const view = getView(id);
  if (!view || view.hidden) return false;
  const peers = visibleViews().filter((v) => v.position === view.position);
  const at = peers.findIndex((v) => v.id === id) + delta;
  return at >= 0 && at < peers.length;
}
