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

    // Keyboard navigation
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
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

  private _handleKeydown(e: KeyboardEvent): void {
    const items = Array.from(
      this._el.querySelectorAll<HTMLElement>(".space-strip__item")
    );
    const focused = document.activeElement as HTMLElement;
    const currentIndex = items.indexOf(focused);

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = items[currentIndex + 1];
      next?.focus();
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = items[currentIndex - 1];
      prev?.focus();
    }
  }
}
