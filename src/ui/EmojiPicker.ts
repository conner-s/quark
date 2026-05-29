// Keyboard-navigable emoji / sticker / GIF tab picker

import { PickerBase, SelectionList } from "./PickerBase.js";

export type PickerTab = "emoji" | "sticker" | "gif";

export interface EmojiEntry {
  /** Unicode glyph or :shortcode: */
  key: string;
  /** Optional resolved image URL for custom emoji */
  imageUrl?: string;
  /** Shortcode label, e.g. "partyblob" */
  shortcode: string;
  /** Optional search keywords (CLDR tags + alias shortcodes) */
  keywords?: string[];
}

export interface EmojiPickerCategory {
  id: string;
  icon: string;
  name: string;
  entries: EmojiEntry[];
}

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

type SelectCallback = (entry: EmojiEntry) => void;
type StickerSelectCallback = (sticker: StickerEntry) => void;
type TabChangeCallback = (tab: PickerTab) => void;
type StickerTabActivatedCallback = () => void;

const COLS = 7;
const STICKER_COLS = 4;

/** Keyboard-navigable emoji / sticker / GIF picker overlay. */
export class EmojiPicker extends PickerBase {
  private _tabBarEl: HTMLElement;
  private _currentTab: PickerTab = "emoji";

  // ── Emoji section ──────────────────────────────────────────────────────
  private _emojiSectionEl: HTMLElement;
  private _categoryBarEl: HTMLElement;
  private _searchEl: HTMLInputElement;
  private _gridEl: HTMLElement;
  private _emojiList: SelectionList;

  private _categories: EmojiPickerCategory[] = [];
  private _activeCategoryId: string | null = null;
  private _allEntries: EmojiEntry[] = [];
  private _filteredEntries: EmojiEntry[] = [];
  private _searchActive = false;

  // ── Sticker section ────────────────────────────────────────────────────
  private _stickerSectionEl: HTMLElement;
  private _stickerSearchEl: HTMLInputElement;
  private _stickerPackLabelEl: HTMLElement;
  private _stickerGridEl: HTMLElement;
  private _stickerList: SelectionList;

  private _stickerAllEntries: StickerEntry[] = [];
  private _stickerFilteredEntries: StickerEntry[] = [];
  private _stickerSearchActive = false;

  // ── Callbacks ──────────────────────────────────────────────────────────
  private _onSelect: SelectCallback | null = null;
  private _onStickerSelect: StickerSelectCallback | null = null;
  private _onTabChange: TabChangeCallback | null = null;
  private _onStickerTabActivated: StickerTabActivatedCallback | null = null;

  constructor() {
    super({
      className: "emoji-picker",
      ariaLabel: "Emoji picker",
      focusable: true,
    });

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

    // ── Emoji section ─────────────────────────────────────────────────────
    this._emojiSectionEl = document.createElement("div");
    this._emojiSectionEl.className = "emoji-picker__section";
    this._el.appendChild(this._emojiSectionEl);

    this._categoryBarEl = document.createElement("div");
    this._categoryBarEl.className = "emoji-picker__categories";
    this._categoryBarEl.style.display = "none";
    this._emojiSectionEl.appendChild(this._categoryBarEl);

    this._searchEl = document.createElement("input");
    this._searchEl.type = "text";
    this._searchEl.className = "emoji-picker__search";
    this._searchEl.placeholder = "Search emoji…";
    this._searchEl.setAttribute("aria-label", "Search emoji");
    this._searchEl.setAttribute("autocomplete", "off");
    this._searchEl.setAttribute("spellcheck", "false");
    this._searchEl.style.display = "none";
    this._searchEl.addEventListener("input", () => this._applyFilter(this._searchEl.value));
    this._emojiSectionEl.appendChild(this._searchEl);

    this._gridEl = document.createElement("div");
    this._gridEl.className = "emoji-picker__grid";
    this._gridEl.setAttribute("role", "grid");
    this._gridEl.setAttribute("aria-label", "Emoji grid");
    this._emojiSectionEl.appendChild(this._gridEl);

    // ── Sticker section ───────────────────────────────────────────────────
    this._stickerSectionEl = document.createElement("div");
    this._stickerSectionEl.className = "emoji-picker__section";
    this._stickerSectionEl.style.display = "none";
    this._el.appendChild(this._stickerSectionEl);

    this._stickerPackLabelEl = document.createElement("div");
    this._stickerPackLabelEl.className = "sticker-picker__pack-label";
    this._stickerSectionEl.appendChild(this._stickerPackLabelEl);

    this._stickerSearchEl = document.createElement("input");
    this._stickerSearchEl.type = "text";
    this._stickerSearchEl.className = "sticker-picker__search";
    this._stickerSearchEl.placeholder = "Search stickers…";
    this._stickerSearchEl.setAttribute("aria-label", "Search stickers");
    this._stickerSearchEl.setAttribute("autocomplete", "off");
    this._stickerSearchEl.setAttribute("spellcheck", "false");
    this._stickerSearchEl.style.display = "none";
    this._stickerSearchEl.addEventListener("input", () => this._applyStickerFilter(this._stickerSearchEl.value));
    this._stickerSectionEl.appendChild(this._stickerSearchEl);

    this._stickerGridEl = document.createElement("div");
    this._stickerGridEl.className = "sticker-picker__grid";
    this._stickerGridEl.setAttribute("role", "grid");
    this._stickerGridEl.setAttribute("aria-label", "Sticker grid");
    this._stickerSectionEl.appendChild(this._stickerGridEl);

    // ── Navigation models (one per grid) ─────────────────────────────────
    // Both route through `keymapManager.resolveKey(key, "picker")` so user
    // rebindings apply uniformly; the column count differs per grid.
    this._emojiList = new SelectionList({
      columns: COLS,
      highlight: { kind: "tabindex" },
      getItems: () =>
        Array.from(this._gridEl.querySelectorAll<HTMLElement>(".emoji-picker__cell")),
      onSelect: (i) => this._selectIndex(i),
    });
    this._stickerList = new SelectionList({
      columns: STICKER_COLS,
      highlight: { kind: "tabindex" },
      getItems: () =>
        Array.from(this._stickerGridEl.querySelectorAll<HTMLElement>(".sticker-picker__cell")),
      onSelect: (i) => this._selectStickerIndex(i),
    });

    // ── Keyboard handling ────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));

    // ── Click outside closes (mousedown + touchstart, for the iOS WebView) ─
    this.registerOutsideClose();
  }

  onSelect(cb: SelectCallback): void {
    this._onSelect = cb;
  }

  onStickerSelect(cb: StickerSelectCallback): void {
    this._onStickerSelect = cb;
  }

  onTabChange(cb: TabChangeCallback): void {
    this._onTabChange = cb;
  }

  /** Called when the sticker tab is activated so the host can load sticker data. */
  onStickerTabActivated(cb: StickerTabActivatedCallback): void {
    this._onStickerTabActivated = cb;
  }

  show(tab?: PickerTab): void {
    this.reveal();
    if (tab && tab !== this._currentTab) {
      this._switchTab(tab);
    } else {
      // If showing the sticker tab again (room may have changed), reload data
      if (this._currentTab === "sticker") {
        this._onStickerTabActivated?.();
      }
      this._focusActiveSection();
    }
  }

  hide(): void {
    this.conceal(); // hides + deregisters modal + keymapManager.resetSequence()
    // Reset emoji search
    this._searchEl.style.display = "none";
    this._searchEl.value = "";
    this._searchActive = false;
    this._applyFilter("");
    // Reset sticker search
    this._stickerSearchEl.style.display = "none";
    this._stickerSearchEl.value = "";
    this._stickerSearchActive = false;
    this._applyStickerFilter("");
  }

  /** Set categorised emoji entries for the emoji tab. Builds the category bar. */
  setCategories(categories: EmojiPickerCategory[]): void {
    this._categories = categories;
    this._rebuildCategoryBar();
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
    if (this._activeCategoryId) {
      const active = this._categories.find((c) => c.id === this._activeCategoryId);
      if (active) {
        this._allEntries = active.entries;
        this._applyFilter(this._searchEl.value);
      }
    }
    if (!this._activeCategoryId && this._categories.length > 0) {
      this._selectCategory(this._categories[0].id, false);
    }
  }

  /** Replace the displayed emoji entries (flat list, no categories). */
  setEntries(entries: EmojiEntry[]): void {
    this._allEntries = entries;
    this._applyFilter(this._searchEl.value);
    if (this.isVisible() && document.activeElement === this._el) {
      this._emojiList.setFocus(0);
    }
  }

  setTab(tab: PickerTab): void {
    this._switchTab(tab);
  }

  // ── Sticker methods ────────────────────────────────────────────────────

  setStickers(stickers: StickerEntry[]): void {
    this._stickerAllEntries = stickers;
    this._applyStickerFilter(this._stickerSearchEl.value);
    this._updateStickerPackLabel();
  }

  updateStickerThumbnail(id: string, thumbnailUrl: string): void {
    const canonical = this._stickerAllEntries.find((s) => s.id === id);
    if (canonical) canonical.thumbnailUrl = thumbnailUrl;
    const filtered = this._stickerFilteredEntries.find((s) => s.id === id);
    if (filtered) filtered.thumbnailUrl = thumbnailUrl;

    const cells = this._stickerGridEl.querySelectorAll<HTMLElement>(".sticker-picker__cell");
    for (const cell of cells) {
      const idx = Number(cell.dataset.index);
      if (this._stickerFilteredEntries[idx]?.id === id) {
        const img = cell.querySelector<HTMLImageElement>("img");
        if (img) img.src = thumbnailUrl;
        break;
      }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _focusActiveSection(): void {
    if (this._currentTab === "sticker") {
      this._focusStickerCell(0);
    } else {
      const cells = this._gridEl.querySelectorAll<HTMLElement>(".emoji-picker__cell");
      if (cells.length > 0) {
        this._emojiList.setFocus(0);
      } else {
        this._el.focus();
      }
    }
  }

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
    if (focusGrid) this._emojiList.setFocus(0);
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
    if (tab === "gif") {
      // GIF is a separate overlay — delegate to host
      this._onTabChange?.(tab);
      return;
    }

    this._currentTab = tab;
    for (const btn of this._tabBarEl.querySelectorAll<HTMLElement>(".emoji-picker__tab")) {
      const isActive = btn.dataset.tab === tab;
      btn.setAttribute("aria-selected", String(isActive));
      btn.classList.toggle("emoji-picker__tab--active", isActive);
    }

    if (tab === "sticker") {
      this._emojiSectionEl.style.display = "none";
      this._stickerSectionEl.style.display = "";
      // Notify host to load sticker data
      this._onStickerTabActivated?.();
      this._focusStickerCell(0);
    } else {
      this._stickerSectionEl.style.display = "none";
      this._emojiSectionEl.style.display = "";
      const cells = this._gridEl.querySelectorAll<HTMLElement>(".emoji-picker__cell");
      if (cells.length > 0) this._emojiList.setFocus(0);
      else this._el.focus();
    }
  }

  private _applyFilter(query: string): void {
    const q = query.toLowerCase().trim();
    if (q) {
      const allEntries = this._categories.length > 0
        ? this._categories.flatMap((c) => c.entries)
        : this._allEntries;
      this._filteredEntries = allEntries.filter(
        (e) =>
          e.shortcode.toLowerCase().includes(q) ||
          e.key.includes(q) ||
          (e.keywords?.some((kw) => kw.toLowerCase().includes(q)) ?? false)
      );
    } else {
      this._filteredEntries = this._allEntries;
    }
    this._renderGrid();
    this._emojiList.resetIndex();
  }

  private _renderGrid(): void {
    this._gridEl.innerHTML = "";

    for (let i = 0; i < this._filteredEntries.length; i++) {
      const entry = this._filteredEntries[i];
      const cell = document.createElement("button");
      cell.className = "emoji-picker__cell";
      cell.type = "button";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("tabindex", i === this._emojiList.focusIndex ? "0" : "-1");
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
    this._emojiList.setFocus(index);
  }

  private _selectIndex(index: number): void {
    const entry = this._filteredEntries[index];
    if (entry) {
      this._onSelect?.(entry);
      this.hide();
    }
  }

  private _cycleCategory(dir: -1 | 1): void {
    if (this._categories.length === 0) return;
    const idx = this._categories.findIndex((c) => c.id === this._activeCategoryId);
    const next = (idx + dir + this._categories.length) % this._categories.length;
    this._selectCategory(this._categories[next].id, true);
  }

  // ── Sticker section private ────────────────────────────────────────────

  private _updateStickerPackLabel(): void {
    // Pack labels are now rendered as inline section headers in the grid.
    // Clear the legacy label element so it doesn't show a stale single-pack name.
    this._stickerPackLabelEl.textContent = "";
  }

  private _applyStickerFilter(query: string): void {
    const q = query.toLowerCase().trim();
    this._stickerFilteredEntries = q
      ? this._stickerAllEntries.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.packName?.toLowerCase().includes(q) ?? false)
        )
      : this._stickerAllEntries;
    this._renderStickerGrid();
    this._stickerList.resetIndex();
    this._updateStickerPackLabel();
  }

  private _renderStickerGrid(): void {
    this._stickerGridEl.innerHTML = "";

    let lastPackName: string | undefined = undefined;

    for (let i = 0; i < this._stickerFilteredEntries.length; i++) {
      const sticker = this._stickerFilteredEntries[i];

      // Insert a pack header row whenever the pack name changes
      const packName = sticker.packName ?? "";
      if (packName !== lastPackName) {
        lastPackName = packName;
        if (packName) {
          const header = document.createElement("div");
          header.className = "sticker-picker__pack-header";
          header.textContent = packName;
          this._stickerGridEl.appendChild(header);
        }
      }

      const cell = document.createElement("button");
      cell.className = "sticker-picker__cell";
      cell.type = "button";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("tabindex", i === this._stickerList.focusIndex ? "0" : "-1");
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

      cell.addEventListener("click", () => this._selectStickerIndex(i));
      this._stickerGridEl.appendChild(cell);
    }
  }

  private _focusStickerCell(index: number): void {
    const cells = this._stickerGridEl.querySelectorAll<HTMLElement>(".sticker-picker__cell");
    if (cells.length === 0) {
      this._el.focus();
      return;
    }
    this._stickerList.setFocus(index);
  }

  private _selectStickerIndex(index: number): void {
    const sticker = this._stickerFilteredEntries[index];
    if (sticker) {
      this._onStickerSelect?.(sticker);
      this.hide();
    }
  }

  // ── Keyboard handling ──────────────────────────────────────────────────

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    const isEscape = e.key === "Escape" || (e.ctrlKey && e.key === "[");

    if (this._currentTab === "sticker") {
      this._handleStickerKeydown(e, isEscape);
      return;
    }

    // ── Emoji tab keydown ──────────────────────────────────────────────────
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

    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const tabs: PickerTab[] = ["emoji", "sticker", "gif"];
      const next = tabs[(tabs.indexOf(this._currentTab) + 1) % tabs.length];
      this._switchTab(next);
      return;
    }

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

    if (e.key === "/" && !this._searchActive) {
      e.preventDefault();
      this._searchActive = true;
      this._searchEl.style.display = "";
      this._searchEl.focus();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      this._selectIndex(this._emojiList.focusIndex);
      return;
    }

    const total = this._gridEl.querySelectorAll(".emoji-picker__cell").length;
    if (total === 0) return;

    // Movement routes through the keymap (honours user rebindings). Select is
    // handled above as a literal Enter so it isn't shadowed here.
    const { consumed, partial } = this._emojiList.handleKey(e.key);
    if (consumed || partial) e.preventDefault();
  }

  private _handleStickerKeydown(e: KeyboardEvent, isEscape: boolean): void {
    if (this._stickerSearchActive && isEscape) {
      e.preventDefault();
      this._stickerSearchActive = false;
      this._stickerSearchEl.style.display = "none";
      this._stickerSearchEl.value = "";
      this._applyStickerFilter("");
      this._focusStickerCell(0);
      return;
    }

    if (isEscape) {
      e.preventDefault();
      this.hide();
      return;
    }

    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const tabs: PickerTab[] = ["emoji", "sticker", "gif"];
      const next = tabs[(tabs.indexOf(this._currentTab) + 1) % tabs.length];
      this._switchTab(next);
      return;
    }

    if (e.key === "/" && !this._stickerSearchActive) {
      e.preventDefault();
      this._stickerSearchActive = true;
      this._stickerSearchEl.style.display = "";
      this._stickerSearchEl.focus();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      this._selectStickerIndex(this._stickerList.focusIndex);
      return;
    }

    const total = this._stickerGridEl.querySelectorAll(".sticker-picker__cell").length;
    if (total === 0) return;

    // Movement routes through the keymap so user rebindings of the nav keys
    // apply to the sticker grid too (previously hard-coded to j/k/h/l/arrows).
    const { consumed, partial } = this._stickerList.handleKey(e.key);
    if (consumed || partial) e.preventDefault();
  }
}
