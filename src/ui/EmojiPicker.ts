// Keyboard-navigable emoji / sticker / GIF tab picker

import { keymapManager } from "../vim/keybindings.js";

export type PickerTab = "emoji" | "sticker" | "gif";

export interface EmojiEntry {
  /** Unicode glyph or :shortcode: */
  key: string;
  /** Optional mxc:// URL for custom emoji */
  imageUrl?: string;
  /** Shortcode label, e.g. "partyblob" */
  shortcode: string;
}

type SelectCallback = (entry: EmojiEntry) => void;
type TabChangeCallback = (tab: PickerTab) => void;

const COLS = 8;

/** Keyboard-navigable emoji / sticker / GIF picker overlay. */
export class EmojiPicker {
  private _el: HTMLElement;
  private _tabBarEl: HTMLElement;
  private _searchEl: HTMLInputElement;
  private _gridEl: HTMLElement;

  private _allEntries: EmojiEntry[] = [];
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
    this._focusCell(0);
  }

  hide(): void {
    this._el.style.display = "none";
    this._searchEl.style.display = "none";
    this._searchEl.value = "";
    this._searchActive = false;
    this._applyFilter("");
    keymapManager.resetSequence();
  }

  /** Replace the displayed emoji entries (call again when tab changes). */
  setEntries(entries: EmojiEntry[]): void {
    this._allEntries = entries;
    this._applyFilter(this._searchEl.value);
  }

  setTab(tab: PickerTab): void {
    this._switchTab(tab);
  }

  // ── Private ────────────────────────────────────────────────────────────

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
    this._filteredEntries = q
      ? this._allEntries.filter(
          (e) => e.shortcode.toLowerCase().includes(q) || e.key.includes(q)
        )
      : this._allEntries;
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
    if (cells.length === 0) return;
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

    const cells = this._gridEl.querySelectorAll<HTMLElement>(".emoji-picker__cell");
    const total = cells.length;

    // Escape: if search active, close search; otherwise close picker
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

    // Tab and / are overlay-specific — not remappable
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const tabs: PickerTab[] = ["emoji", "sticker", "gif"];
      const next = tabs[(tabs.indexOf(this._currentTab) + 1) % tabs.length];
      this._switchTab(next);
      return;
    }

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
}
