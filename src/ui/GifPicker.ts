// GIF search overlay

import type { GifResult } from "../ipc/types.js";
import { keymapManager } from "../vim/keybindings.js";
export type { GifResult };

type GifSelectCallback = (gif: GifResult) => void;
type GifSearchCallback = (query: string) => void;
type GifLoadMoreCallback = () => void;

const GIF_COLS = 3;

/** GIF search popup with keyboard-navigable grid. */
export class GifPicker {
  private _el: HTMLElement;        // backdrop
  private _panelEl: HTMLElement;   // floating panel
  private _searchEl: HTMLInputElement;
  private _statusEl: HTMLElement;
  private _gridEl: HTMLElement;

  private _results: GifResult[] = [];
  private _focusIndex = 0;

  private _onSelect: GifSelectCallback | null = null;
  private _onSearch: GifSearchCallback | null = null;
  private _onLoadMore: GifLoadMoreCallback | null = null;

  constructor() {
    // ── Backdrop ─────────────────────────────────────────────────────────
    this._el = document.createElement("div");
    this._el.className = "gif-picker";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "GIF search");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    // Close on backdrop click (outside panel)
    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    // ── Panel ─────────────────────────────────────────────────────────────
    this._panelEl = document.createElement("div");
    this._panelEl.className = "gif-picker__panel";
    this._el.appendChild(this._panelEl);

    // ── Header ───────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "gif-picker__header";
    this._panelEl.appendChild(header);

    const title = document.createElement("span");
    title.className = "gif-picker__title";
    title.textContent = "GIF Search";
    header.appendChild(title);

    const closeHint = document.createElement("span");
    closeHint.className = "gif-picker__close-hint";
    closeHint.textContent = "Esc";
    closeHint.setAttribute("aria-hidden", "true");
    header.appendChild(closeHint);

    // ── Search input ─────────────────────────────────────────────────────
    const searchWrap = document.createElement("div");
    searchWrap.className = "gif-picker__search-wrap";
    this._panelEl.appendChild(searchWrap);

    const searchPrompt = document.createElement("span");
    searchPrompt.className = "gif-picker__search-prompt";
    searchPrompt.textContent = "/";
    searchPrompt.setAttribute("aria-hidden", "true");
    searchWrap.appendChild(searchPrompt);

    this._searchEl = document.createElement("input");
    this._searchEl.type = "text";
    this._searchEl.className = "gif-picker__search";
    this._searchEl.placeholder = "search GIFs…";
    this._searchEl.setAttribute("aria-label", "Search GIFs");
    this._searchEl.setAttribute("autocomplete", "off");
    this._searchEl.setAttribute("spellcheck", "false");
    searchWrap.appendChild(this._searchEl);

    this._searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._onSearch?.(this._searchEl.value.trim());
      }
    });

    // ── Grid ─────────────────────────────────────────────────────────────
    this._gridEl = document.createElement("div");
    this._gridEl.className = "gif-picker__grid";
    this._gridEl.setAttribute("role", "grid");
    this._gridEl.setAttribute("aria-label", "GIF results");
    this._panelEl.appendChild(this._gridEl);

    // ── Status / hint bar ────────────────────────────────────────────────
    this._statusEl = document.createElement("div");
    this._statusEl.className = "gif-picker__status";
    this._statusEl.textContent = "Enter to search · j/k/h/l navigate · Tab more · Esc close";
    this._panelEl.appendChild(this._statusEl);

    // ── Keyboard handling ────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onSelect(cb: GifSelectCallback): void {
    this._onSelect = cb;
  }

  onSearch(cb: GifSearchCallback): void {
    this._onSearch = cb;
  }

  onLoadMore(cb: GifLoadMoreCallback): void {
    this._onLoadMore = cb;
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  show(): void {
    this._el.style.display = "flex";
    this._searchEl.focus();
  }

  hide(): void {
    this._el.style.display = "none";
    keymapManager.resetSequence();
  }

  setResults(results: GifResult[]): void {
    this._results = results;
    this._focusIndex = 0;
    this._renderGrid();
  }

  appendResults(results: GifResult[]): void {
    this._results = [...this._results, ...results];
    this._renderGrid();
  }

  setStatus(text: string): void {
    this._statusEl.textContent = text;
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _renderGrid(): void {
    this._gridEl.innerHTML = "";

    if (this._results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gif-picker__empty";
      empty.textContent = "No results";
      this._gridEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < this._results.length; i++) {
      const gif = this._results[i];
      const cell = document.createElement("button");
      cell.className = "gif-picker__cell";
      cell.type = "button";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("tabindex", i === this._focusIndex ? "0" : "-1");
      cell.setAttribute("aria-label", gif.title || `GIF ${i + 1}`);
      cell.title = gif.title;
      cell.dataset.index = String(i);

      const img = document.createElement("img");
      img.src = gif.preview_url;
      img.alt = gif.title;
      img.className = "gif-picker__thumbnail";
      img.loading = "lazy";
      cell.appendChild(img);

      const label = document.createElement("span");
      label.className = "gif-picker__cell-label";
      label.textContent = gif.title;
      cell.appendChild(label);

      cell.addEventListener("click", () => this._selectIndex(i));
      this._gridEl.appendChild(cell);
    }
  }

  private _focusCell(index: number): void {
    const cells = this._gridEl.querySelectorAll<HTMLElement>(".gif-picker__cell");
    if (cells.length === 0) return;
    this._focusIndex = Math.max(0, Math.min(index, cells.length - 1));
    for (let i = 0; i < cells.length; i++) {
      cells[i].setAttribute("tabindex", i === this._focusIndex ? "0" : "-1");
    }
    cells[this._focusIndex]?.focus();
  }

  private _selectIndex(index: number): void {
    const gif = this._results[index];
    if (gif) {
      this._onSelect?.(gif);
      this.hide();
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    // Allow normal typing in search box — only intercept Escape
    if (document.activeElement === this._searchEl) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
      return;
    }

    const total = this._results.length;

    // Escape, Tab, Enter, / are hardcoded (overlay-specific or not remappable)
    if (e.key === "Escape") {
      e.preventDefault();
      this.hide();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      this._onLoadMore?.();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      this._selectIndex(this._focusIndex);
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      this._searchEl.focus();
      return;
    }

    const result = keymapManager.resolveKey(e.key, "picker");

    if (result.kind === "action") {
      switch (result.action) {
        case "nav-down":
          e.preventDefault();
          if (total > 0) this._focusCell(Math.min(this._focusIndex + GIF_COLS, total - 1));
          break;
        case "nav-up":
          e.preventDefault();
          if (total > 0) this._focusCell(Math.max(this._focusIndex - GIF_COLS, 0));
          break;
        case "nav-right":
          e.preventDefault();
          if (total > 0) this._focusCell(Math.min(this._focusIndex + 1, total - 1));
          break;
        case "nav-left":
          e.preventDefault();
          if (total > 0) this._focusCell(Math.max(this._focusIndex - 1, 0));
          break;
      }
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
  }
}
