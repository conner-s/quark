// Quick navigation palette — Ctrl+K room switcher

import { keymapManager } from "../vim/keybindings.js";
import { AppState } from "../app/state.js";
import type { RoomInfo } from "../ipc/types.js";

type SelectCallback = (roomId: string) => void;

export class QuickNavPalette {
  private _el: HTMLElement;
  private _panelEl: HTMLElement;
  private _searchInput: HTMLInputElement;
  private _listEl: HTMLElement;

  private _allRooms: RoomInfo[] = [];
  private _filtered: RoomInfo[] = [];
  private _focusIndex = 0;
  private _onSelect: SelectCallback | null = null;

  constructor() {
    // Backdrop
    this._el = document.createElement("div");
    this._el.className = "quick-nav-palette";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Quick navigation");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    // Panel
    this._panelEl = document.createElement("div");
    this._panelEl.className = "quick-nav-palette__panel";
    this._el.appendChild(this._panelEl);

    // Search input
    this._searchInput = document.createElement("input");
    this._searchInput.type = "text";
    this._searchInput.className = "quick-nav-palette__search";
    this._searchInput.placeholder = "jump to room...";
    this._searchInput.setAttribute("aria-label", "Filter rooms");
    this._searchInput.setAttribute("autocomplete", "off");
    this._searchInput.setAttribute("spellcheck", "false");

    this._searchInput.addEventListener("input", () => this._filter());
    this._searchInput.addEventListener("keydown", (e) => {
      // Let panel handler take navigation keys
      if (e.key === "Escape" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") return;
      e.stopPropagation();
    });

    this._panelEl.appendChild(this._searchInput);

    // Results list
    this._listEl = document.createElement("div");
    this._listEl.className = "quick-nav-palette__list";
    this._panelEl.appendChild(this._listEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "quick-nav-palette__footer";
    footer.textContent = "↑/↓ navigate · Enter open · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this._panelEl.appendChild(footer);

    // Keyboard handler on backdrop
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement { return this._el; }

  isVisible(): boolean { return this._el.style.display !== "none"; }

  onSelect(cb: SelectCallback): void { this._onSelect = cb; }

  show(): void {
    this._allRooms = AppState.get("roomListCache");
    this._searchInput.value = "";
    this._el.style.display = "flex";
    this._filter();
    this._searchInput.focus();
  }

  hide(): void {
    this._el.style.display = "none";
    keymapManager.resetSequence();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _filter(): void {
    const query = this._searchInput.value.toLowerCase().trim();

    if (query === "") {
      this._filtered = [...this._allRooms];
    } else {
      this._filtered = this._allRooms.filter((r) => {
        const name = (r.name ?? "").toLowerCase();
        const id = r.room_id.toLowerCase();
        return name.includes(query) || id.includes(query);
      });
    }

    this._focusIndex = 0;
    this._render();
  }

  private _render(): void {
    this._listEl.innerHTML = "";

    if (this._filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "quick-nav-palette__empty";
      empty.textContent = "No rooms match.";
      this._listEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < this._filtered.length; i++) {
      this._listEl.appendChild(this._makeItem(this._filtered[i], i));
    }

    this._updateFocus();
  }

  private _makeItem(room: RoomInfo, index: number): HTMLElement {
    const item = document.createElement("div");
    item.className = "quick-nav-palette__item";
    item.setAttribute("data-index", String(index));

    const name = document.createElement("span");
    name.className = "quick-nav-palette__name";
    name.textContent = room.name ?? room.room_id;
    item.appendChild(name);

    if (room.name) {
      const idEl = document.createElement("span");
      idEl.className = "quick-nav-palette__alias";
      idEl.textContent = room.room_id;
      item.appendChild(idEl);
    }

    item.addEventListener("click", () => {
      this._select(index);
    });

    item.addEventListener("mousemove", () => {
      if (this._focusIndex !== index) {
        this._focusIndex = index;
        this._updateFocus();
      }
    });

    return item;
  }

  private _select(index: number): void {
    const room = this._filtered[index];
    if (!room) return;
    this.hide();
    this._onSelect?.(room.room_id);
  }

  private _moveFocus(delta: number): void {
    if (this._filtered.length === 0) return;
    this._focusIndex = Math.max(0, Math.min(this._focusIndex + delta, this._filtered.length - 1));
    this._updateFocus();
  }

  private _updateFocus(): void {
    const items = this._listEl.querySelectorAll<HTMLElement>(".quick-nav-palette__item");
    items.forEach((el, i) => {
      el.classList.toggle("quick-nav-palette__item--focused", i === this._focusIndex);
      if (i === this._focusIndex) el.scrollIntoView({ block: "nearest" });
    });
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.key === "ArrowDown") {
      e.preventDefault();
      this._moveFocus(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this._moveFocus(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this._select(this._focusIndex);
      return;
    }
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      return;
    }

    const result = keymapManager.resolveKey(e.key, "picker");
    if (result.kind === "action") {
      switch (result.action) {
        case "close":
          e.preventDefault();
          this.hide();
          break;
        case "nav-down":
          e.preventDefault();
          this._moveFocus(1);
          break;
        case "nav-up":
          e.preventDefault();
          this._moveFocus(-1);
          break;
        case "jump-top":
          e.preventDefault();
          this._focusIndex = 0;
          this._updateFocus();
          break;
        case "jump-bottom":
          e.preventDefault();
          this._focusIndex = this._filtered.length - 1;
          this._updateFocus();
          break;
      }
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
  }
}
