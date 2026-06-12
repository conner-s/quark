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
  getRoomScanTotal,
  listenSearchEvents,
} from "../ipc/rooms.js";
import type { SearchResult, TimelineEvent } from "../ipc/types.js";
import { DatePicker } from "./DatePicker.js";
import { DialogBase } from "./DialogBase.js";
import type { Timeline } from "./Timeline.js";

type Scope = "loaded" | "cache" | "date" | "all";
type SortOrder = "newest" | "oldest";

/** Safety cap on events scanned by a server-side (date/all) search. */
const MAX_EVENTS = 50_000;

/** Minimum query length before any search runs. Short queries (1–2 chars) match
 *  a huge fraction of messages, which is rarely useful and expensive to render. */
const MIN_QUERY_LENGTH = 3;

/** Debounce for the live loaded-tier search so fast typing doesn't re-run the
 *  (synchronous) scan + render on every keystroke. */
const LIVE_SEARCH_DEBOUNCE_MS = 180;

/** Cap on result rows rendered into the dialog. Match *counts* are still exact;
 *  this only bounds DOM nodes so a broad query can't build thousands of rows. */
const MAX_RENDERED_RESULTS = 200;

const SCOPE_LABELS: [Scope, string][] = [
  ["loaded", "Loaded"],
  ["cache", "Local cache"],
  ["date", "Back to date…"],
  ["all", "Entire history"],
];

function eventToResult(e: TimelineEvent): SearchResult {
  return { eventId: e.event_id, sender: e.sender, timestamp: e.timestamp, body: e.body };
}

/** Clamp a number into the inclusive [0, 1] range. */
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export class SearchDialog extends DialogBase {
  private _timeline: Timeline;
  private _queryInput!: HTMLInputElement;
  private _dateRow!: HTMLElement;
  /** "Back to date" cutoff picker (custom calendar — see DatePicker for why). */
  private _datePicker!: DatePicker;
  private _listEl!: HTMLElement;
  private _progressEl!: HTMLElement;
  private _progressFill!: HTMLElement;
  /** Pending timer that hides the progress bar shortly after a scan completes. */
  private _progressHideTimer: ReturnType<typeof setTimeout> | null = null;
  private _statusEl!: HTMLElement;
  private _cancelBtn!: HTMLButtonElement;
  private _scopeBtns = new Map<Scope, HTMLButtonElement>();
  private _sortSelect!: HTMLSelectElement;

  private _scope: Scope = "loaded";
  private _sort: SortOrder = "newest";
  private _query = "";
  private _onJumpToMessage: ((eventId: string) => void) | null = null;

  /** All matches for the current run, in arrival order; rendered (sorted +
   *  capped) by `_renderResultList`. */
  private _results: SearchResult[] = [];
  /** Query backing the currently-rendered results (for re-render on sort change). */
  private _activeQuery = "";
  /** Throttle for re-rendering while streaming hits arrive. */
  private _renderThrottle: ReturnType<typeof setTimeout> | null = null;

  // Async run bookkeeping: every search bumps `_runId` so stale callbacks from
  // a superseded run can be ignored.
  private _runId = 0;
  private _unlisten: (() => void) | null = null;
  private _seenIds = new Set<string>();
  private _matchCount = 0;
  /** Rows actually rendered (bounded by MAX_RENDERED_RESULTS). */
  private _renderedCount = 0;
  /** Whether the "showing first N" note has been appended this run. */
  private _capNoted = false;
  /** Pending debounce timer for the live loaded-tier search. */
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
      // The loaded tier searches live as you type, but debounced so a fast
      // typist doesn't trigger a scan+render on every keystroke.
      if (this._scope === "loaded") this._scheduleRun();
    });
    this._queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return; // bubble to base → close
      e.stopPropagation(); // own our keys so vim nav never fires
      if (e.key === "Enter") {
        e.preventDefault();
        this._query = this._queryInput.value;
        void this._run(); // immediate — cancels any pending debounce
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

    // Sort dropdown — pushed to the right end of the scope row.
    this._sortSelect = document.createElement("select");
    this._sortSelect.className = "search-dialog__sort";
    this._sortSelect.setAttribute("aria-label", "Sort results");
    for (const [value, label] of [
      ["newest", "Newest first"],
      ["oldest", "Oldest first"],
    ] as [SortOrder, string][]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      this._sortSelect.appendChild(opt);
    }
    this._sortSelect.value = this._sort;
    this._sortSelect.addEventListener("change", () => {
      this._sort = this._sortSelect.value as SortOrder;
      this._renderResultList();
    });
    // Let the native select own its keys (arrows/enter); only Escape bubbles to
    // the dialog so it can still close.
    this._sortSelect.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") e.stopPropagation();
    });
    scopeRow.appendChild(this._sortSelect);

    this.content.appendChild(scopeRow);

    // Date row (revealed only for the "date" scope). Uses the custom DatePicker
    // component (the native <input type=date> popup is an uncontrollable modal
    // grab on WebKitGTK). Selecting a date runs the search.
    this._dateRow = document.createElement("div");
    this._dateRow.className = "search-dialog__date-row";
    this._dateRow.style.display = "none";
    const dateLabel = document.createElement("span");
    dateLabel.className = "search-dialog__date-label";
    dateLabel.textContent = "Search back to:";

    this._datePicker = new DatePicker({
      placeholder: "Pick a date…",
      ariaLabel: "Choose a date to search back to",
    });
    this._datePicker.onChange((value) => {
      if (value && this._query.trim()) void this._run();
    });

    this._dateRow.appendChild(dateLabel);
    this._dateRow.appendChild(this._datePicker.getElement());
    this.content.appendChild(this._dateRow);

    // Results list
    this._listEl = document.createElement("div");
    this._listEl.className = "search-dialog__list";
    this.content.appendChild(this._listEl);

    // Progress bar (deep-history tiers only) — sits between the results and the
    // footer. Hidden unless a streaming scan is running. Determinate for a
    // date-bounded scan (or an "all" scan with a known total), indeterminate
    // otherwise.
    this._progressEl = document.createElement("div");
    this._progressEl.className = "search-dialog__progress";
    this._progressEl.style.display = "none";
    this._progressEl.setAttribute("role", "progressbar");
    this._progressEl.setAttribute("aria-label", "Search progress");
    this._progressFill = document.createElement("div");
    this._progressFill.className = "search-dialog__progress-fill";
    this._progressEl.appendChild(this._progressFill);
    this.content.appendChild(this._progressEl);

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
    // Always open sorted newest-first, regardless of a prior session's choice.
    this._sort = "newest";
    this._sortSelect.value = "newest";
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
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._renderThrottle !== null) {
      clearTimeout(this._renderThrottle);
      this._renderThrottle = null;
    }
    this._datePicker.close();
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
    if (scope !== "date") this._datePicker.close();
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
    this._resetProgress();
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

  // ── Progress bar ───────────────────────────────────────────────────────────

  /** Hide the progress bar and clear any pending hide timer / fill width. */
  private _resetProgress(): void {
    if (this._progressHideTimer !== null) {
      clearTimeout(this._progressHideTimer);
      this._progressHideTimer = null;
    }
    this._progressEl.style.display = "none";
    this._progressEl.classList.remove("search-dialog__progress--indeterminate");
    this._progressFill.style.width = "0%";
    this._progressEl.removeAttribute("aria-valuenow");
  }

  /** Show an animated, total-unknown bar (entire-history scan with no baseline). */
  private _showIndeterminateProgress(): void {
    if (this._progressHideTimer !== null) {
      clearTimeout(this._progressHideTimer);
      this._progressHideTimer = null;
    }
    this._progressEl.style.display = "";
    this._progressEl.classList.add("search-dialog__progress--indeterminate");
    this._progressFill.style.width = "";
    this._progressEl.removeAttribute("aria-valuenow");
  }

  /** Show a determinate bar filled to `fraction` (0–1). */
  private _setDeterminateProgress(fraction: number): void {
    const pct = Math.round(clamp01(fraction) * 100);
    this._progressEl.style.display = "";
    this._progressEl.classList.remove("search-dialog__progress--indeterminate");
    this._progressFill.style.width = `${pct}%`;
    this._progressEl.setAttribute("aria-valuenow", String(pct));
  }

  /** Finish the bar: snap to full and fade out (unless the scan was canceled,
   *  in which case just hide it — a full bar would misrepresent a partial scan). */
  private _completeProgress(canceled: boolean): void {
    if (canceled) {
      this._resetProgress();
      return;
    }
    this._setDeterminateProgress(1);
    if (this._progressHideTimer !== null) clearTimeout(this._progressHideTimer);
    this._progressHideTimer = setTimeout(() => {
      this._progressHideTimer = null;
      this._resetProgress();
    }, 600);
  }

  /** Compact "Apr 2025" month/year label for the oldest-scanned timestamp. */
  private _formatMonthYear(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short" });
  }

  /** Update the progress bar + status line from a streaming progress tick. The
   *  scope/anchor/cutoff/baseline are captured per-run so the right denominator
   *  is used: time-span for a date scan, the persisted total for an "all" scan
   *  that has one, else an indeterminate bar. */
  private _updateScanProgress(
    scanned: number,
    oldestTs: number | null,
    scope: Scope,
    anchorTs: number,
    untilTs: number | undefined,
    baseline: number | null,
  ): void {
    const scannedLabel = `scanned ${scanned.toLocaleString()}`;
    const matchesLabel = this._countLabel(this._matchCount);
    const backTo = oldestTs ? ` · back to ${this._formatMonthYear(oldestTs)}` : "";

    // Date scan: a real percentage, measured by how far back in time we've reached.
    if (scope === "date" && untilTs !== undefined && oldestTs && anchorTs > untilTs) {
      const fraction = clamp01((anchorTs - oldestTs) / (anchorTs - untilTs));
      this._setDeterminateProgress(fraction);
      this._status(`${Math.round(fraction * 100)}% · ${scannedLabel} · ${matchesLabel}${backTo}`);
      return;
    }

    // Entire-history scan with a known total from a prior full scan: an estimate
    // (new messages since aren't counted), clamped below 100% until completion.
    if (scope === "all" && baseline && baseline > 0) {
      const fraction = Math.min(scanned / baseline, 0.99);
      this._setDeterminateProgress(fraction);
      this._status(`~${Math.round(fraction * 100)}% · ${scannedLabel} · ${matchesLabel}${backTo}`);
      return;
    }

    // No knowable total → indeterminate bar + live readout.
    this._showIndeterminateProgress();
    this._status(`${scannedLabel} · ${matchesLabel}${backTo}`);
  }

  private _status(text: string): void {
    this._statusEl.textContent = text;
  }

  /** Parse the picker's selected date into an epoch-ms cutoff (local midnight),
   *  or null if no date is selected. */
  private _parseUntilTs(): number | null {
    const d = this._datePicker.getValue();
    if (!d) return null;
    const ts = Date.parse(`${d}T00:00:00`);
    return Number.isNaN(ts) ? null : ts;
  }

  /** Debounced trigger for the live loaded-tier search. */
  private _scheduleRun(): void {
    if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      void this._run();
    }, LIVE_SEARCH_DEBOUNCE_MS);
  }

  private async _run(): Promise<void> {
    // Cancel any pending debounce — this run supersedes it.
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    // Supersede any prior run.
    this._cancelActive();
    const runId = ++this._runId;
    this._seenIds.clear();
    this._matchCount = 0;
    this._results = [];
    this._activeQuery = "";
    if (this._renderThrottle !== null) {
      clearTimeout(this._renderThrottle);
      this._renderThrottle = null;
    }
    this._renderResultList(); // clears the list

    const q = this._query.trim();
    if (!q) {
      this._status("Type to search · Esc close");
      return;
    }
    if (q.length < MIN_QUERY_LENGTH) {
      this._status(`Type at least ${MIN_QUERY_LENGTH} characters…`);
      return;
    }

    const roomId = AppState.get("currentRoomId");
    if (!roomId) {
      this._status("No room selected.");
      return;
    }
    this._activeQuery = q;

    // Tier 1 — loaded window (instant, synchronous).
    if (this._scope === "loaded") {
      this._results = this._timeline.searchLoaded(q);
      this._matchCount = this._results.length;
      this._renderResultList();
      this._status(`${this._countLabel(this._matchCount)} in loaded messages`);
      return;
    }

    // Tier 2 — local cache (one fast call, bounded).
    if (this._scope === "cache") {
      this._status("Searching local cache…");
      try {
        const events = await searchRoomCache(roomId, q);
        if (runId !== this._runId) return;
        this._results = events.map(eventToResult);
        this._matchCount = this._results.length;
        this._renderResultList();
        this._status(`${this._countLabel(this._matchCount)} in local cache`);
      } catch (err) {
        if (runId === this._runId) this._status(`Error: ${this._errMsg(err)}`);
      }
      return;
    }

    // Tiers 3/4 — streaming server scan.
    let untilTs: number | undefined;
    if (this._scope === "date") {
      const parsed = this._parseUntilTs();
      if (parsed === null) {
        this._status("Pick a date to search back to.");
        return;
      }
      untilTs = parsed;
    }

    this._status("Searching…");
    this._setCancelVisible(true);

    // Captured per-run so the progress callback uses a stable denominator.
    const scope = this._scope;
    // Anchor (100%-start) for the time-based bar: the newest loaded message
    // (≈ the search start point), falling back to now.
    const anchorTs = this._timeline.newestTimestamp() ?? Date.now();
    // For the entire-history tier, seed a baseline total from a prior completed
    // full scan (if any) so the bar can show a real percentage.
    let baseline: number | null = null;
    if (scope === "all") {
      try {
        baseline = await getRoomScanTotal(roomId);
      } catch {
        baseline = null;
      }
      if (runId !== this._runId) return;
    }

    // Show the bar immediately (indeterminate until the first progress tick).
    this._showIndeterminateProgress();

    this._unlisten = await listenSearchEvents(
      (hit) => {
        if (runId !== this._runId || hit.room_id !== roomId) return;
        this._addHit(eventToResult(hit.event));
      },
      (prog) => {
        if (runId !== this._runId) return;
        this._updateScanProgress(prog.scanned, prog.oldest_ts ?? null, scope, anchorTs, untilTs, baseline);
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
      this._completeProgress(summary.canceled);
    } catch (err) {
      if (runId === this._runId) {
        this._status(`Error: ${this._errMsg(err)}`);
        this._resetProgress();
      }
    } finally {
      if (runId === this._runId) {
        this._setCancelVisible(false);
        this._cleanupListener();
        // Flush a final sorted render in case the last hits arrived after the
        // most recent throttled render.
        if (this._renderThrottle !== null) {
          clearTimeout(this._renderThrottle);
          this._renderThrottle = null;
        }
        this._renderResultList();
      }
    }
  }

  private _countLabel(n: number): string {
    return `${n.toLocaleString()} match${n === 1 ? "" : "es"}`;
  }

  private _errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /** Append a result row, but stop building DOM once the render cap is hit
   *  (appending a one-time note instead). Match counts are tracked separately. */
  private _appendCapped(result: SearchResult, query: string): void {
    if (this._renderedCount >= MAX_RENDERED_RESULTS) {
      if (!this._capNoted) {
        this._capNoted = true;
        const note = document.createElement("div");
        note.className = "search-dialog__item search-dialog__item--empty";
        note.textContent = `Showing first ${MAX_RENDERED_RESULTS.toLocaleString()} — refine your search to narrow results.`;
        this._listEl.appendChild(note);
      }
      return;
    }
    this._renderedCount++;
    this._listEl.appendChild(this._buildItem(result, query));
  }

  /** Record a streaming hit (deduped) and schedule a throttled re-render. */
  private _addHit(result: SearchResult): void {
    if (this._seenIds.has(result.eventId)) return;
    this._seenIds.add(result.eventId);
    this._matchCount++;
    this._results.push(result);
    this._scheduleRender();
  }

  /** Throttle re-renders while hits stream in (a full sorted render per hit
   *  would thrash); coalesces bursts into one render. */
  private _scheduleRender(): void {
    if (this._renderThrottle !== null) return;
    this._renderThrottle = setTimeout(() => {
      this._renderThrottle = null;
      this._renderResultList();
    }, 150);
  }

  /** Render `_results` sorted by the active sort order, capped at
   *  MAX_RENDERED_RESULTS. Used by every tier and on sort-order change. */
  private _renderResultList(): void {
    this._listEl.innerHTML = "";
    this._renderedCount = 0;
    this._capNoted = false;
    // Nothing searched yet — leave the list blank (status carries the prompt).
    if (!this._activeQuery) return;
    if (this._results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-dialog__item search-dialog__item--empty";
      empty.textContent = "No matches.";
      this._listEl.appendChild(empty);
      return;
    }
    const sorted = [...this._results].sort((a, b) =>
      this._sort === "newest" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp,
    );
    for (const r of sorted) this._appendCapped(r, this._activeQuery);
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
