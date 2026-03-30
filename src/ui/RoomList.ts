// Room list panel

export interface RoomEntry {
  id: string;
  name: string;
  unreadCount?: number;
  mentionCount?: number;
  muted?: boolean;
}

export class RoomList {
  private _el: HTMLElement;
  private _scrollEl: HTMLElement;
  private _rooms: RoomEntry[] = [];
  private _activeId: string | null = null;
  private _onSelect: ((id: string) => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "room-list";

    const header = document.createElement("div");
    header.className = "room-list__header";
    header.textContent = "Rooms";
    this._el.appendChild(header);

    this._scrollEl = document.createElement("div");
    this._scrollEl.className = "room-list__scroll";
    this._scrollEl.setAttribute("role", "listbox");
    this._scrollEl.setAttribute("aria-label", "Room list");
    this._el.appendChild(this._scrollEl);

    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onSelect(handler: (id: string) => void): void {
    this._onSelect = handler;
  }

  setRooms(rooms: RoomEntry[]): void {
    this._rooms = rooms;
    this._render();
  }

  setActiveRoom(id: string): void {
    this._activeId = id;
    this._updateActive();
  }

  /**
   * Update a single room's unread/mention badge without re-rendering the whole list.
   * Used to clear badges after marking a room as read without losing the current
   * space filter (which would happen if setRooms were called with the full cache).
   */
  updateRoomBadge(id: string, unreadCount: number, mentionCount: number): void {
    const idx = this._rooms.findIndex((r) => r.id === id);
    if (idx < 0) return;
    this._rooms[idx] = { ...this._rooms[idx], unreadCount, mentionCount };

    const el = this._scrollEl.querySelector<HTMLElement>(`[data-room-id="${CSS.escape(id)}"]`);
    if (!el) return;

    el.classList.toggle("room-list__item--unread", unreadCount > 0 && !this._rooms[idx].muted);
    el.querySelector(".room-list__item-badge")?.remove();

    if (mentionCount > 0) {
      const badge = document.createElement("span");
      badge.className = "room-list__item-badge";
      badge.textContent = String(mentionCount);
      badge.setAttribute("aria-label", `${mentionCount} mentions`);
      el.appendChild(badge);
    } else if (unreadCount > 0 && !this._rooms[idx].muted) {
      const badge = document.createElement("span");
      badge.className = "room-list__item-badge";
      badge.style.color = "var(--roomlist-unread)";
      badge.textContent = "●";
      badge.setAttribute("aria-label", `${unreadCount} unread`);
      el.appendChild(badge);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _render(): void {
    this._scrollEl.innerHTML = "";

    for (const room of this._rooms) {
      this._scrollEl.appendChild(this._createItem(room));
    }

    this._updateActive();
  }

  private _createItem(room: RoomEntry): HTMLElement {
    const el = document.createElement("div");
    el.className = "room-list__item";
    el.setAttribute("role", "option");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", room.name);
    el.dataset.roomId = room.id;

    if (room.muted) {
      el.classList.add("room-list__item--muted");
    } else if (room.unreadCount && room.unreadCount > 0) {
      el.classList.add("room-list__item--unread");
    }

    const nameEl = document.createElement("span");
    nameEl.className = "room-list__item-name";
    nameEl.textContent = room.name;
    el.appendChild(nameEl);

    if (room.mentionCount && room.mentionCount > 0) {
      const badge = document.createElement("span");
      badge.className = "room-list__item-badge";
      badge.textContent = String(room.mentionCount);
      badge.setAttribute("aria-label", `${room.mentionCount} mentions`);
      el.appendChild(badge);
    } else if (room.unreadCount && room.unreadCount > 0 && !room.muted) {
      const badge = document.createElement("span");
      badge.className = "room-list__item-badge";
      badge.style.color = "var(--roomlist-unread)";
      badge.textContent = "●";
      badge.setAttribute("aria-label", `${room.unreadCount} unread`);
      el.appendChild(badge);
    }

    el.addEventListener("click", () => this._selectId(room.id));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._selectId(room.id);
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
    for (const el of this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item")) {
      const isActive = el.dataset.roomId === this._activeId;
      el.classList.toggle("room-list__item--active", isActive);
      el.setAttribute("aria-selected", String(isActive));
    }
  }

  navDown(): void {
    const items = Array.from(
      this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item")
    );
    const focused = document.activeElement as HTMLElement;
    const currentIndex = items.indexOf(focused);
    const next = items[currentIndex + 1] ?? items[0];
    next?.focus();
  }

  navUp(): void {
    const items = Array.from(
      this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item")
    );
    const focused = document.activeElement as HTMLElement;
    const currentIndex = items.indexOf(focused);
    const prev = currentIndex <= 0 ? items[items.length - 1] : items[currentIndex - 1];
    prev?.focus();
  }

  selectFocused(): void {
    const focused = document.activeElement as HTMLElement;
    const id = focused?.dataset.roomId;
    if (id) this._selectId(id);
  }

  navFirst(): void {
    this._scrollEl.querySelector<HTMLElement>(".room-list__item")?.focus();
  }

  navLast(): void {
    const items = this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item");
    items[items.length - 1]?.focus();
  }

  focusActive(): void {
    const active = this._scrollEl.querySelector<HTMLElement>(".room-list__item--active");
    const first = this._scrollEl.querySelector<HTMLElement>(".room-list__item");
    (active ?? first)?.focus();
  }

  private _handleKeydown(e: KeyboardEvent): void {
    const items = Array.from(
      this._scrollEl.querySelectorAll<HTMLElement>(".room-list__item")
    );
    const focused = document.activeElement as HTMLElement;
    const currentIndex = items.indexOf(focused);

    if (e.key === "Enter" && currentIndex >= 0) {
      e.preventDefault();
      const room = this._rooms[currentIndex];
      if (room) this._selectId(room.id);
    }
  }
}
