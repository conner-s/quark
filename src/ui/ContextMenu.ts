// Floating context menu — replaces the browser's native right-click menu
// for app-relevant elements (messages, room icons, etc.)

export interface ContextMenuItem {
  label: string;
  hint?: string;        // optional keyboard shortcut hint shown on the right
  separator?: false;
  action: () => void;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export class ContextMenu {
  private _el: HTMLElement;
  private _visible = false;
  private _activeIndex = -1;
  private _items: ContextMenuItem[] = [];

  // Close when the user clicks anywhere outside the menu
  private _outsideHandler = (e: MouseEvent) => {
    if (!this._el.contains(e.target as Node)) this.hide();
  };

  // Close on scroll (menu position would be stale)
  private _scrollHandler = () => this.hide();

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "context-menu";
    this._el.setAttribute("role", "menu");
    this._el.style.display = "none";
    document.body.appendChild(this._el);

    this._el.addEventListener("keydown", (e) => this._handleKey(e));
  }

  show(x: number, y: number, entries: ContextMenuEntry[]): void {
    this._el.innerHTML = "";
    this._items = [];
    this._activeIndex = -1;

    for (const entry of entries) {
      if ("separator" in entry && entry.separator) {
        const sep = document.createElement("div");
        sep.className = "context-menu__separator";
        sep.setAttribute("role", "separator");
        this._el.appendChild(sep);
        continue;
      }

      const item = entry as ContextMenuItem;
      const idx = this._items.length;
      this._items.push(item);

      const row = document.createElement("div");
      row.className = "context-menu__item";
      row.setAttribute("role", "menuitem");
      row.setAttribute("tabindex", "-1");

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

      row.addEventListener("mouseenter", () => this._setActive(idx));
      row.addEventListener("click", () => {
        this.hide();
        item.action();
      });

      this._el.appendChild(row);
    }

    this._el.style.display = "block";
    this._visible = true;

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

    this._el.focus();

    // Defer outside-click registration so the triggering mousedown doesn't
    // immediately close the menu.
    setTimeout(() => {
      document.addEventListener("mousedown", this._outsideHandler, { capture: true });
      document.addEventListener("scroll", this._scrollHandler, { capture: true, passive: true });
    }, 0);
  }

  hide(): void {
    if (!this._visible) return;
    this._el.style.display = "none";
    this._visible = false;
    this._activeIndex = -1;
    document.removeEventListener("mousedown", this._outsideHandler, { capture: true });
    document.removeEventListener("scroll", this._scrollHandler, { capture: true });
  }

  isVisible(): boolean {
    return this._visible;
  }

  private _setActive(idx: number): void {
    const rows = this._el.querySelectorAll<HTMLElement>(".context-menu__item");
    rows[this._activeIndex]?.classList.remove("context-menu__item--active");
    this._activeIndex = idx;
    rows[idx]?.classList.add("context-menu__item--active");
    rows[idx]?.focus();
  }

  private _handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "j" && !e.ctrlKey)) {
      e.preventDefault();
      this._setActive(Math.min(this._activeIndex + 1, this._items.length - 1));
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "k" && !e.ctrlKey)) {
      e.preventDefault();
      this._setActive(Math.max(this._activeIndex - 1, 0));
      return;
    }
    if (e.key === "Enter" && this._activeIndex >= 0) {
      e.preventDefault();
      const item = this._items[this._activeIndex];
      this.hide();
      item.action();
    }
  }
}
