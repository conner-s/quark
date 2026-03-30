// Sticker grid browser

export interface StickerEntry {
  id: string;
  /** Display name / shortcode */
  name: string;
  /** mxc:// URL of the sticker image */
  url: string;
  /** Optional thumbnail URL (lower res for the grid) */
  thumbnailUrl?: string;
  /** Pack this sticker belongs to */
  packName?: string;
}

type StickerSelectCallback = (sticker: StickerEntry) => void;

const STICKER_COLS = 4;

/** Keyboard-navigable sticker pack browser. */
export class StickerPicker {
  private _el: HTMLElement;
  private _searchEl: HTMLInputElement;
  private _packLabelEl: HTMLElement;
  private _gridEl: HTMLElement;

  private _allStickers: StickerEntry[] = [];
  private _filteredStickers: StickerEntry[] = [];
  private _focusIndex = 0;
  private _searchActive = false;

  private _onSelect: StickerSelectCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "sticker-picker";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Sticker picker");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    // ── Pack label ───────────────────────────────────────────────────────
    this._packLabelEl = document.createElement("div");
    this._packLabelEl.className = "sticker-picker__pack-label";
    this._el.appendChild(this._packLabelEl);

    // ── Search bar ───────────────────────────────────────────────────────
    this._searchEl = document.createElement("input");
    this._searchEl.type = "text";
    this._searchEl.className = "sticker-picker__search";
    this._searchEl.placeholder = "Search stickers…";
    this._searchEl.setAttribute("aria-label", "Search stickers");
    this._searchEl.setAttribute("autocomplete", "off");
    this._searchEl.setAttribute("spellcheck", "false");
    this._searchEl.style.display = "none";
    this._searchEl.addEventListener("input", () => this._applyFilter(this._searchEl.value));
    this._el.appendChild(this._searchEl);

    // ── Grid ─────────────────────────────────────────────────────────────
    this._gridEl = document.createElement("div");
    this._gridEl.className = "sticker-picker__grid";
    this._gridEl.setAttribute("role", "grid");
    this._gridEl.setAttribute("aria-label", "Sticker grid");
    this._el.appendChild(this._gridEl);

    // ── Keyboard handling ────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onSelect(cb: StickerSelectCallback): void {
    this._onSelect = cb;
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  show(): void {
    this._el.style.display = "";
    this._focusIndex = 0;
    this._focusCell(0);
  }

  hide(): void {
    this._el.style.display = "none";
    this._searchEl.style.display = "none";
    this._searchEl.value = "";
    this._searchActive = false;
    this._applyFilter("");
  }

  setStickers(stickers: StickerEntry[]): void {
    this._allStickers = stickers;
    this._applyFilter(this._searchEl.value);
    this._updatePackLabel();
  }

  /**
   * Update the resolved thumbnail URL for a sticker after async download.
   * Patches the live DOM cell and both the canonical + filtered entry lists
   * so re-renders pick up the resolved URL.
   */
  updateStickerThumbnail(id: string, thumbnailUrl: string): void {
    const canonical = this._allStickers.find((s) => s.id === id);
    if (canonical) canonical.thumbnailUrl = thumbnailUrl;
    const filtered = this._filteredStickers.find((s) => s.id === id);
    if (filtered) filtered.thumbnailUrl = thumbnailUrl;

    // Patch live img src without a full re-render
    const cells = this._gridEl.querySelectorAll<HTMLElement>(".sticker-picker__cell");
    for (const cell of cells) {
      const idx = Number(cell.dataset.index);
      if (this._filteredStickers[idx]?.id === id) {
        const img = cell.querySelector<HTMLImageElement>("img");
        if (img) img.src = thumbnailUrl;
        break;
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _updatePackLabel(): void {
    // Show name of pack from first visible entry, or empty
    const first = this._filteredStickers[0];
    this._packLabelEl.textContent = first?.packName ?? "";
  }

  private _applyFilter(query: string): void {
    const q = query.toLowerCase().trim();
    this._filteredStickers = q
      ? this._allStickers.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.packName?.toLowerCase().includes(q) ?? false)
        )
      : this._allStickers;
    this._renderGrid();
    this._focusIndex = 0;
    this._updatePackLabel();
  }

  private _renderGrid(): void {
    this._gridEl.innerHTML = "";

    for (let i = 0; i < this._filteredStickers.length; i++) {
      const sticker = this._filteredStickers[i];
      const cell = document.createElement("button");
      cell.className = "sticker-picker__cell";
      cell.type = "button";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("tabindex", i === this._focusIndex ? "0" : "-1");
      cell.setAttribute("aria-label", sticker.name);
      cell.title = sticker.name;
      cell.dataset.index = String(i);

      const img = document.createElement("img");
      img.src = sticker.thumbnailUrl ?? sticker.url;
      img.alt = sticker.name;
      img.className = "sticker-picker__img";
      img.loading = "lazy";
      cell.appendChild(img);

      const label = document.createElement("span");
      label.className = "sticker-picker__cell-label";
      label.textContent = sticker.name;
      cell.appendChild(label);

      cell.addEventListener("click", () => this._selectIndex(i));
      this._gridEl.appendChild(cell);
    }
  }

  private _focusCell(index: number): void {
    const cells = this._gridEl.querySelectorAll<HTMLElement>(".sticker-picker__cell");
    if (cells.length === 0) return;
    this._focusIndex = Math.max(0, Math.min(index, cells.length - 1));
    for (let i = 0; i < cells.length; i++) {
      cells[i].setAttribute("tabindex", i === this._focusIndex ? "0" : "-1");
    }
    cells[this._focusIndex]?.focus();
  }

  private _selectIndex(index: number): void {
    const sticker = this._filteredStickers[index];
    if (sticker) {
      this._onSelect?.(sticker);
      this.hide();
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    const cells = this._gridEl.querySelectorAll<HTMLElement>(".sticker-picker__cell");
    const total = cells.length;

    if (this._searchActive && e.key === "Escape") {
      e.preventDefault();
      this._searchActive = false;
      this._searchEl.style.display = "none";
      this._searchEl.value = "";
      this._applyFilter("");
      this._focusCell(0);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      this.hide();
      return;
    }

    if (e.key === "/" && !this._searchActive) {
      e.preventDefault();
      this._searchActive = true;
      this._searchEl.style.display = "";
      this._searchEl.focus();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      this._selectIndex(this._focusIndex);
      return;
    }

    if (total === 0) return;

    let next = this._focusIndex;

    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        next = Math.min(this._focusIndex + STICKER_COLS, total - 1);
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        next = Math.max(this._focusIndex - STICKER_COLS, 0);
        break;
      case "l":
      case "ArrowRight":
        e.preventDefault();
        next = Math.min(this._focusIndex + 1, total - 1);
        break;
      case "h":
      case "ArrowLeft":
        e.preventDefault();
        next = Math.max(this._focusIndex - 1, 0);
        break;
      default:
        return;
    }

    this._focusCell(next);
  }
}
