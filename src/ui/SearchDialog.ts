// Message search dialog — four-tier search over a room's messages.
//
// Tiers (escalating coverage at increasing cost):
//   1. loaded — filter the messages already loaded in the timeline (instant).
//   2. cache  — locally cached/persisted events via the matrix-sdk event cache
//               (fast, offline, bounded).
//   3. date   — server pagination backward to a chosen date (streaming).
//   4. all    — server pagination to the start of the room (streaming).
//
// Streaming tiers append hits as they arrive (via Tauri search events) so the
// list fills incrementally and neither side buffers the full result set.

import { AppState } from "../app/state.js";
import {
  searchRoomCache,
  searchRoomMessages,
  cancelRoomSearch,
  listenSearchEvents,
} from "../ipc/rooms.js";
import type { SearchResult, TimelineEvent } from "../ipc/types.js";
import { DialogBase } from "./DialogBase.js";
import type { Timeline } from "./Timeline.js";

type Scope = "loaded" | "cache" | "date" | "all";

/** Safety cap on events scanned by a server-side (date/all) search. */
const MAX_EVENTS = 50_000;

const SCOPE_LABELS: [Scope, string][] = [
  ["loaded", "Loaded"],
  ["cache", "Local cache"],
  ["date", "Back to date…"],
  ["all", "Entire history"],
];

function eventToResult(e: TimelineEvent): SearchResult {
  return { eventId: e.event_id, sender: e.sender, timestamp: e.timestamp, body: e.body };
}

export class SearchDialog extends DialogBase {
  private _timeline: Timeline;
  private _queryInput!: HTMLInputElement;
  private _dateRow!: HTMLElement;
  private _dateInput!: HTMLInputElement;
  private _listEl!: HTMLElement;
  private _statusEl!: HTMLElement;
  private _cancelBtn!: HTMLButtonElement;
  private _scopeBtns = new Map<Scope, HTMLButtonElement>();

  private _scope: Scope = "loaded";
  private _query = "";
  private _onJumpToMessage: ((eventId: string) => void) | null = null;

  // Async run bookkeeping: every search bumps `_runId` so stale callbacks from
  // a superseded run can be ignored.
  private _runId = 0;
  private _unlisten: (() => void) | null = null;
  private _seenIds = new Set<string>();
  private _matchCount = 0;

  constructor(timeline: Timeline) {
    super({ prefix: "search-dialog", ariaLabel: "Search messages" });
    this._timeline = timeline;

    this.buildHeader("── search ──", "Close search");

    // Query input
    this._queryInput = document.createElement("input");
    this._queryInput.type = "search";
    this._queryInput.className = "search-dialog__query";
    this._queryInput.placeholder = "search messages…";
    this._queryInput.setAttribute("aria-label", "Search query");
    this._queryInput.addEventListener("input", () => {
      this._query = this._queryInput.value;
      // The loaded tier is free, so search live as the user types.
      if (this._scope === "loaded") void this._run();
    });
    this._queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return; // bubble to base → close
      e.stopPropagation(); // own our keys so vim nav never fires
      if (e.key === "Enter") {
        e.preventDefault();
        this._query = this._queryInput.value;
        void this._run();
      }
    });
    this.content.appendChild(this._queryInput);

    // Scope control (segmented buttons)
    const scopeRow = document.createElement("div");
    scopeRow.className = "search-dialog__scope";
    scopeRow.setAttribute("role", "group");
    scopeRow.setAttribute("aria-label", "Search scope");
    for (const [scope, label] of SCOPE_LABELS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-dialog__scope-btn";
      btn.textContent = label;
      btn.tabIndex = -1;
      btn.setAttribute("aria-pressed", scope === this._scope ? "true" : "false");
      if (scope === this._scope) btn.classList.add("search-dialog__scope-btn--active");
      btn.addEventListener("click", () => this._setScope(scope));
      this._scopeBtns.set(scope, btn);
      scopeRow.appendChild(btn);
    }
    this.content.appendChild(scopeRow);

    // Date row (revealed only for the "date" scope)
    this._dateRow = document.createElement("div");
    this._dateRow.className = "search-dialog__date-row";
    this._dateRow.style.display = "none";
    const dateLabel = document.createElement("span");
    dateLabel.className = "search-dialog__date-label";
    dateLabel.textContent = "Search back to:";
    this._dateInput = document.createElement("input");
    this._dateInput.type = "date";
    this._dateInput.className = "search-dialog__date";
    this._dateInput.setAttribute("aria-label", "Search back to date");
    this._dateInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return;
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        void this._run();
      }
    });
    this._dateRow.appendChild(dateLabel);
    this._dateRow.appendChild(this._dateInput);
    this.content.appendChild(this._dateRow);

    // Results list
    this._listEl = document.createElement("div");
    this._listEl.className = "search-dialog__list";
    this.content.appendChild(this._listEl);

    // Footer: status line + cancel button
    const footer = document.createElement("div");
    footer.className = "search-dialog__footer";
    this._statusEl = document.createElement("span");
    this._statusEl.className = "search-dialog__status";
    this._statusEl.textContent = "Type to search · Esc close";
    footer.appendChild(this._statusEl);
    this._cancelBtn = document.createElement("button");
    this._cancelBtn.type = "button";
    this._cancelBtn.className = "search-dialog__cancel";
    this._cancelBtn.textContent = "Cancel";
    this._cancelBtn.tabIndex = -1;
    this._cancelBtn.style.display = "none";
    this._cancelBtn.addEventListener("click", () => void cancelRoomSearch());
    footer.appendChild(this._cancelBtn);
    this.content.appendChild(footer);
  }

  /** Register a callback for when the user clicks a result to jump to it. */
  onJumpToMessage(handler: (eventId: string) => void): void {
    this._onJumpToMessage = handler;
  }

  /** Open the dialog, optionally seeded with a query, and run the first tier. */
  show(initialQuery = ""): void {
    this._query = initialQuery;
    this._queryInput.value = initialQuery;
    this._listEl.innerHTML = "";
    this._seenIds.clear();
    this._matchCount = 0;
    this.reveal();
    void this._run();
  }

  protected override focusTarget(): HTMLElement {
    return this._queryInput;
  }

  protected override onHide(): void {
    this._cancelActive();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _setScope(scope: Scope): void {
    if (this._scope === scope) return;
    this._scope = scope;
    for (const [s, btn] of this._scopeBtns) {
      const active = s === scope;
      btn.classList.toggle("search-dialog__scope-btn--active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
    this._dateRow.style.display = scope === "date" ? "" : "none";
    void this._run();
  }

  /** Stop any in-flight streaming search and detach its listener. */
  private _cancelActive(): void {
    // Only signal the backend when a streaming search is actually running
    // (tracked by the active listener) — avoids a needless IPC call on every
    // keystroke in the instant/loaded tier.
    if (this._unlisten) {
      void cancelRoomSearch();
      this._cleanupListener();
    }
    this._setCancelVisible(false);
  }

  private _cleanupListener(): void {
    if (this._unlisten) {
      this._unlisten();
      this._unlisten = null;
    }
  }

  private _setCancelVisible(visible: boolean): void {
    this._cancelBtn.style.display = visible ? "" : "none";
  }

  private _status(text: string): void {
    this._statusEl.textContent = text;
  }

  private async _run(): Promise<void> {
    // Supersede any prior run.
    this._cancelActive();
    const runId = ++this._runId;
    this._listEl.innerHTML = "";
    this._seenIds.clear();
    this._matchCount = 0;

    const q = this._query.trim();
    if (!q) {
      this._status("Type to search · Esc close");
      return;
    }

    const roomId = AppState.get("currentRoomId");
    if (!roomId) {
      this._status("No room selected.");
      return;
    }

    // Tier 1 — loaded window (instant, synchronous).
    if (this._scope === "loaded") {
      const results = this._timeline.searchLoaded(q);
      this._renderResults(results, q);
      this._status(`${this._countLabel(results.length)} in loaded messages`);
      return;
    }

    // Tier 2 — local cache (one fast call, bounded).
    if (this._scope === "cache") {
      this._status("Searching local cache…");
      try {
        const events = await searchRoomCache(roomId, q);
        if (runId !== this._runId) return;
        const results = events.map(eventToResult);
        this._renderResults(results, q);
        this._status(`${this._countLabel(results.length)} in local cache`);
      } catch (err) {
        if (runId === this._runId) this._status(`Error: ${this._errMsg(err)}`);
      }
      return;
    }

    // Tiers 3/4 — streaming server scan.
    let untilTs: number | undefined;
    if (this._scope === "date") {
      const d = this._dateInput.value;
      if (!d) {
        this._status("Pick a date to search back to.");
        return;
      }
      untilTs = new Date(d).getTime();
    }

    this._status("Searching…");
    this._setCancelVisible(true);
    this._unlisten = await listenSearchEvents(
      (hit) => {
        if (runId !== this._runId || hit.room_id !== roomId) return;
        this._addHit(eventToResult(hit.event), q);
      },
      (prog) => {
        if (runId !== this._runId) return;
        this._status(`scanned ${prog.scanned.toLocaleString()} · ${this._countLabel(this._matchCount)}`);
      },
    );

    try {
      const summary = await searchRoomMessages(roomId, q, untilTs, MAX_EVENTS);
      if (runId !== this._runId) return;
      const suffix = summary.canceled
        ? " (canceled)"
        : summary.reached_start
          ? " (whole room)"
          : untilTs !== undefined
            ? " (back to date)"
            : ` (stopped at ${summary.scanned.toLocaleString()} cap)`;
      this._status(
        `${this._countLabel(summary.matched)} · scanned ${summary.scanned.toLocaleString()}${suffix}`,
      );
    } catch (err) {
      if (runId === this._runId) this._status(`Error: ${this._errMsg(err)}`);
    } finally {
      if (runId === this._runId) {
        this._setCancelVisible(false);
        this._cleanupListener();
      }
    }
  }

  private _countLabel(n: number): string {
    return `${n.toLocaleString()} match${n === 1 ? "" : "es"}`;
  }

  private _errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /** Append a single streaming hit, deduping by event id. */
  private _addHit(result: SearchResult, query: string): void {
    if (this._seenIds.has(result.eventId)) return;
    this._seenIds.add(result.eventId);
    this._matchCount++;
    this._listEl.appendChild(this._buildItem(result, query));
  }

  /** Render a finished result set (loaded/cache tiers), newest-first. */
  private _renderResults(results: SearchResult[], query: string): void {
    this._listEl.innerHTML = "";
    this._seenIds.clear();
    this._matchCount = results.length;
    const sorted = [...results].sort((a, b) => b.timestamp - a.timestamp);
    if (sorted.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-dialog__item search-dialog__item--empty";
      empty.textContent = "No matches.";
      this._listEl.appendChild(empty);
      return;
    }
    for (const r of sorted) {
      this._seenIds.add(r.eventId);
      this._listEl.appendChild(this._buildItem(r, query));
    }
  }

  private _buildItem(r: SearchResult, query: string): HTMLElement {
    const item = document.createElement("div");
    item.className = "search-dialog__item";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.title = "Click to jump to message";
    item.dataset.eventId = r.eventId;

    const sender = document.createElement("span");
    sender.className = "search-dialog__sender";
    sender.textContent = r.sender;
    item.appendChild(sender);

    const ts = document.createElement("span");
    ts.className = "search-dialog__ts";
    const date = new Date(r.timestamp);
    ts.textContent =
      date.toLocaleDateString() +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    item.appendChild(ts);

    const body = document.createElement("div");
    body.className = "search-dialog__body";
    this._appendHighlighted(body, r.body, query);
    item.appendChild(body);

    const jump = () => {
      if (r.eventId && this._onJumpToMessage) {
        this.hide();
        this._onJumpToMessage(r.eventId);
      }
    };
    item.addEventListener("click", jump);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        jump();
      }
    });
    return item;
  }

  /**
   * Append `text` to `parent`, wrapping each case-insensitive occurrence of
   * `query` in a highlight span. Uses text nodes throughout, so the message
   * body is never interpreted as HTML.
   */
  private _appendHighlighted(parent: HTMLElement, text: string, query: string): void {
    const q = query.trim();
    if (!q) {
      parent.textContent = text;
      return;
    }
    const lowerText = text.toLowerCase();
    const lowerQuery = q.toLowerCase();
    let from = 0;
    let idx = lowerText.indexOf(lowerQuery);
    while (idx !== -1) {
      if (idx > from) parent.appendChild(document.createTextNode(text.slice(from, idx)));
      const mark = document.createElement("span");
      mark.className = "search-dialog__match";
      mark.textContent = text.slice(idx, idx + q.length);
      parent.appendChild(mark);
      from = idx + q.length;
      idx = lowerText.indexOf(lowerQuery, from);
    }
    if (from < text.length) parent.appendChild(document.createTextNode(text.slice(from)));
  }
}
