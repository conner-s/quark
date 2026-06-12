// Room Directory dialog — searchable public room browser

import { keymapManager } from "../vim/keybindings.js";
import { searchRoomDirectory } from "../ipc/rooms.js";
import type { PublicRoomInfo } from "../ipc/types.js";
import { joinRoom } from "../app/actions.js";
import { DialogBase } from "./DialogBase.js";

export class RoomDirectoryDialog extends DialogBase {
  private _searchInput: HTMLInputElement;
  private _listEl: HTMLElement;
  private _items: PublicRoomInfo[] = [];
  private _focusIndex = -1;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({ prefix: "room-dir-dialog", ariaLabel: "Room directory" });

    this.buildHeader("── room directory ──", "Close room directory");

    // Search bar
    this._searchInput = document.createElement("input");
    this._searchInput.type = "text";
    this._searchInput.className = "room-dir-dialog__search";
    this._searchInput.placeholder = "search rooms...";
    this._searchInput.setAttribute("aria-label", "Search public rooms");
    this._searchInput.addEventListener("input", () => this._scheduleSearch());
    this._searchInput.addEventListener("keydown", (e) => {
      // Let the panel keydown handler take these
      if (e.key === "Escape" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") {
        // Don't stop propagation — bubble up to panel keydown
        return;
      }
      e.stopPropagation();
    });
    this.content.appendChild(this._searchInput);

    // List
    this._listEl = document.createElement("div");
    this._listEl.className = "room-dir-dialog__list";
    this.content.appendChild(this._listEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "room-dir-dialog__footer";
    footer.textContent = "j/k or ↑/↓ navigate · Enter join · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this.content.appendChild(footer);
  }

  show(): void {
    this._searchInput.value = "";
    this._focusIndex = -1;
    this._listEl.innerHTML = "";
    void this._doSearch("");
    this.reveal();
  }

  protected override focusTarget(): HTMLElement {
    return this._searchInput;
  }

  protected override onHide(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _scheduleSearch(): void {
    if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      void this._doSearch(this._searchInput.value.trim());
    }, 350);
  }

  private async _doSearch(query: string): Promise<void> {
    this._listEl.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "room-dir-dialog__status";
    loading.textContent = "Searching...";
    this._listEl.appendChild(loading);

    let rooms: PublicRoomInfo[];
    try {
      rooms = await searchRoomDirectory(query || undefined, 50);
    } catch (err) {
      loading.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    this._items = rooms;
    this._focusIndex = rooms.length > 0 ? 0 : -1;
    this._listEl.innerHTML = "";

    if (rooms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "room-dir-dialog__status";
      empty.textContent = "No public rooms found.";
      this._listEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < rooms.length; i++) {
      this._listEl.appendChild(this._makeItem(rooms[i], i));
    }

    this._updateFocus();
  }

  private _makeItem(room: PublicRoomInfo, index: number): HTMLElement {
    const item = document.createElement("div");
    item.className = "room-dir-dialog__item";
    item.setAttribute("data-index", String(index));

    const nameEl = document.createElement("span");
    nameEl.className = "room-dir-dialog__name";
    nameEl.textContent = room.name ?? room.alias ?? room.room_id;
    item.appendChild(nameEl);

    if (room.topic) {
      const topicEl = document.createElement("div");
      topicEl.className = "room-dir-dialog__topic";
      topicEl.textContent = room.topic;
      item.appendChild(topicEl);
    }

    const meta = document.createElement("div");
    meta.className = "room-dir-dialog__meta";
    const parts: string[] = [];
    if (room.member_count !== null && room.member_count !== undefined) {
      parts.push(`${room.member_count} members`);
    }
    if (room.alias) parts.push(room.alias);
    meta.textContent = parts.join(" · ");
    item.appendChild(meta);

    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "room-dir-dialog__join-btn";
    joinBtn.textContent = "[join]";
    joinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this._joinRoom(room.room_id);
    });
    item.appendChild(joinBtn);

    item.addEventListener("click", () => {
      this._focusIndex = index;
      this._updateFocus();
    });

    return item;
  }

  private async _joinRoom(roomId: string): Promise<void> {
    this.hide();
    try {
      await joinRoom(roomId);
    } catch (err) {
      console.error("[RoomDirectory] join failed:", err);
    }
  }

  private _updateFocus(): void {
    const items = this._listEl.querySelectorAll<HTMLElement>(".room-dir-dialog__item");
    items.forEach((el, i) => {
      if (i === this._focusIndex) {
        el.classList.add("room-dir-dialog__item--focused");
        el.scrollIntoView({ block: "nearest" });
      } else {
        el.classList.remove("room-dir-dialog__item--focused");
      }
    });
  }

  private _moveFocus(delta: number): void {
    if (this._items.length === 0) return;
    this._focusIndex = Math.max(0, Math.min(this._focusIndex + delta, this._items.length - 1));
    this._updateFocus();
  }

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    // ArrowUp / ArrowDown always navigate list
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
      if (this._focusIndex >= 0 && this._items[this._focusIndex]) {
        void this._joinRoom(this._items[this._focusIndex].room_id);
      }
      return;
    }

    if (e.ctrlKey && e.key === "[") {
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
          this._focusIndex = this._items.length - 1;
          this._updateFocus();
          break;
      }
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
  }
}
