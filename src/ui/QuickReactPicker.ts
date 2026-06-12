// Quick reaction picker — text input as default, Tab to browse all emoji

import { BUILTIN_EMOJI, EMOJI_CATEGORIES } from "../data/unicode-emoji.js";
import { isMobile } from "../app/mobile.js";
import { keymapManager } from "../vim/keybindings.js";
import { PickerBase } from "./PickerBase.js";

/** Build reaction data from the full built-in emoji set, with a set of pinned
 *  common reactions shown first so frequently-used emoji are always at the top. */

// Glyphs carry a U+FE0F variation selector in the fully-qualified form
// (e.g. "👍️"); strip it when matching so pinned/dedup logic is presentation
// agnostic and doesn't depend on whether a glyph is qualified.
const VARIATION_SELECTOR_16 = 0xfe0f;
const stripVS = (s: string): string =>
  [...s].filter((c) => c.codePointAt(0) !== VARIATION_SELECTOR_16).join("");

const PINNED_ORDER = ["👍", "👎", "❤️", "😂", "🎉", "🚀", "👀", "🤔", "💯", "✅", "😮", "😢"].map(stripVS);
const PINNED_EMOJI = new Set(PINNED_ORDER);

// The built-in set now includes alias shortcodes, so the same glyph can appear
// more than once; dedupe by glyph for the reaction grid (autocomplete keeps
// every alias). First occurrence wins, so primary shortcodes are preferred.
const _seenGlyphs = new Set<string>();
const _uniqueEmoji = BUILTIN_EMOJI.filter((e) => {
  const g = stripVS(e.key);
  if (_seenGlyphs.has(g)) return false;
  _seenGlyphs.add(g);
  return true;
});

const BUILTIN_REACTION_DATA: { key: string; shortcode: string; imageUrl?: string }[] = [
  // Pinned common reactions first
  ..._uniqueEmoji
    .filter((e) => PINNED_EMOJI.has(stripVS(e.key)))
    .sort((a, b) => PINNED_ORDER.indexOf(stripVS(a.key)) - PINNED_ORDER.indexOf(stripVS(b.key)))
    .map((e) => ({ key: e.key, shortcode: e.shortcode })),
  // Then the rest of the emoji set
  ..._uniqueEmoji
    .filter((e) => !PINNED_EMOJI.has(stripVS(e.key)))
    .map((e) => ({ key: e.key, shortcode: e.shortcode })),
];

/** Set of glyphs belonging to each category, keyed by category id */
const CATEGORY_GLYPHS = new Map<string, Set<string>>(
  EMOJI_CATEGORIES.map((cat) => [cat.id, new Set(cat.entries.map((e) => e.glyph))])
);

/** Special category id reserved for MSC2545 custom emoji */
const CUSTOM_CATEGORY_ID = "__custom__";

export interface CustomEmojiEntry {
  /** Reaction key — for custom emoji this is `:shortcode:` */
  key: string;
  shortcode: string;
  /** Resolved data: or https: URL for the thumbnail image */
  imageUrl: string;
}

type ReactCallback = (eventId: string, key: string) => void;

/**
 * Floating reaction picker.
 *
 * UX flow:
 *   - Opens with a text input focused — type any emoji, shortcode, or text.
 *   - Tab moves focus into the quick-emoji row; h/l or arrows navigate it.
 *   - Enter always sends: the text in the input field (if input is focused)
 *     or the highlighted quick-emoji (if the grid is focused).
 *   - Shift-Tab or Esc-while-in-grid returns focus to the input.
 *   - Esc-while-input-focused closes the picker.
 */
export class QuickReactPicker extends PickerBase {
  private _inputEl: HTMLInputElement;
  private _categoryBarEl: HTMLElement;
  private _customCatBtnEl!: HTMLButtonElement;
  private _gridEl: HTMLElement;
  private _buttons: HTMLButtonElement[] = [];
  /** Parallel data array — one entry per button, same order as _buttons */
  private _allData: { key: string; shortcode: string; imageUrl?: string }[] = [];
  /** Index of the focused button, or -1 when the text input is focused */
  private _focusedBtnIndex = -1;
  private _targetEventId: string | null = null;
  private _onReact: ReactCallback | null = null;
  private _customEmoji: CustomEmojiEntry[] = [];
  /** null = show all; otherwise the id of the active category */
  private _activeCategoryId: string | null = null;

  constructor() {
    super({
      className: "quick-react-picker",
      ariaLabel: "Add reaction",
      ariaModal: false,
      displayValue: "flex",
    });

    // ── Input row ─────────────────────────────────────────────────────────
    const inputRow = document.createElement("div");
    inputRow.className = "quick-react-picker__input-row";

    const prompt = document.createElement("span");
    prompt.className = "quick-react-picker__prompt";
    prompt.textContent = ":>";
    prompt.setAttribute("aria-hidden", "true");
    inputRow.appendChild(prompt);

    this._inputEl = document.createElement("input");
    this._inputEl.type = "text";
    this._inputEl.className = "quick-react-picker__input";
    this._inputEl.placeholder = "emoji or text…";
    this._inputEl.setAttribute("aria-label", "Reaction");
    this._inputEl.setAttribute("spellcheck", "false");
    this._inputEl.setAttribute("autocomplete", "off");
    inputRow.appendChild(this._inputEl);

    this._el.appendChild(inputRow);

    // ── Category bar ──────────────────────────────────────────────────────
    this._categoryBarEl = document.createElement("div");
    this._categoryBarEl.className = "quick-react-picker__cats";
    this._categoryBarEl.setAttribute("aria-label", "Emoji categories");

    // "All" button
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "quick-react-picker__cat-btn quick-react-picker__cat-btn--active";
    allBtn.textContent = "★";
    allBtn.title = "All";
    allBtn.dataset.categoryId = "";
    allBtn.addEventListener("click", () => this._selectCategory(null, allBtn));
    this._categoryBarEl.appendChild(allBtn);

    // "Custom" button — hidden until setCustomEmoji() supplies entries
    this._customCatBtnEl = document.createElement("button");
    this._customCatBtnEl.type = "button";
    this._customCatBtnEl.className = "quick-react-picker__cat-btn";
    this._customCatBtnEl.textContent = "🧩";
    this._customCatBtnEl.title = "Custom emoji";
    this._customCatBtnEl.dataset.categoryId = CUSTOM_CATEGORY_ID;
    this._customCatBtnEl.style.display = "none";
    this._customCatBtnEl.addEventListener("click", () =>
      this._selectCategory(CUSTOM_CATEGORY_ID, this._customCatBtnEl)
    );
    this._categoryBarEl.appendChild(this._customCatBtnEl);

    // One button per built-in category
    for (const cat of EMOJI_CATEGORIES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-react-picker__cat-btn";
      btn.textContent = cat.icon;
      btn.title = cat.name;
      btn.dataset.categoryId = cat.id;
      btn.addEventListener("click", () => this._selectCategory(cat.id, btn));
      this._categoryBarEl.appendChild(btn);
    }

    this._el.appendChild(this._categoryBarEl);

    // ── Quick emoji grid ──────────────────────────────────────────────────
    this._gridEl = document.createElement("div");
    this._gridEl.className = "quick-react-picker__grid";
    this._gridEl.setAttribute("aria-label", "Quick reactions");

    // Initial build with built-in emoji only; custom added via setCustomEmoji()
    this._rebuildButtons();

    this._el.appendChild(this._gridEl);

    // ── Hint ──────────────────────────────────────────────────────────────
    const hint = document.createElement("div");
    hint.className = "quick-react-picker__hint";
    hint.textContent = "Tab: emoji grid · Enter: react · Esc: cancel";
    this._el.appendChild(hint);

    // ── Event listeners ───────────────────────────────────────────────────
    this._inputEl.addEventListener("keydown", (e) => this._handleInputKeydown(e));
    this._inputEl.addEventListener("input", () => this._applyFilter(this._inputEl.value));
    this._gridEl.addEventListener("keydown", (e) => this._handleGridKeydown(e));

    // Click/tap outside closes (mousedown + touchstart, for the iOS WebView).
    this.registerOutsideClose();
  }

  onReact(cb: ReactCallback): void {
    this._onReact = cb;
  }

  /**
   * Prepend custom emoji from MSC2545 packs to the grid.
   * Pass an empty array to remove custom emoji.
   */
  setCustomEmoji(entries: CustomEmojiEntry[]): void {
    this._customEmoji = entries;
    this._customCatBtnEl.style.display = entries.length > 0 ? "" : "none";
    // If the custom category is the active filter but no custom emoji remain,
    // fall back to "All" so the grid isn't empty.
    if (entries.length === 0 && this._activeCategoryId === CUSTOM_CATEGORY_ID) {
      const allBtn = this._categoryBarEl.firstElementChild as HTMLButtonElement | null;
      if (allBtn) this._selectCategory(null, allBtn);
    }
    this._rebuildButtons();
    this._applyFilter(this._inputEl.value);
  }

  /**
   * Show the picker anchored near the given element.
   * Focus goes to the text input.
   */
  show(eventId: string, anchor?: HTMLElement | null): void {
    this._targetEventId = eventId;
    this._focusedBtnIndex = -1;
    this._updateBtnFocus();
    this._inputEl.value = "";
    // Reset to "All" category
    this._activeCategoryId = null;
    const allBtn = this._categoryBarEl.firstElementChild as HTMLButtonElement | null;
    if (allBtn) {
      for (const btn of Array.from(this._categoryBarEl.children) as HTMLButtonElement[]) {
        btn.classList.toggle("quick-react-picker__cat-btn--active", btn === allBtn);
      }
    }
    this._applyFilter("");

    // On mobile, ignore the anchor and dock the picker to the bottom of the
    // screen as a sheet. The anchor-based positioning produces a tiny window
    // tucked into a corner where the grid can't be scrolled comfortably.
    if (isMobile()) {
      this._el.classList.add("quick-react-picker--mobile");
      this._el.style.top = "";
      this._el.style.left = "";
      this._el.style.right = "";
      this._el.style.bottom = "";
      this._el.style.transform = "";
    } else {
      this._el.classList.remove("quick-react-picker--mobile");
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        const approxWidth = 300;
        let left = rect.left;
        if (left + approxWidth > window.innerWidth - 8) {
          left = window.innerWidth - approxWidth - 8;
        }
        this._el.style.top = `${rect.bottom + 6}px`;
        this._el.style.bottom = "";
        this._el.style.left = `${Math.max(8, left)}px`;
        this._el.style.transform = "";
      } else {
        this._el.style.top = "50%";
        this._el.style.bottom = "";
        this._el.style.left = "50%";
        this._el.style.transform = "translate(-50%, -50%)";
      }
    }

    this.reveal();
    // Defer focus so the element is rendered first; also check for overflow.
    requestAnimationFrame(() => {
      if (!isMobile() && anchor) {
        const pickerRect = this._el.getBoundingClientRect();
        if (pickerRect.bottom > window.innerHeight - 8) {
          // Flip upward: position the picker above the anchor instead
          const anchorRect = anchor.getBoundingClientRect();
          const desiredBottom = window.innerHeight - anchorRect.top + 6;
          // Clamp so the picker doesn't go off-screen at the top
          const maxBottom = window.innerHeight - pickerRect.height - 8;
          this._el.style.top = "";
          this._el.style.bottom = `${Math.min(desiredBottom, Math.max(8, maxBottom))}px`;
        }
      }
      // Skip auto-focus on mobile so the soft keyboard doesn't pop up and
      // shrink the picker; tap the input field to type instead.
      if (!isMobile()) this._inputEl.focus();
    });
  }

  hide(): void {
    this.conceal();
    this._el.style.transform = "";
    this._el.style.top = "";
    this._el.style.bottom = "";
    this._el.classList.remove("quick-react-picker--mobile");
    this._targetEventId = null;
    this._focusedBtnIndex = -1;
    this._updateBtnFocus();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** Rebuild the grid buttons from _customEmoji + built-in data. */
  private _rebuildButtons(): void {
    for (const btn of this._buttons) btn.remove();
    this._buttons = [];

    this._allData = [
      ...this._customEmoji,
      ...BUILTIN_REACTION_DATA,
    ];

    for (const entry of this._allData) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-react-picker__btn";
      btn.setAttribute("title", `:${entry.shortcode}:`);
      btn.setAttribute("tabindex", "-1");
      btn.dataset.key = entry.key;

      if (entry.imageUrl) {
        const img = document.createElement("img");
        img.src = entry.imageUrl;
        img.alt = entry.key;
        img.className = "quick-react-picker__custom-img";
        btn.appendChild(img);
      } else {
        btn.textContent = entry.key;
      }

      const capturedKey = entry.key;
      btn.addEventListener("click", () => this._pick(capturedKey));
      this._buttons.push(btn);
      this._gridEl.appendChild(btn);
    }
  }

  /**
   * Show only buttons whose emoji glyph or shortcode contains every space-separated
   * token in the query (case-insensitive substring match). Falls back to showing
   * all buttons when nothing matches, so typed text can still be sent as-is.
   * When there is no query, the active category filter is applied instead.
   */
  private _applyFilter(raw: string): void {
    // Strip a leading colon so `:party` works the same as `party`
    const q = raw.replace(/^:/, "").toLowerCase().trim();

    if (!q) {
      // No text query — apply category filter
      const showingCustom = this._activeCategoryId === CUSTOM_CATEGORY_ID;
      const catGlyphs = this._activeCategoryId && !showingCustom
        ? CATEGORY_GLYPHS.get(this._activeCategoryId)
        : null;

      for (let i = 0; i < this._buttons.length; i++) {
        const { key, imageUrl } = this._allData[i];
        if (showingCustom) {
          // Custom category — only show custom emoji (have an imageUrl)
          this._buttons[i].style.display = imageUrl ? "" : "none";
        } else if (this._activeCategoryId === null) {
          // "All" view — show everything
          this._buttons[i].style.display = "";
        } else if (imageUrl) {
          // When a built-in category is active, hide custom emoji so they're
          // only listed under the custom category.
          this._buttons[i].style.display = "none";
        } else {
          this._buttons[i].style.display = catGlyphs?.has(key) ? "" : "none";
        }
      }
      return;
    }

    // Text search overrides category filter — search all emoji
    const tokens = q.split(/\s+/);

    let anyVisible = false;
    for (let i = 0; i < this._buttons.length; i++) {
      const { key, shortcode } = this._allData[i];
      // A button matches if every token appears in the key glyph or shortcode
      const matches = tokens.every((tok) =>
        key.includes(tok) || shortcode.includes(tok)
      );
      this._buttons[i].style.display = matches ? "" : "none";
      if (matches) anyVisible = true;
    }

    // Nothing matched — show all so typed text can still be sent as-is
    if (!anyVisible) {
      for (const btn of this._buttons) btn.style.display = "";
    }

    // If the focused button is now hidden, reset focus to input
    if (
      this._focusedBtnIndex >= 0 &&
      this._buttons[this._focusedBtnIndex]?.style.display === "none"
    ) {
      this._returnToInput();
    }
  }

  /** Switch to a category (or null for "all") and update the bar highlight. */
  private _selectCategory(categoryId: string | null, activeBtnEl: HTMLButtonElement): void {
    this._activeCategoryId = categoryId;
    // Update highlighted state on all category buttons
    for (const btn of Array.from(this._categoryBarEl.children) as HTMLButtonElement[]) {
      btn.classList.toggle("quick-react-picker__cat-btn--active", btn === activeBtnEl);
    }
    // Re-apply filter using current input value (which is likely empty)
    this._applyFilter(this._inputEl.value);
  }

  private _pick(key: string): void {
    const eventId = this._targetEventId;
    this.hide();
    if (eventId && key.trim()) {
      this._onReact?.(eventId, key.trim());
    }
  }

  private _updateBtnFocus(): void {
    this._buttons.forEach((btn, i) => {
      btn.classList.toggle("quick-react-picker__btn--focused", i === this._focusedBtnIndex);
    });
  }

  /** Return the index of the next visible button at or after `from` in direction `dir`. */
  private _nextVisible(from: number, dir: 1 | -1 = 1): number {
    let i = from;
    while (i >= 0 && i < this._buttons.length) {
      if (this._buttons[i].style.display !== "none") return i;
      i += dir;
    }
    return -1;
  }

  private _focusGrid(index: number): void {
    const visible = this._nextVisible(index);
    if (visible < 0) return;
    this._focusedBtnIndex = visible;
    this._updateBtnFocus();
    this._buttons[visible]?.focus();
  }

  /**
   * Move focus one visual row up/down. The grid is `flex-wrap`, so its column
   * count varies with width and the visible buttons repack when a filter hides
   * some — a fixed "+N columns" jump lands diagonally. Instead navigate by
   * geometry: among visible buttons in the adjacent row (next distinct
   * `offsetTop` in the travel direction), pick the one whose `offsetLeft` is
   * closest to the current column. Moving up off the top row returns to the
   * input.
   */
  private _moveByRow(dir: 1 | -1): void {
    const cur = this._buttons[this._focusedBtnIndex];
    if (!cur) {
      if (dir > 0) {
        const first = this._nextVisible(0, 1);
        if (first >= 0) this._focusGrid(first);
      }
      return;
    }
    const visible = this._buttons.filter((b) => b.style.display !== "none");
    const curTop = cur.offsetTop;
    const curLeft = cur.offsetLeft;
    const adjacent = visible.filter((b) => (dir > 0 ? b.offsetTop > curTop : b.offsetTop < curTop));
    if (adjacent.length === 0) {
      if (dir < 0) this._returnToInput();
      return;
    }
    const targetTop =
      dir > 0
        ? Math.min(...adjacent.map((b) => b.offsetTop))
        : Math.max(...adjacent.map((b) => b.offsetTop));
    let best = adjacent[0];
    let bestDist = Infinity;
    for (const b of adjacent) {
      if (b.offsetTop !== targetTop) continue;
      const dist = Math.abs(b.offsetLeft - curLeft);
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    const idx = this._buttons.indexOf(best);
    if (idx >= 0) this._focusGrid(idx);
  }

  private _returnToInput(): void {
    this._focusedBtnIndex = -1;
    this._updateBtnFocus();
    this._inputEl.focus();
  }

  private _handleInputKeydown(e: KeyboardEvent): void {
    // Always stop propagation from the input so the global keydown handler
    // (which routes hjkl to the timeline) never sees these events.
    e.stopPropagation();

    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const value = this._inputEl.value.trim();
      if (value) this._pick(value);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      // Tab moves to the first visible button in the grid
      const first = this._nextVisible(0, 1);
      if (first >= 0) this._focusGrid(first);
      return;
    }
  }

  private _handleGridKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    // Escape / Ctrl+[ close; Shift-Tab returns to the input (overlay-specific,
    // not remappable).
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[") || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        this.hide();
      } else {
        this._returnToInput();
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      // Wrap through visible buttons; at end, return to input
      const next = this._nextVisible(this._focusedBtnIndex + 1, 1);
      if (next < 0) {
        this._returnToInput();
      } else {
        this._focusGrid(next);
      }
      return;
    }
    // Space sends the focused emoji (kept as a literal — not a keymap action).
    if (e.key === " ") {
      e.preventDefault();
      this._pickFocused();
      return;
    }

    // `/` jumps back to the search input (parity with the emoji picker).
    if (e.key === "/") {
      e.preventDefault();
      this._returnToInput();
      return;
    }

    // Movement + select route through the keymap so user `quarkrc` rebindings
    // (e.g. remapping j/k or the arrows) apply here too. The grid is sparse
    // (buttons may be hidden by the active filter / category), so we resolve the
    // logical action then apply the visible-aware movement that this picker
    // needs — up from the top row falls back to the input field.
    const result = keymapManager.resolveKey(e.key, "picker");
    if (result.kind === "partial") {
      e.preventDefault();
      return;
    }
    if (result.kind !== "action") return;

    switch (result.action) {
      case "nav-left": {
        e.preventDefault();
        const prev = this._nextVisible(this._focusedBtnIndex - 1, -1);
        if (prev >= 0) this._focusGrid(prev);
        break;
      }
      case "nav-right": {
        e.preventDefault();
        const next = this._nextVisible(this._focusedBtnIndex + 1, 1);
        if (next >= 0) this._focusGrid(next);
        break;
      }
      case "nav-down": {
        e.preventDefault();
        this._moveByRow(1);
        break;
      }
      case "nav-up": {
        e.preventDefault();
        this._moveByRow(-1);
        break;
      }
      case "select": {
        e.preventDefault();
        this._pickFocused();
        break;
      }
      case "close": {
        e.preventDefault();
        this.hide();
        break;
      }
    }
  }

  /** Send the currently focused grid button's emoji. */
  private _pickFocused(): void {
    const btn = this._buttons[this._focusedBtnIndex];
    const key = btn?.dataset.key ?? btn?.textContent ?? "";
    if (key) this._pick(key);
  }
}
