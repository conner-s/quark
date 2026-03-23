// GIF search overlay

export interface GifResult {
  id: string;
  /** URL to the animated preview thumbnail (low-res) */
  previewUrl: string;
  /** URL to the full-size GIF for upload */
  url: string;
  /** Alt text / title */
  title: string;
}

type GifSelectCallback = (gif: GifResult) => void;
type GifSearchCallback = (query: string) => void;
type GifLoadMoreCallback = () => void;

const GIF_COLS = 3;

/** GIF search overlay with keyboard-navigable grid. */
export class GifPicker {
  private _el: HTMLElement;
  private _searchEl: HTMLInputElement;
  private _statusEl: HTMLElement;
  private _gridEl: HTMLElement;

  private _results: GifResult[] = [];
  private _focusIndex = 0;

  private _onSelect: GifSelectCallback | null = null;
  private _onSearch: GifSearchCallback | null = null;
  private _onLoadMore: GifLoadMoreCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "gif-picker";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "GIF search");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    // ── Header ───────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "gif-picker__header";
    this._el.appendChild(header);

    const title = document.createElement("span");
    title.className = "gif-picker__title";
    title.textContent = "GIF Search";
    header.appendChild(title);

    // ── Search input ─────────────────────────────────────────────────────
    this._searchEl = document.createElement("input");
    this._searchEl.type = "text";
    this._searchEl.className = "gif-picker__search";
    this._searchEl.placeholder = "Search GIFs…";
    this._searchEl.setAttribute("aria-label", "Search GIFs");
    this._searchEl.setAttribute("autocomplete", "off");
    this._searchEl.setAttribute("spellcheck", "false");
    this._el.appendChild(this._searchEl);

    this._searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._onSearch?.(this._searchEl.value.trim());
      }
    });

    // ── Status / hint bar ────────────────────────────────────────────────
    this._statusEl = document.createElement("div");
    this._statusEl.className = "gif-picker__status";
    this._statusEl.textContent = "Type to search · Tab: more results · Enter: send · Esc: close";
    this._el.appendChild(this._statusEl);

    // ── Grid ─────────────────────────────────────────────────────────────
    this._gridEl = document.createElement("div");
    this._gridEl.className = "gif-picker__grid";
    this._gridEl.setAttribute("role", "grid");
    this._gridEl.setAttribute("aria-label", "GIF results");
    this._el.appendChild(this._gridEl);

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

  show(): void {
    this._el.style.display = "";
    this._searchEl.focus();
  }

  hide(): void {
    this._el.style.display = "none";
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
      img.src = gif.previewUrl;
      img.alt = gif.title;
      img.className = "gif-picker__thumbnail";
      img.loading = "lazy";
      cell.appendChild(img);

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
    // Allow normal typing in search box — only intercept non-input keys
    if (document.activeElement === this._searchEl) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
      // Other keys pass through to the search input normally
      return;
    }

    const total = this._results.length;

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        this.hide();
        return;

      case "Tab":
        e.preventDefault();
        this._onLoadMore?.();
        return;

      case "Enter":
        e.preventDefault();
        this._selectIndex(this._focusIndex);
        return;

      case "/":
        e.preventDefault();
        this._searchEl.focus();
        return;

      case "j":
      case "ArrowDown":
        e.preventDefault();
        if (total > 0) this._focusCell(Math.min(this._focusIndex + GIF_COLS, total - 1));
        return;

      case "k":
      case "ArrowUp":
        e.preventDefault();
        if (total > 0) this._focusCell(Math.max(this._focusIndex - GIF_COLS, 0));
        return;

      case "l":
      case "ArrowRight":
        e.preventDefault();
        if (total > 0) this._focusCell(Math.min(this._focusIndex + 1, total - 1));
        return;

      case "h":
      case "ArrowLeft":
        e.preventDefault();
        if (total > 0) this._focusCell(Math.max(this._focusIndex - 1, 0));
        return;
    }
  }
}
