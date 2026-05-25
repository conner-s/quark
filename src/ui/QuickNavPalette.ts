// Quick navigation palette — Ctrl+K room switcher

import { AppState } from "../app/state.js";
import type { RoomInfo } from "../ipc/types.js";
import { PickerBase, SelectionList } from "./PickerBase.js";

type SelectCallback = (roomId: string) => void;

export class QuickNavPalette extends PickerBase {
  private _panelEl: HTMLElement;
  private _searchInput: HTMLInputElement;
  private _listEl: HTMLElement;

  private _allRooms: RoomInfo[] = [];
  private _filtered: RoomInfo[] = [];
  private _list: SelectionList;
  private _onSelect: SelectCallback | null = null;

  constructor() {
    super({
      className: "quick-nav-palette",
      ariaLabel: "Quick navigation",
      displayValue: "flex",
    });

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
      // Let the panel handler take navigation/selection keys. Tab is included
      // so you can dive from the search box into the list without reaching for
      // the arrow keys (mirrors the emoji picker's Tab-into-grid).
      if (
        e.key === "Escape" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Enter" ||
        e.key === "Tab"
      ) {
        return;
      }
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

    // Single-column list; highlight via CSS class + scrollIntoView.
    this._list = new SelectionList({
      columns: 1,
      highlight: { kind: "class", activeClass: "quick-nav-palette__item--focused" },
      getItems: () =>
        Array.from(this._listEl.querySelectorAll<HTMLElement>(".quick-nav-palette__item")),
      onSelect: (i) => this._select(i),
      onFocusChange: (i) => {
        const items = this._listEl.querySelectorAll<HTMLElement>(".quick-nav-palette__item");
        items[i]?.scrollIntoView({ block: "nearest" });
      },
    });

    // Keyboard handler on backdrop
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  onSelect(cb: SelectCallback): void { this._onSelect = cb; }

  show(): void {
    this._allRooms = AppState.get("roomListCache");
    this._searchInput.value = "";
    this.reveal();
    this._filter();
    this._searchInput.focus();
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

    this._render();
    this._list.setFocus(0);
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

    this._list.refresh();
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
      if (this._list.focusIndex !== index) {
        this._list.setFocus(index);
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

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    // Escape closes (overlay-specific; also resolves via keymap "close").
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      return;
    }

    // Tab / Shift-Tab step through the list, so the search box and the results
    // are reachable from the keyboard home row (Tab isn't a remappable action).
    if (e.key === "Tab") {
      e.preventDefault();
      this._list.dispatch(e.shiftKey ? "nav-up" : "nav-down");
      return;
    }

    // Navigation + select route through the keymap (honours rebindings).
    const result = this._list.handleKey(e.key);
    if (result.partial) {
      e.preventDefault();
      return;
    }
    if (result.consumed) {
      e.preventDefault();
    }
  }
}
