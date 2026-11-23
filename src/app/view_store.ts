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
//
// A write replaces the whole set, so it must start from the account's real
// one. The store is wired to the backend from the start (not when the UI
// binds, which a restored session reaches only after its first room-list
// load), and the first change of a session waits for one read from the
// homeserver itself: the sync store can be behind it, as on a new device
// before its first sync. If that read fails, the change is refused rather than
// written over tabs this device hasn't seen.

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
import { fetchRoomViews, getRoomViews, setRoomViews } from "../ipc/index.js";
import { showError } from "../ui/NotificationToast.js";

export interface ViewStoreIpc {
  /** The set as the sync store has it. */
  getRoomViews(): Promise<unknown>;
  /** The set as the homeserver has it (a request). */
  fetchRoomViews(): Promise<unknown>;
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

// Looked up at call time, not here: a test that mocks the IPC module wholesale
// may not define these, and never calls them.
const BACKEND: ViewStoreIpc = {
  getRoomViews: () => getRoomViews(),
  fetchRoomViews: () => fetchRoomViews(),
  setRoomViews: (content) => setRoomViews(content),
};

let _ipc: ViewStoreIpc = BACKEND;
let _onError: (message: string) => void = (message) => showError(message);
let _pending: { json: string; at: number } | null = null;
let _writeChain: Promise<void> = Promise.resolve();
let _now: () => number = () => Date.now();
/** This session's read from the homeserver: under way, or done. */
let _serverRead: Promise<boolean> | null = null;
let _serverReadDone = false;
let _serverReadError = "";
/** Whether a stored set has been seen this session (from the store or the server). */
let _seenStored = false;

/**
 * Swap the backend and error reporting, and start a fresh session's state.
 * Tests use it; the app runs on the defaults.
 */
export function initViewStore(ipc: ViewStoreIpc, onError: (message: string) => void, now?: () => number): void {
  _ipc = ipc;
  _onError = onError;
  _pending = null;
  _writeChain = Promise.resolve();
  _serverRead = null;
  _serverReadDone = false;
  _serverReadError = "";
  _seenStored = false;
  _now = now ?? (() => Date.now());
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

/** Show a set read from the store or the server, if it differs. */
function show(content: unknown): void {
  if (content !== null && content !== undefined) _seenStored = true;
  const next = parseViews(content);
  if (JSON.stringify(next) !== JSON.stringify(allViews())) AppState.set("roomViews", next);
}

/** Re-read the tabs from the store; part of every room-list refresh. */
export async function loadViews(): Promise<void> {
  let content: unknown;
  try {
    content = await _ipc.getRoomViews();
  } catch (err) {
    console.warn("Failed to read room-list tabs:", err);
    return;
  }
  // Nothing in the store after a set was seen means the store hasn't heard
  // yet (a new device before its first sync): nothing ever writes "no tabs".
  if ((content === null || content === undefined) && _seenStored) return;
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
  show(content);
}

/**
 * Read the set from the homeserver, once a session. Resolves false when it
 * can't (the reason kept in `_serverReadError`); a failed read is tried again
 * by the next caller.
 */
function readServerOnce(): Promise<boolean> {
  _serverRead ??= (async () => {
    try {
      const content = await _ipc.fetchRoomViews();
      // The store may still be behind; hold this set against it like a write.
      _pending = { json: canonicalJson(content), at: _now() };
      show(content);
      _serverReadDone = true;
      return true;
    } catch (err) {
      _serverRead = null;
      _serverReadError = err instanceof Error ? err.message : String(err);
      return false;
    }
  })();
  return _serverRead;
}

/**
 * Read the account's tabs from the homeserver now, so the session's first
 * change needn't wait for it. Quiet: if it fails, that change tries again and
 * reports.
 */
export function prepareViews(): Promise<boolean> {
  return readServerOnce();
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Make a change to the set: `fn` gets the current set and returns the next
 * (or null for no change). Applies at once once this session has read the
 * server; the first change waits for that read and applies to what it found.
 */
function change(fn: (views: RoomView[]) => RoomView[] | null): Promise<void> {
  const apply = (): Promise<void> => {
    const next = fn(allViews());
    return next ? saveViews(next) : Promise.resolve();
  };
  if (_serverReadDone) return apply();
  return readServerOnce().then((ok) => {
    if (ok) return apply();
    // Not written over tabs this device hasn't seen.
    _onError(`Couldn't load your tabs from the server, so that change wasn't saved: ${_serverReadError}`);
  });
}

/** Show `next` at once and save it. A failed save puts the previous set back. */
function saveViews(next: RoomView[]): Promise<void> {
  const previous = allViews();
  AppState.set("roomViews", next);
  _seenStored = true;
  const content = serializeViews(next);
  _pending = { json: canonicalJson(content), at: _now() };
  _writeChain = _writeChain.then(async () => {
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
  return change((views) =>
    views.some((v) => v.id === id) ? views.map((v) => (v.id === id ? fn(cloneView(v)) : v)) : null,
  );
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
  return change((views) => [...views, cloneView(view)]);
}

/** Delete a custom tab. Built-ins can only be hidden. */
export function deleteView(id: string): Promise<void> {
  if (isBuiltinView(id)) return Promise.resolve();
  return change((views) => (views.some((v) => v.id === id) ? views.filter((v) => v.id !== id) : null));
}

/**
 * Move a tab one place up or down among the visible tabs of its position
 * group (top or bottom), which is how the strip shows them. Hidden tabs keep
 * their place in the stored list.
 */
export function moveView(id: string, delta: -1 | 1): Promise<void> {
  return change((views) => {
    const view = views.find((v) => v.id === id);
    if (!view) return null;
    const peers = views.filter((v) => v.position === view.position && (!v.hidden || v.id === id));
    const other = peers[peers.findIndex((v) => v.id === id) + delta];
    if (!other) return null;
    const i = views.indexOf(view);
    const j = views.indexOf(other);
    const next = [...views];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/** Whether `moveView(id, delta)` would move anything. */
export function canMoveView(id: string, delta: -1 | 1): boolean {
  const view = getView(id);
  if (!view || view.hidden) return false;
  const peers = visibleViews().filter((v) => v.position === view.position);
  const at = peers.findIndex((v) => v.id === id) + delta;
  return at >= 0 && at < peers.length;
}
