// Floating context menu — replaces the browser's native right-click menu
// for app-relevant elements (messages, the compose box, room icons, …).
//
// Shell (design: "Context Menu — converged"):
//
//   ┌──────────────────────────────┐
//   │ COMPOSE                  esc │  header bar   — --surface-subtle
//   ├──────────────────────────────┤
//   │ FORMAT                       │  section head — --surface-dim
//   │ [B][I][U][S][‖][`]           │  chip row     — formatting toggles
//   │ CLIPBOARD                    │
//   │ Cut                   Ctrl+X │  item rows
//   └──────────────────────────────┘
//
// Squared off deliberately: the menu must read as *menu chrome*, not as a chat
// item, so it keeps a plain `--border-color` edge rather than the compose
// box's accent-tinted one and never borrows the styling of whatever it was
// summoned from. Sections replace bare separators — every group carries a
// header strip, which is the same shape the settings dialog already uses.
//
// On mobile (long-press), the menu morphs into a bottom sheet: full-width,
// docked to the bottom of the viewport, with large-tap rows. The trigger
// coordinates from a long-press are usually wherever the user's finger is,
// which is the worst possible spot to anchor a tiny floating popover.

import { isMobile } from "../app/mobile.js";
import { modalManager, type Modal } from "./ModalManager.js";
import { mountOverlay } from "./overlay.js";

export interface ContextMenuItem {
  label: string;
  hint?: string;        // optional keyboard shortcut hint shown on the right
  /** Rendered greyed out and inert (e.g. Edit/Delete on someone else's message). */
  disabled?: boolean;
  /** Destructive action — rendered in `--accent-error` (e.g. Discard draft). */
  danger?: boolean;
  separator?: false;
  action: () => void;
}

export interface ContextMenuSeparator {
  separator: true;
}

/** A section header strip — the grouped replacement for a bare separator. */
export interface ContextMenuSection {
  section: string;
}

/** One toggle inside a {@link ContextMenuChipRow}. */
export interface ContextMenuChip {
  label: string;
  /** Tooltip / accessible name — e.g. `Bold — **text**`. */
  title?: string;
  /**
   * Whether the toggle currently applies. A predicate is re-evaluated after
   * every chip activation so the row stays truthful while the menu is open.
   */
  active?: boolean | (() => boolean);
  /** Render the glyph in `--accent-secondary` (used by the inline-code chip). */
  accent?: boolean;
  action: () => void;
}

/**
 * A row of squared toggles filling the menu width. Unlike item rows, chips do
 * not dismiss the menu — formatting is something you apply more than once.
 */
export interface ContextMenuChipRow {
  chips: ContextMenuChip[];
}

export type ContextMenuEntry =
  | ContextMenuItem
  | ContextMenuSeparator
  | ContextMenuSection
  | ContextMenuChipRow;

export interface ContextMenuOptions {
  /** Header-bar caption, e.g. `compose` or `message · ada`. Omit for no header. */
  title?: string;
}

/** A keyboard-navigable row: either one item, or the whole chip row. */
type NavRow =
  | { kind: "item"; el: HTMLElement; item: ContextMenuItem }
  | { kind: "chips"; els: HTMLButtonElement[]; chips: ContextMenuChip[] };

function chipIsActive(chip: ContextMenuChip): boolean {
  return typeof chip.active === "function" ? chip.active() : !!chip.active;
}

export class ContextMenu implements Modal {
  private _el: HTMLElement;
  private _visible = false;
  private _rows: NavRow[] = [];
  private _activeRow = -1;
  private _activeChip = 0;
  /** Element focused when the menu opened, refocused on dismiss. */
  private _restoreFocusEl: HTMLElement | null = null;

  // Close when the user clicks/taps anywhere outside the menu. Listens to both
  // mousedown (desktop) and touchstart (mobile) since taps don't reliably
  // synthesize a mousedown before the click bubbles up — that race was eating
  // the first tap inside the bottom-sheet variant.
  private _outsideHandler = (e: Event) => {
    if (!this._el.contains(e.target as Node)) this.hide();
  };

  // Close on scroll (menu position would be stale). Scrolling *inside* the
  // menu is exempt — a long compose menu scrolls within its own max-height.
  private _scrollHandler = (e: Event) => {
    if (this._el.contains(e.target as Node)) return;
    this.hide();
  };

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "context-menu";
    this._el.setAttribute("role", "menu");
    // Focusable so the menu owns arrow/j/k keys the moment it opens. Without
    // this the div silently refuses focus and every keystroke fell through to
    // the global handler, which swallows keys while a modal is open.
    this._el.setAttribute("tabindex", "-1");
    this._el.style.display = "none";
    mountOverlay(this._el);

    this._el.addEventListener("keydown", (e) => this._handleKey(e));
  }

  show(x: number, y: number, entries: ContextMenuEntry[], opts: ContextMenuOptions = {}): void {
    this._el.innerHTML = "";
    this._rows = [];
    this._activeRow = -1;
    this._activeChip = 0;
    const active = document.activeElement;
    this._restoreFocusEl = active instanceof HTMLElement ? active : null;

    if (opts.title) this._el.appendChild(this._buildHeader(opts.title));

    for (const entry of entries) {
      if ("separator" in entry && entry.separator) {
        const sep = document.createElement("div");
        sep.className = "context-menu__separator";
        sep.setAttribute("role", "separator");
        this._el.appendChild(sep);
        continue;
      }

      if ("section" in entry) {
        const head = document.createElement("div");
        head.className = "context-menu__section";
        head.setAttribute("role", "presentation");
        head.textContent = entry.section;
        this._el.appendChild(head);
        continue;
      }

      if ("chips" in entry) {
        if (entry.chips.length === 0) continue;
        this._el.appendChild(this._buildChipRow(entry.chips));
        continue;
      }

      this._el.appendChild(this._buildItem(entry as ContextMenuItem));
    }

    this._el.classList.toggle("context-menu--mobile", isMobile());
    this._el.style.display = "block";
    this._visible = true;
    modalManager.push(this);

    if (isMobile()) {
      // Bottom-sheet variant: docks to the viewport edges; coordinates from
      // the long-press are ignored because they're typically right under the
      // user's finger and would clip badly.
      this._el.style.left = "";
      this._el.style.top = "";
    } else {
      // Position the menu; flip left/up if it would overflow the viewport
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Temporarily place off-screen to measure
      this._el.style.left = "-9999px";
      this._el.style.top = "-9999px";
      const { width, height } = this._el.getBoundingClientRect();
      const left = x + width > vw ? Math.max(0, x - width) : x;
      const top = y + height > vh ? Math.max(0, y - height) : y;
      this._el.style.left = `${left}px`;
      this._el.style.top = `${top}px`;
    }

    this._el.focus();

    // Defer outside-click registration so the triggering mousedown / touchstart
    // doesn't immediately close the menu.
    setTimeout(() => {
      document.addEventListener("mousedown", this._outsideHandler, { capture: true });
      document.addEventListener("touchstart", this._outsideHandler, { capture: true, passive: true });
      document.addEventListener("scroll", this._scrollHandler, { capture: true, passive: true });
    }, 0);
  }

  hide(): void {
    if (!this._visible) return;
    this._el.style.display = "none";
    this._el.classList.remove("context-menu--mobile");
    this._visible = false;
    this._rows = [];
    this._activeRow = -1;
    this._activeChip = 0;
    modalManager.remove(this);
    document.removeEventListener("mousedown", this._outsideHandler, { capture: true });
    document.removeEventListener("touchstart", this._outsideHandler, { capture: true });
    document.removeEventListener("scroll", this._scrollHandler, { capture: true });

    // Hand focus back to whatever summoned the menu (usually the compose
    // field) so dismissing it leaves the caret where the user left it. Item
    // activation calls hide() *before* the action runs, so an action that
    // opens a picker still wins the focus race.
    const restore = this._restoreFocusEl;
    this._restoreFocusEl = null;
    if (restore && restore.isConnected) restore.focus();
  }

  isVisible(): boolean {
    return this._visible;
  }

  getElement(): HTMLElement {
    return this._el;
  }

  // ── Building ────────────────────────────────────────────────────────────────

  private _buildHeader(title: string): HTMLElement {
    const header = document.createElement("div");
    header.className = "context-menu__header";
    header.setAttribute("role", "presentation");

    const titleEl = document.createElement("span");
    titleEl.className = "context-menu__title";
    titleEl.textContent = title;
    header.appendChild(titleEl);

    const escEl = document.createElement("span");
    escEl.className = "context-menu__esc";
    escEl.textContent = "esc";
    header.appendChild(escEl);

    return header;
  }

  private _buildItem(item: ContextMenuItem): HTMLElement {
    const rowIdx = this._rows.length;

    const row = document.createElement("div");
    row.className = "context-menu__item";
    if (item.disabled) row.classList.add("context-menu__item--disabled");
    if (item.danger) row.classList.add("context-menu__item--danger");
    row.setAttribute("role", "menuitem");
    row.setAttribute("tabindex", "-1");
    if (item.disabled) row.setAttribute("aria-disabled", "true");

    const labelEl = document.createElement("span");
    labelEl.className = "context-menu__item-label";
    labelEl.textContent = item.label;
    row.appendChild(labelEl);

    if (item.hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "context-menu__item-hint";
      hintEl.textContent = item.hint;
      row.appendChild(hintEl);
    }

    if (!item.disabled) {
      row.addEventListener("mouseenter", () => this._setActive(rowIdx));
      row.addEventListener("click", () => {
        this.hide();
        item.action();
      });
    }

    this._rows.push({ kind: "item", el: row, item });
    return row;
  }

  private _buildChipRow(chips: ContextMenuChip[]): HTMLElement {
    const rowIdx = this._rows.length;

    const wrap = document.createElement("div");
    wrap.className = "context-menu__chips";
    wrap.setAttribute("role", "group");
    // The grid fills the menu width however many toggles there are.
    wrap.style.setProperty("--context-menu-chip-cols", String(chips.length));

    const els: HTMLButtonElement[] = [];
    chips.forEach((chip, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "context-menu__chip";
      if (chip.accent) btn.classList.add("context-menu__chip--accent");
      btn.setAttribute("role", "menuitemcheckbox");
      btn.setAttribute("tabindex", "-1");
      btn.textContent = chip.label;
      if (chip.title) {
        btn.title = chip.title;
        btn.setAttribute("aria-label", chip.title);
      }
      btn.addEventListener("mouseenter", () => this._setActive(rowIdx, i));
      // Don't let the press blur/steal focus before the action reads the
      // compose field's live selection range.
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => this._activateChip(rowIdx, i));
      els.push(btn);
      wrap.appendChild(btn);
    });

    this._rows.push({ kind: "chips", els, chips });
    this._syncChipStates(this._rows.length - 1);
    return wrap;
  }

  /** Re-read every chip's `active` predicate and repaint the row. */
  private _syncChipStates(rowIdx: number): void {
    const row = this._rows[rowIdx];
    if (!row || row.kind !== "chips") return;
    row.chips.forEach((chip, i) => {
      const on = chipIsActive(chip);
      row.els[i].classList.toggle("context-menu__chip--active", on);
      row.els[i].setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  private _isFocusable(idx: number): boolean {
    const row = this._rows[idx];
    if (!row) return false;
    return row.kind === "chips" ? row.els.length > 0 : !row.item.disabled;
  }

  private _setActive(rowIdx: number, chipIdx = 0): void {
    const prev = this._rows[this._activeRow];
    if (prev?.kind === "item") prev.el.classList.remove("context-menu__item--active");
    if (prev?.kind === "chips") prev.els.forEach((el) => el.classList.remove("context-menu__chip--focus"));

    const next = this._rows[rowIdx];
    if (!next) return;
    this._activeRow = rowIdx;

    if (next.kind === "item") {
      next.el.classList.add("context-menu__item--active");
      next.el.focus();
      return;
    }

    this._activeChip = Math.max(0, Math.min(chipIdx, next.els.length - 1));
    next.els[this._activeChip]?.classList.add("context-menu__chip--focus");
    next.els[this._activeChip]?.focus();
  }

  /** Step to the next focusable row, clamping at both ends. */
  private _moveRow(delta: number): void {
    if (this._rows.length === 0) return;
    let idx = this._activeRow;
    if (idx < 0) idx = delta > 0 ? -1 : this._rows.length;
    for (let i = 0; i < this._rows.length; i++) {
      idx += delta;
      if (idx < 0 || idx >= this._rows.length) return;
      if (this._isFocusable(idx)) {
        this._setActive(idx);
        return;
      }
    }
  }

  /** Step within the active chip row. No-op elsewhere. */
  private _moveChip(delta: number): boolean {
    const row = this._rows[this._activeRow];
    if (row?.kind !== "chips") return false;
    const next = Math.max(0, Math.min(this._activeChip + delta, row.els.length - 1));
    this._setActive(this._activeRow, next);
    return true;
  }

  private _activateChip(rowIdx: number, chipIdx: number): void {
    const row = this._rows[rowIdx];
    if (row?.kind !== "chips") return;
    // Chips stay open: formatting is applied more than once per visit.
    row.chips[chipIdx]?.action();
    this._syncChipStates(rowIdx);
    this._setActive(rowIdx, chipIdx);
  }

  private _activate(): void {
    const row = this._rows[this._activeRow];
    if (!row) return;
    if (row.kind === "chips") {
      this._activateChip(this._activeRow, this._activeChip);
      return;
    }
    if (row.item.disabled) return;
    this.hide();
    row.item.action();
  }

  private _handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "j" && !e.ctrlKey)) {
      e.preventDefault();
      this._moveRow(1);
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "k" && !e.ctrlKey)) {
      e.preventDefault();
      this._moveRow(-1);
      return;
    }
    if (e.key === "ArrowRight" || (e.key === "l" && !e.ctrlKey)) {
      if (this._moveChip(1)) e.preventDefault();
      return;
    }
    if (e.key === "ArrowLeft" || (e.key === "h" && !e.ctrlKey)) {
      if (this._moveChip(-1)) e.preventDefault();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (this._activeRow < 0) return;
      e.preventDefault();
      this._activate();
    }
  }
}
