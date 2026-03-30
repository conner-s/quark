// Keyboard-navigable emoji / sticker / GIF tab picker

import { keymapManager } from "../vim/keybindings.js";

export type PickerTab = "emoji" | "sticker" | "gif";

export interface EmojiEntry {
  /** Unicode glyph or :shortcode: */
  key: string;
  /** Optional resolved image URL for custom emoji */
  imageUrl?: string;
  /** Shortcode label, e.g. "partyblob" */
  shortcode: string;
}

export interface EmojiPickerCategory {
  id: string;
  icon: string;
  name: string;
  entries: EmojiEntry[];
}

type SelectCallback = (entry: EmojiEntry) => void;
type TabChangeCallback = (tab: PickerTab) => void;

const COLS = 8;

/** Keyboard-navigable emoji / sticker / GIF picker overlay. */
export class EmojiPicker {
  private _el: HTMLElement;
  private _tabBarEl: HTMLElement;
  private _categoryBarEl: HTMLElement;
  private _searchEl: HTMLInputElement;
  private _gridEl: HTMLElement;

  private _categories: EmojiPickerCategory[] = [];
  private _activeCategoryId: string | null = null;
  private _allEntries: EmojiEntry[] = [];       // entries for the active category (or all)
  private _filteredEntries: EmojiEntry[] = [];
  private _currentTab: PickerTab = "emoji";
  private _focusIndex = 0;
  private _searchActive = false;

  private _onSelect: SelectCallback | null = null;
  private _onTabChange: TabChangeCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "emoji-picker";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Emoji picker");
    this._el.setAttribute("aria-modal", "true");
    this._el.setAttribute("tabindex", "-1"); // allows focus for keyboard events when grid is empty
    this._el.style.display = "none";

    // ── Tab bar ──────────────────────────────────────────────────────────
    this._tabBarEl = document.createElement("div");
    this._tabBarEl.className = "emoji-picker__tabs";
    this._tabBarEl.setAttribute("role", "tablist");
    this._el.appendChild(this._tabBarEl);

    const tabs: Array<{ id: PickerTab; label: string }> = [
      { id: "emoji", label: "Emoji" },
      { id: "sticker", label: "Stickers" },
      { id: "gif", label: "GIF" },
    ];
    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.className = "emoji-picker__tab";
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.setAttribute("role", "tab");
      btn.setAttribute("type", "button");
      btn.setAttribute("aria-selected", tab.id === this._currentTab ? "true" : "false");
      btn.addEventListener("click", () => this._switchTab(tab.id));
      this._tabBarEl.appendChild(btn);
    }

    // ── Category bar (hidden until categories are set) ─────────────────
    this._categoryBarEl = document.createElement("div");
    this._categoryBarEl.className = "emoji-picker__categories";
    this._categoryBarEl.style.display = "none";
    this._el.appendChild(this._categoryBarEl);

    // ── Search bar ───────────────────────────────────────────────────────
    this._searchEl = document.createElement("input");
    this._searchEl.type = "text";
    this._searchEl.className = "emoji-picker__search";
    this._searchEl.placeholder = "Search emoji…";
    this._searchEl.setAttribute("aria-label", "Search emoji");
    this._searchEl.setAttribute("autocomplete", "off");
    this._searchEl.setAttribute("spellcheck", "false");
    this._searchEl.style.display = "none";
    this._searchEl.addEventListener("input", () => this._applyFilter(this._searchEl.value));
    this._el.appendChild(this._searchEl);

    // ── Grid ─────────────────────────────────────────────────────────────
    this._gridEl = document.createElement("div");
    this._gridEl.className = "emoji-picker__grid";
    this._gridEl.setAttribute("role", "grid");
    this._gridEl.setAttribute("aria-label", "Emoji grid");
    this._el.appendChild(this._gridEl);

    // ── Keyboard handling ────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));

    // ── Click outside closes ─────────────────────────────────────────────
    document.addEventListener("mousedown", (e) => {
      if (this.isVisible() && !this._el.contains(e.target as Node)) {
        this.hide();
      }
    });
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onSelect(cb: SelectCallback): void {
    this._onSelect = cb;
  }

  onTabChange(cb: TabChangeCallback): void {
    this._onTabChange = cb;
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  show(): void {
    this._el.style.display = "";
    this._focusIndex = 0;
    const cells = this._gridEl.querySelectorAll<HTMLElement>(".emoji-picker__cell");
    if (cells.length > 0) {
      this._focusCell(0);
    } else {
      // Grid not populated yet — focus the container so Escape still works
      this._el.focus();
    }
  }

  hide(): void {
    this._el.style.display = "none";
    this._searchEl.style.display = "none";
    this._searchEl.value = "";
    this._searchActive = false;
    this._applyFilter("");
    keymapManager.resetSequence();
  }

  /** Set categorised emoji entries for the emoji tab. Builds the category bar. */
  setCategories(categories: EmojiPickerCategory[]): void {
    this._categories = categories;
    this._rebuildCategoryBar();
    // Select first category by default
    if (categories.length > 0) {
      this._selectCategory(categories[0].id, false);
    }
  }

  /**
   * Prepend additional categories (e.g. custom emoji packs loaded async).
   * If a category with the same id already exists it is replaced.
   */
  prependCategories(categories: EmojiPickerCategory[]): void {
    for (const cat of categories) {
      const idx = this._categories.findIndex((c) => c.id === cat.id);
      if (idx >= 0) {
        this._categories[idx] = cat;
      } else {
        this._categories.unshift(cat);
      }
    }
    this._rebuildCategoryBar();
    // Re-render active category in case it was updated
    if (this._activeCategoryId) {
      const active = this._categories.find((c) => c.id === this._activeCategoryId);
      if (active) {
        this._allEntries = active.entries;
        this._applyFilter(this._searchEl.value);
      }
    }
    // If we just added the first categories, select the first one
    if (!this._activeCategoryId && this._categories.length > 0) {
      this._selectCategory(this._categories[0].id, false);
    }
  }

  /** Replace the displayed emoji entries (flat list, no categories). */
  setEntries(entries: EmojiEntry[]): void {
    this._allEntries = entries;
    this._applyFilter(this._searchEl.value);
    // Focus first cell if picker is currently shown but focus was on the container
    if (this.isVisible() && document.activeElement === this._el) {
      this._focusCell(0);
    }
  }

  setTab(tab: PickerTab): void {
    this._switchTab(tab);
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _rebuildCategoryBar(): void {
    this._categoryBarEl.innerHTML = "";
    if (this._categories.length === 0) {
      this._categoryBarEl.style.display = "none";
      return;
    }
    this._categoryBarEl.style.display = "";

    for (const cat of this._categories) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-picker__category-btn";
      btn.dataset.categoryId = cat.id;
      btn.title = cat.name;
      btn.setAttribute("tabindex", "-1");

      if (cat.icon.startsWith("data:") || cat.icon.startsWith("mxc://")) {
        const img = document.createElement("img");
        img.src = cat.icon;
        img.alt = cat.name;
        img.className = "emoji-picker__category-img";
        btn.appendChild(img);
      } else {
        btn.textContent = cat.icon;
      }

      btn.addEventListener("click", () => this._selectCategory(cat.id, true));
      this._categoryBarEl.appendChild(btn);
    }

    this._updateCategoryHighlight();
  }

  private _selectCategory(id: string, focusGrid: boolean): void {
    const cat = this._categories.find((c) => c.id === id);
    if (!cat) return;
    this._activeCategoryId = id;
    this._updateCategoryHighlight();
    this._allEntries = cat.entries;
    this._applyFilter(this._searchEl.value);
    if (focusGrid) this._focusCell(0);
  }

  private _updateCategoryHighlight(): void {
    for (const btn of this._categoryBarEl.querySelectorAll<HTMLElement>(".emoji-picker__category-btn")) {
      btn.classList.toggle(
        "emoji-picker__category-btn--active",
        btn.dataset.categoryId === this._activeCategoryId
      );
    }
  }

  private _switchTab(tab: PickerTab): void {
    this._currentTab = tab;
    for (const btn of this._tabBarEl.querySelectorAll<HTMLElement>(".emoji-picker__tab")) {
      const isActive = btn.dataset.tab === tab;
      btn.setAttribute("aria-selected", String(isActive));
      btn.classList.toggle("emoji-picker__tab--active", isActive);
    }
    this._onTabChange?.(tab);
  }

  private _applyFilter(query: string): void {
    const q = query.toLowerCase().trim();
    if (q) {
      // Search across ALL categories when a query is active
      const allEntries = this._categories.length > 0
        ? this._categories.flatMap((c) => c.entries)
        : this._allEntries;
      this._filteredEntries = allEntries.filter(
        (e) => e.shortcode.toLowerCase().includes(q) || e.key.includes(q)
      );
    } else {
      this._filteredEntries = this._allEntries;
    }
    this._renderGrid();
    this._focusIndex = 0;
  }

  private _renderGrid(): void {
    this._gridEl.innerHTML = "";

    for (let i = 0; i < this._filteredEntries.length; i++) {
      const entry = this._filteredEntries[i];
      const cell = document.createElement("button");
      cell.className = "emoji-picker__cell";
      cell.type = "button";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("tabindex", i === this._focusIndex ? "0" : "-1");
      cell.setAttribute("aria-label", entry.shortcode);
      cell.title = `:${entry.shortcode}:`;
      cell.dataset.index = String(i);

      if (entry.imageUrl) {
        const img = document.createElement("img");
        img.src = entry.imageUrl;
        img.alt = entry.shortcode;
        img.className = "emoji-picker__img";
        cell.appendChild(img);
      } else {
        cell.textContent = entry.key;
      }

      cell.addEventListener("click", () => this._selectIndex(i));
      this._gridEl.appendChild(cell);
    }
  }

  private _focusCell(index: number): void {
    const cells = this._gridEl.querySelectorAll<HTMLElement>(".emoji-picker__cell");
    if (cells.length === 0) {
      this._el.focus();
      return;
    }
    this._focusIndex = Math.max(0, Math.min(index, cells.length - 1));
    for (let i = 0; i < cells.length; i++) {
      cells[i].setAttribute("tabindex", i === this._focusIndex ? "0" : "-1");
    }
    cells[this._focusIndex]?.focus();
  }

  private _selectIndex(index: number): void {
    const entry = this._filteredEntries[index];
    if (entry) {
      this._onSelect?.(entry);
      this.hide();
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    const isEscape = e.key === "Escape" || (e.ctrlKey && e.key === "[");

    // Escape: if search active, close search; otherwise close picker
    if (this._searchActive && isEscape) {
      e.preventDefault();
      this._searchActive = false;
      this._searchEl.style.display = "none";
      this._searchEl.value = "";
      this._applyFilter("");
      this._focusCell(0);
      return;
    }

    if (isEscape) {
      e.preventDefault();
      this.hide();
      return;
    }

    // Tab — cycle emoji/sticker/gif tabs
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const tabs: PickerTab[] = ["emoji", "sticker", "gif"];
      const next = tabs[(tabs.indexOf(this._currentTab) + 1) % tabs.length];
      this._switchTab(next);
      return;
    }

    // [ / ] — cycle emoji categories
    if (e.key === "[" && this._categories.length > 0) {
      e.preventDefault();
      this._cycleCategory(-1);
      return;
    }
    if (e.key === "]" && this._categories.length > 0) {
      e.preventDefault();
      this._cycleCategory(1);
      return;
    }

    // / — open search
    if (e.key === "/" && !this._searchActive) {
      e.preventDefault();
      this._searchActive = true;
      this._searchEl.style.display = "";
      this._searchEl.focus();
      return;
    }

    // Enter — select focused cell
    if (e.key === "Enter") {
      e.preventDefault();
      this._selectIndex(this._focusIndex);
      return;
    }

    const cells = this._gridEl.querySelectorAll<HTMLElement>(".emoji-picker__cell");
    const total = cells.length;
    if (total === 0) return;

    const result = keymapManager.resolveKey(e.key, "picker");

    if (result.kind === "action") {
      let next = this._focusIndex;
      switch (result.action) {
        case "nav-down":
          e.preventDefault();
          next = Math.min(this._focusIndex + COLS, total - 1);
          break;
        case "nav-up":
          e.preventDefault();
          next = Math.max(this._focusIndex - COLS, 0);
          break;
        case "nav-right":
          e.preventDefault();
          next = Math.min(this._focusIndex + 1, total - 1);
          break;
        case "nav-left":
          e.preventDefault();
          next = Math.max(this._focusIndex - 1, 0);
          break;
        case "jump-top":
          e.preventDefault();
          next = 0;
          break;
        case "jump-bottom":
          e.preventDefault();
          next = total - 1;
          break;
        default:
          return;
      }
      this._focusCell(next);
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
  }

  private _cycleCategory(dir: -1 | 1): void {
    if (this._categories.length === 0) return;
    const idx = this._categories.findIndex((c) => c.id === this._activeCategoryId);
    const next = (idx + dir + this._categories.length) % this._categories.length;
    this._selectCategory(this._categories[next].id, true);
  }
}
