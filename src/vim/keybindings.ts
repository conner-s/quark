// Keymap resolution engine for Quark's vim-mode system

export type KeyContext =
  | "global"    // nmap
  | "timeline"  // tmap
  | "roomlist"  // rmap
  | "picker"    // pmap
  | "insert"    // imap
  | "command"   // cmap
  | "visual";   // vmap

export interface KeymapEntry {
  /** The key sequence string, e.g. "gg", "Ctrl-e", "<leader>f" */
  sequence: string;
  /** The action identifier this sequence maps to */
  action: string;
  /** When true, the mapping is non-recursive (noremap) */
  noremap: boolean;
  context: KeyContext;
}

export interface KeymapOptions {
  /** Leader key character (default: " " / space) */
  leaderKey?: string;
  /** Timeout in ms before a partial sequence is abandoned (default: 500) */
  sequenceTimeoutMs?: number;
}

/** Result returned by resolveKey */
export type ResolveResult =
  | { kind: "action"; action: string; noremap: boolean }
  | { kind: "partial" }   // sequence is a valid prefix – wait for more keys
  | { kind: "none" };     // no match

function normaliseKey(raw: string, leaderKey: string): string {
  // Replace <leader> placeholder with actual leader key
  return raw.replace(/<leader>/gi, leaderKey);
}

export class KeymapManager {
  private _entries: KeymapEntry[] = [];
  private _leaderKey: string;
  private _timeoutMs: number;
  private _pendingSequence: string = "";
  private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(options: KeymapOptions = {}) {
    this._leaderKey = options.leaderKey ?? " ";
    this._timeoutMs = options.sequenceTimeoutMs ?? 500;
  }

  get leaderKey(): string {
    return this._leaderKey;
  }

  setLeaderKey(key: string): void {
    this._leaderKey = key;
  }

  /** Return a copy of all registered keymap entries. */
  getEntries(): KeymapEntry[] {
    return [...this._entries];
  }

  // ── Registration helpers ────────────────────────────────────────────────

  map(context: KeyContext, sequence: string, action: string, noremap = false): void {
    const normalised = normaliseKey(sequence, this._leaderKey);
    // Remove any existing mapping for same context+sequence
    this._entries = this._entries.filter(
      (e) => !(e.context === context && e.sequence === normalised)
    );
    this._entries.push({ sequence: normalised, action, noremap, context });
  }

  nmap(sequence: string, action: string): void { this.map("global", sequence, action, false); }
  nnoremap(sequence: string, action: string): void { this.map("global", sequence, action, true); }

  tmap(sequence: string, action: string): void { this.map("timeline", sequence, action, false); }
  tnoremap(sequence: string, action: string): void { this.map("timeline", sequence, action, true); }

  rmap(sequence: string, action: string): void { this.map("roomlist", sequence, action, false); }
  rnoremap(sequence: string, action: string): void { this.map("roomlist", sequence, action, true); }

  pmap(sequence: string, action: string): void { this.map("picker", sequence, action, false); }
  pnoremap(sequence: string, action: string): void { this.map("picker", sequence, action, true); }

  imap(sequence: string, action: string): void { this.map("insert", sequence, action, false); }
  inoremap(sequence: string, action: string): void { this.map("insert", sequence, action, true); }

  cmap(sequence: string, action: string): void { this.map("command", sequence, action, false); }
  cnoremap(sequence: string, action: string): void { this.map("command", sequence, action, true); }

  vmap(sequence: string, action: string): void { this.map("visual", sequence, action, false); }
  vnoremap(sequence: string, action: string): void { this.map("visual", sequence, action, true); }

  unmap(context: KeyContext, sequence: string): void {
    const normalised = normaliseKey(sequence, this._leaderKey);
    this._entries = this._entries.filter(
      (e) => !(e.context === context && e.sequence === normalised)
    );
  }

  // ── Resolution ──────────────────────────────────────────────────────────

  /**
   * Feed a single key (or chord like "Ctrl-e") into the engine.
   * activeContext: the current UI context (scoped maps beat global).
   * onTimeout: called if a pending partial sequence times out without completing.
   */
  resolveKey(
    key: string,
    activeContext: KeyContext,
    onTimeout?: (partial: string) => void
  ): ResolveResult {
    this._clearTimeout();

    this._pendingSequence += key;
    const seq = this._pendingSequence;

    // Build ordered candidate list: scoped entries first, then global
    const scopedEntries = this._entries.filter((e) => e.context === activeContext);
    const globalEntries = this._entries.filter((e) => e.context === "global");
    const ordered = [...scopedEntries, ...globalEntries];

    // Check for exact match (scoped takes priority over global for same sequence)
    const exact = this._findExact(ordered, seq);
    if (exact) {
      this._pendingSequence = "";
      return { kind: "action", action: exact.action, noremap: exact.noremap };
    }

    // Check if sequence is a prefix of any mapping
    const isPrefix = ordered.some((e) => e.sequence.startsWith(seq) && e.sequence !== seq);
    if (isPrefix) {
      this._scheduleTimeout(onTimeout);
      return { kind: "partial" };
    }

    // No match and not a prefix – abandon sequence
    this._pendingSequence = "";
    return { kind: "none" };
  }

  /**
   * Single-key exact lookup (scoped beats global) that does NOT touch the
   * pending-sequence buffer. Submodes that run their own multi-key grammar —
   * e.g. the compose-box vim editor, which composes counts + operators +
   * motions itself — can't feed keys through {@link resolveKey} without
   * fighting its sequence buffering, but still need to know what a single
   * physical key is bound to so user remaps apply. Returns the action, or null.
   */
  actionForKey(key: string, activeContext: KeyContext): string | null {
    const scoped = this._entries.find(
      (e) => e.context === activeContext && e.sequence === key
    );
    if (scoped) return scoped.action;
    const global = this._entries.find(
      (e) => e.context === "global" && e.sequence === key
    );
    return global ? global.action : null;
  }

  /** Reset any pending sequence (e.g. on Escape) */
  resetSequence(): void {
    this._clearTimeout();
    this._pendingSequence = "";
  }

  get pendingSequence(): string {
    return this._pendingSequence;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _findExact(ordered: KeymapEntry[], seq: string): KeymapEntry | undefined {
    // First scoped exact match wins
    return ordered.find((e) => e.sequence === seq);
  }

  private _scheduleTimeout(onTimeout?: (partial: string) => void): void {
    const captured = this._pendingSequence;
    this._timeoutHandle = setTimeout(() => {
      this._pendingSequence = "";
      this._timeoutHandle = null;
      onTimeout?.(captured);
    }, this._timeoutMs);
  }

  private _clearTimeout(): void {
    if (this._timeoutHandle !== null) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }
  }
}

// Singleton export
export const keymapManager = new KeymapManager();
