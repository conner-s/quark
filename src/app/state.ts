// Application state manager — single source of truth for Quark's runtime state

import type { RoomInfo, TimelineEvent } from "../ipc/types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ActivePanel = "roomlist" | "timeline" | "spaces";

export interface AppStateSnapshot {
  loggedIn: boolean;
  currentRoomId: string | null;
  currentSpaceId: string | null;
  activePanel: ActivePanel;
  roomListCache: RoomInfo[];
  /** Room IDs that belong to at least one space (used to filter home view). */
  spaceRoomIds: string[];
  currentTimeline: TimelineEvent[];
  replyToEventId: string | null;
  threadRootEventId: string | null;
  memberListVisible: boolean;
}

export type StateChangeKey = keyof AppStateSnapshot;
export type StateChangeListener<K extends StateChangeKey = StateChangeKey> = (
  key: K,
  value: AppStateSnapshot[K],
  prev: AppStateSnapshot[K]
) => void;

// ── AppState class ───────────────────────────────────────────────────────────

class AppStateManager {
  private _state: AppStateSnapshot = {
    loggedIn: false,
    currentRoomId: null,
    currentSpaceId: null,
    activePanel: "roomlist",
    roomListCache: [],
    spaceRoomIds: [],
    currentTimeline: [],
    replyToEventId: null,
    threadRootEventId: null,
    memberListVisible: false,
  };

  private _listeners: Map<string, Set<StateChangeListener>> = new Map();
  private _anyListeners: Set<StateChangeListener> = new Set();

  // ── Read ──────────────────────────────────────────────────────────────────

  get snapshot(): Readonly<AppStateSnapshot> {
    return this._state;
  }

  get<K extends StateChangeKey>(key: K): AppStateSnapshot[K] {
    return this._state[key];
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  set<K extends StateChangeKey>(key: K, value: AppStateSnapshot[K]): void {
    const prev = this._state[key];
    if (prev === value) return;
    this._state = { ...this._state, [key]: value };
    this._emit(key, value, prev);
  }

  patch(partial: Partial<AppStateSnapshot>): void {
    for (const [k, v] of Object.entries(partial) as Array<[StateChangeKey, AppStateSnapshot[StateChangeKey]]>) {
      this.set(k, v);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /** Listen for changes to a specific key */
  on<K extends StateChangeKey>(key: K, listener: StateChangeListener<K>): () => void {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key)!.add(listener as StateChangeListener);
    return () => this._listeners.get(key)?.delete(listener as StateChangeListener);
  }

  /** Listen for any state change */
  onAny(listener: StateChangeListener): () => void {
    this._anyListeners.add(listener);
    return () => this._anyListeners.delete(listener);
  }

  private _emit<K extends StateChangeKey>(key: K, value: AppStateSnapshot[K], prev: AppStateSnapshot[K]): void {
    const keyListeners = this._listeners.get(key);
    if (keyListeners) {
      for (const listener of keyListeners) {
        listener(key, value, prev);
      }
    }
    for (const listener of this._anyListeners) {
      listener(key, value, prev);
    }
  }
}

// Singleton export
export const AppState = new AppStateManager();
