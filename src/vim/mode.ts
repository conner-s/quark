// Mode state machine for Quark's vim-mode engine

export enum Mode {
  Normal = "Normal",
  Insert = "Insert",
  Command = "Command",
  Visual = "Visual",
}

export type ModeChangeListener = (from: Mode, to: Mode) => void;

// Valid mode transitions. Key = from, Value = set of allowed to-modes.
const VALID_TRANSITIONS: Record<Mode, Set<Mode>> = {
  [Mode.Normal]: new Set([Mode.Insert, Mode.Command, Mode.Visual]),
  [Mode.Insert]: new Set([Mode.Normal]),
  [Mode.Command]: new Set([Mode.Normal]),
  [Mode.Visual]: new Set([Mode.Normal]),
};

export class ModeManager {
  private _current: Mode = Mode.Normal;
  private _listeners: Set<ModeChangeListener> = new Set();

  get current(): Mode {
    return this._current;
  }

  /**
   * Attempt a mode transition. Returns true if the transition succeeded,
   * false if it was rejected (invalid guard).
   */
  transition(to: Mode): boolean {
    if (this._current === to) {
      // Already in target mode – treat as no-op success
      return true;
    }

    const allowed = VALID_TRANSITIONS[this._current];
    if (!allowed.has(to)) {
      return false;
    }

    const from = this._current;
    this._current = to;
    this._notify(from, to);
    return true;
  }

  /** Force-set mode without guard checks (used for initialisation/reset). */
  reset(mode: Mode = Mode.Normal): void {
    const from = this._current;
    this._current = mode;
    if (from !== mode) {
      this._notify(from, mode);
    }
  }

  on(listener: ModeChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  off(listener: ModeChangeListener): void {
    this._listeners.delete(listener);
  }

  private _notify(from: Mode, to: Mode): void {
    for (const listener of this._listeners) {
      listener(from, to);
    }
  }
}

// Singleton export
export const modeManager = new ModeManager();
