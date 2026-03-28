// Quick reaction picker — text input as default, Tab to browse all emoji

import { BUILTIN_EMOJI } from "../data/unicode-emoji.js";

/** Build reaction data from the full built-in emoji set, with a set of pinned
 *  common reactions shown first so frequently-used emoji are always at the top. */
const PINNED_EMOJI = new Set(["👍", "👎", "❤️", "😂", "🎉", "🚀", "👀", "🤔", "💯", "✅", "😮", "😢"]);

const REACTION_DATA: { emoji: string; shortcode: string }[] = [
  // Pinned common reactions first
  ...BUILTIN_EMOJI
    .filter((e) => PINNED_EMOJI.has(e.key))
    .sort((a, b) => {
      const order = [...PINNED_EMOJI];
      return order.indexOf(a.key) - order.indexOf(b.key);
    })
    .map((e) => ({ emoji: e.key, shortcode: e.shortcode })),
  // Then the rest of the emoji set
  ...BUILTIN_EMOJI
    .filter((e) => !PINNED_EMOJI.has(e.key))
    .map((e) => ({ emoji: e.key, shortcode: e.shortcode })),
];

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
export class QuickReactPicker {
  private _el: HTMLElement;
  private _inputEl: HTMLInputElement;
  private _gridEl: HTMLElement;
  private _buttons: HTMLButtonElement[] = [];
  /** Index of the focused button, or -1 when the text input is focused */
  private _focusedBtnIndex = -1;
  private _targetEventId: string | null = null;
  private _onReact: ReactCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "quick-react-picker";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Add reaction");
    this._el.style.display = "none";

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

    // ── Quick emoji grid ──────────────────────────────────────────────────
    this._gridEl = document.createElement("div");
    this._gridEl.className = "quick-react-picker__grid";
    this._gridEl.setAttribute("aria-label", "Quick reactions");

    for (const { emoji, shortcode } of REACTION_DATA) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-react-picker__btn";
      btn.textContent = emoji;
      btn.setAttribute("title", `:${shortcode}:`);
      btn.setAttribute("tabindex", "-1"); // managed manually
      btn.addEventListener("click", () => this._pick(emoji));
      this._buttons.push(btn);
      this._gridEl.appendChild(btn);
    }

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

    // Click outside closes
    document.addEventListener("mousedown", (e) => {
      if (this.isVisible() && !this._el.contains(e.target as Node)) {
        this.hide();
      }
    });
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onReact(cb: ReactCallback): void {
    this._onReact = cb;
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
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
    this._applyFilter("");

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

    this._el.style.display = "flex";
    // Defer focus so the element is rendered first; also check for bottom overflow.
    requestAnimationFrame(() => {
      if (anchor) {
        const pickerRect = this._el.getBoundingClientRect();
        if (pickerRect.bottom > window.innerHeight - 8) {
          // Flip upward: position the picker above the anchor instead
          const anchorRect = anchor.getBoundingClientRect();
          this._el.style.top = "";
          this._el.style.bottom = `${window.innerHeight - anchorRect.top + 6}px`;
        }
      }
      this._inputEl.focus();
    });
  }

  hide(): void {
    this._el.style.display = "none";
    this._el.style.transform = "";
    this._el.style.top = "";
    this._el.style.bottom = "";
    this._targetEventId = null;
    this._focusedBtnIndex = -1;
    this._updateBtnFocus();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Show only buttons whose emoji glyph or shortcode contains every space-separated
   * token in the query (case-insensitive substring match). Falls back to showing
   * all buttons when nothing matches, so typed text can still be sent as-is.
   */
  private _applyFilter(raw: string): void {
    // Strip a leading colon so `:party` works the same as `party`
    const q = raw.replace(/^:/, "").toLowerCase().trim();

    if (!q) {
      for (const btn of this._buttons) btn.style.display = "";
      return;
    }

    const tokens = q.split(/\s+/);

    let anyVisible = false;
    for (let i = 0; i < this._buttons.length; i++) {
      const { emoji, shortcode } = REACTION_DATA[i];
      // A button matches if every token appears in the emoji glyph or shortcode
      const matches = tokens.every((tok) =>
        emoji.includes(tok) || shortcode.includes(tok)
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

  private _focusGrid(index: number): void {
    this._focusedBtnIndex = index;
    this._updateBtnFocus();
    this._buttons[index]?.focus();
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
      // Tab (or Shift-Tab — same result, grid is right there) shows quick emoji
      this._focusGrid(0);
      return;
    }
  }

  private _handleGridKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

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
      // Wrap through grid; at end, return to input
      const next = this._focusedBtnIndex + 1;
      if (next >= this._buttons.length) {
        this._returnToInput();
      } else {
        this._focusGrid(next);
      }
      return;
    }
    if (e.key === "h" || e.key === "ArrowLeft") {
      e.preventDefault();
      if (this._focusedBtnIndex > 0) {
        this._focusGrid(this._focusedBtnIndex - 1);
      }
      return;
    }
    if (e.key === "l" || e.key === "ArrowRight") {
      e.preventDefault();
      if (this._focusedBtnIndex < this._buttons.length - 1) {
        this._focusGrid(this._focusedBtnIndex + 1);
      }
      return;
    }
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(this._buttons.length - 1, this._focusedBtnIndex + 6);
      this._focusGrid(next);
      return;
    }
    if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(0, this._focusedBtnIndex - 6);
      if (prev === this._focusedBtnIndex) {
        // Already on top row — go back to input
        this._returnToInput();
      } else {
        this._focusGrid(prev);
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const emoji = this._buttons[this._focusedBtnIndex]?.textContent ?? "";
      if (emoji) this._pick(emoji);
      return;
    }
  }
}
