// Space selector strip — narrow vertical column of space icons

export interface SpaceItem {
  id: string;
  /** Display label (first letter of name used as fallback icon) */
  name: string;
  /** Optional avatar URL */
  avatarUrl?: string;
}

export class SpaceStrip {
  private _el: HTMLElement;
  private _items: SpaceItem[] = [];
  private _activeId: string | null = null;
  private _onSelect: ((id: string) => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "space-strip";
    this._el.setAttribute("role", "listbox");
    this._el.setAttribute("aria-label", "Spaces");

  }

  getElement(): HTMLElement {
    return this._el;
  }

  onSelect(handler: (id: string) => void): void {
    this._onSelect = handler;
  }

  setSpaces(items: SpaceItem[]): void {
    this._items = items;
    this._render();
  }

  setActiveSpace(id: string): void {
    this._activeId = id;
    this._updateActive();
  }

  focusActive(): void {
    const active = this._el.querySelector<HTMLElement>(".space-strip__item--active");
    const first = this._el.querySelector<HTMLElement>(".space-strip__item");
    (active ?? first)?.focus();
  }

  navDown(): void {
    const items = Array.from(this._el.querySelectorAll<HTMLElement>(".space-strip__item"));
    const focused = document.activeElement as HTMLElement;
    const idx = items.indexOf(focused);
    const next = items[idx + 1] ?? items[0];
    next?.focus();
  }

  navUp(): void {
    const items = Array.from(this._el.querySelectorAll<HTMLElement>(".space-strip__item"));
    const focused = document.activeElement as HTMLElement;
    const idx = items.indexOf(focused);
    const prev = idx <= 0 ? items[items.length - 1] : items[idx - 1];
    prev?.focus();
  }

  selectFocused(): void {
    const focused = document.activeElement as HTMLElement;
    const id = focused?.dataset.spaceId;
    if (id) this._selectId(id);
  }

  navFirst(): void {
    this._el.querySelector<HTMLElement>(".space-strip__item")?.focus();
  }

  navLast(): void {
    const items = this._el.querySelectorAll<HTMLElement>(".space-strip__item");
    items[items.length - 1]?.focus();
  }

  /** Swap in a resolved avatar data URL for a space item. */
  updateSpaceAvatar(spaceId: string, dataUrl: string): void {
    const item = this._el.querySelector<HTMLElement>(`[data-space-id="${CSS.escape(spaceId)}"]`);
    if (!item) return;
    // Replace existing img or text with the resolved image
    const existing = item.querySelector("img");
    if (existing) {
      existing.src = dataUrl;
    } else {
      item.textContent = "";
      const img = document.createElement("img");
	  img.className = "space-strip__icon";
      img.src = dataUrl;
      img.alt = "";
      item.appendChild(img);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _render(): void {
    this._el.innerHTML = "";

    // Home item always at top
    this._el.appendChild(this._createItem({ id: "__home__", name: "Home" }, "⌂"));

    if (this._items.length > 0) {
      const divider = document.createElement("div");
      divider.className = "space-strip__divider";
      divider.setAttribute("role", "separator");
      this._el.appendChild(divider);
    }

    for (const item of this._items) {
      this._el.appendChild(this._createItem(item));
    }

    // DMs always after spaces
    if (this._items.length > 0) {
      const divider = document.createElement("div");
      divider.className = "space-strip__divider";
      divider.setAttribute("role", "separator");
      this._el.appendChild(divider);
    }

    this._el.appendChild(this._createItem({ id: "__dms__", name: "Direct Messages" }, "✉"));
    this._updateActive();
  }

  private _createItem(item: SpaceItem, overrideLabel?: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "space-strip__item";
    el.setAttribute("role", "option");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", item.name);
    el.dataset.spaceId = item.id;

    if (item.avatarUrl) {
      const img = document.createElement("img");
      img.src = item.avatarUrl;
      img.alt = item.name;
      img.style.width = "20px";
      img.style.height = "20px";
      img.style.objectFit = "cover";
      el.appendChild(img);
    } else {
      el.textContent = overrideLabel ?? item.name.charAt(0).toUpperCase();
    }

    el.addEventListener("click", () => this._selectId(item.id));
    el.addEventListener("focus", () => {
      // Dispatch a focusspace event so keyboard.ts can update activePanel
      this._el.dispatchEvent(new CustomEvent("quark:space-focused", { bubbles: true }));
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._selectId(item.id);
      }
    });

    return el;
  }

  private _selectId(id: string): void {
    this._activeId = id;
    this._updateActive();
    this._onSelect?.(id);
  }

  private _updateActive(): void {
    for (const el of this._el.querySelectorAll<HTMLElement>(".space-strip__item")) {
      const isActive = el.dataset.spaceId === this._activeId;
      el.classList.toggle("space-strip__item--active", isActive);
      el.setAttribute("aria-selected", String(isActive));
    }
  }

  // Navigation (j/k/arrows) is handled by the global keymap via AppState.navDown/navUp.
  // Enter/Space activation is handled by individual item listeners in _createItem.
}
