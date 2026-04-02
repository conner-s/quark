// Room Info dialog — shows details of the current room

import { keymapManager } from "../vim/keybindings.js";
import { AppState } from "../app/state.js";
import { muteRoom, unmuteRoom, getConfig } from "../app/notifications.js";
import type { RoomInfo } from "../ipc/types.js";

export class RoomInfoDialog {
  private _el: HTMLElement;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "room-info-dialog";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Room info");
    this._el.setAttribute("aria-modal", "true");
    this._el.setAttribute("tabindex", "-1");
    this._el.style.display = "none";

    // Click outside to close
    document.addEventListener("mousedown", (e) => {
      if (this.isVisible() && !this._el.contains(e.target as Node)) {
        this.hide();
      }
    });

    // Keyboard
    this._el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        e.preventDefault();
        this.hide();
        return;
      }
      const result = keymapManager.resolveKey(e.key, "picker");
      if (result.kind === "action" && result.action === "close") {
        e.preventDefault();
        this.hide();
      } else if (result.kind === "partial") {
        e.preventDefault();
      }
    });
  }

  getElement(): HTMLElement { return this._el; }

  isVisible(): boolean { return this._el.style.display !== "none"; }

  async show(): Promise<void> {
    const state = AppState.snapshot;
    const roomId = state.currentRoomId;

    this._el.innerHTML = "";

    if (!roomId) {
      this._buildError("No room selected.");
      this._el.style.display = "flex";
      this._el.focus();
      return;
    }

    const room: RoomInfo | undefined = state.roomListCache.find((r) => r.room_id === roomId);

    // Header
    const header = document.createElement("div");
    header.className = "room-info-dialog__header";
    const titleEl = document.createElement("span");
    titleEl.className = "room-info-dialog__title";
    titleEl.textContent = "── room info ──";
    header.appendChild(titleEl);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "room-info-dialog__close";
    closeBtn.textContent = "[x]";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.setAttribute("tabindex", "-1");
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    this._el.appendChild(header);

    // Info body
    const body = document.createElement("div");
    body.className = "room-info-dialog__body";

    const addRow = (label: string, value: string, muted = false): void => {
      const row = document.createElement("div");
      row.className = "room-info-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "room-info-dialog__label";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.className = "room-info-dialog__value" + (muted ? " room-info-dialog__value--muted" : "");
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      body.appendChild(row);
    };

    addRow("name", room?.name ?? "(unknown)");
    addRow("topic", room?.topic ?? "(none)");
    addRow("members", String(room?.member_count ?? "?"));
    addRow("encrypted", room?.is_encrypted ? "yes" : "no");
    addRow("direct", room?.is_direct ? "yes" : "no");
    addRow("room id", roomId, true);

    this._el.appendChild(body);

    // Actions
    const actions = document.createElement("div");
    actions.className = "room-info-dialog__actions";

    // Mute toggle
    let config = await getConfig().catch(() => null);
    const isMuted = config?.mute_rooms.includes(roomId) ?? false;

    const muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.className = "room-info-dialog__btn" + (isMuted ? " room-info-dialog__btn--muted" : "");
    muteBtn.textContent = isMuted ? "[unmute]" : "[mute]";
    muteBtn.addEventListener("click", async () => {
      try {
        if (isMuted) {
          await unmuteRoom(roomId);
        } else {
          await muteRoom(roomId);
        }
        this.hide();
      } catch {
        muteBtn.textContent = "[error]";
      }
    });
    actions.appendChild(muteBtn);

    // Leave button — fires the leave-room action via custom event
    const leaveBtn = document.createElement("button");
    leaveBtn.type = "button";
    leaveBtn.className = "room-info-dialog__btn room-info-dialog__btn--danger";
    leaveBtn.textContent = "[leave room]";
    leaveBtn.addEventListener("click", () => {
      this.hide();
      document.dispatchEvent(new CustomEvent("quark:action", { detail: { action: "leave-room-confirm" } }));
    });
    actions.appendChild(leaveBtn);

    // Close button
    const closeBtnAction = document.createElement("button");
    closeBtnAction.type = "button";
    closeBtnAction.className = "room-info-dialog__btn";
    closeBtnAction.textContent = "[close]";
    closeBtnAction.addEventListener("click", () => this.hide());
    actions.appendChild(closeBtnAction);

    this._el.appendChild(actions);

    // Hint
    const hint = document.createElement("div");
    hint.className = "room-info-dialog__hint";
    hint.textContent = "Esc: close";
    this._el.appendChild(hint);

    this._el.style.display = "flex";
    this._el.focus();
  }

  hide(): void {
    this._el.style.display = "none";
    keymapManager.resetSequence();
  }

  private _buildError(msg: string): void {
    const err = document.createElement("div");
    err.style.padding = "16px";
    err.textContent = msg;
    this._el.appendChild(err);
  }
}
