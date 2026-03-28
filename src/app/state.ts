// Application state manager — single source of truth for Quark's runtime state

import type { RoomInfo, TimelineEvent } from "../ipc/types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ActivePanel = "roomlist" | "timeline" | "spaces" | "members";

export interface AppStateSnapshot {
  loggedIn: boolean;
  /** Matrix user ID of the locally logged-in user (e.g. @alice:matrix.org). */
  ownUserId: string | null;
  /** Display name of the locally logged-in user. */
  ownDisplayName: string | null;
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

// ── Panel nav callback registry ──────────────────────────────────────────────

interface PanelNavCallbacks {
  navDown: () => void;
  navUp: () => void;
  jumpTop?: () => void;
  jumpBottom?: () => void;
  /** Activate the currently focused item (Enter/o). No-op if absent. */
  select?: () => void;
  /** Called when focus moves TO this panel. Optional — no-op if absent. */
  focusActive?: () => void;
}

// ── AppState class ───────────────────────────────────────────────────────────

class AppStateManager {
  /** Left-to-right panel order for focus traversal. */
  private static readonly PANEL_ORDER: readonly ActivePanel[] = [
    "spaces", "roomlist", "timeline", "members",
  ];

  private _state: AppStateSnapshot = {
    loggedIn: false,
    ownUserId: null,
    ownDisplayName: null,
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
  private _panelNavCallbacks: Map<ActivePanel, PanelNavCallbacks> = new Map();

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

  // ── Panel nav ─────────────────────────────────────────────────────────────

  /** Register navigation callbacks for a panel. Called once during setup. */
  registerPanelNav(panel: ActivePanel, callbacks: PanelNavCallbacks): void {
    this._panelNavCallbacks.set(panel, callbacks);
  }

  navDown(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.navDown();
  }

  navUp(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.navUp();
  }

  jumpTop(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.jumpTop?.();
  }

  jumpBottom(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.jumpBottom?.();
  }

  select(): void {
    this._panelNavCallbacks.get(this._state.activePanel)?.select?.();
  }

  moveFocusLeft(): void {
    const order = AppStateManager.PANEL_ORDER.filter(
      (p) => p !== "members" || this._state.memberListVisible
    );
    const idx = order.indexOf(this._state.activePanel);
    if (idx > 0) {
      const next = order[idx - 1];
      this.set("activePanel", next);
      this._panelNavCallbacks.get(next)?.focusActive?.();
    }
  }

  moveFocusRight(): void {
    const order = AppStateManager.PANEL_ORDER.filter(
      (p) => p !== "members" || this._state.memberListVisible
    );
    const idx = order.indexOf(this._state.activePanel);
    if (idx >= 0 && idx < order.length - 1) {
      const next = order[idx + 1];
      this.set("activePanel", next);
      this._panelNavCallbacks.get(next)?.focusActive?.();
    }
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
