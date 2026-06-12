// Pinned Messages dialog — shows pinned events for the current room

import { AppState } from "../app/state.js";
import { getPinnedEvents } from "../ipc/rooms.js";
import type { PinnedEventInfo } from "../ipc/types.js";
import { DialogBase } from "./DialogBase.js";

export class PinnedMessagesDialog extends DialogBase {
  private _listEl: HTMLElement;
  private _onJumpToMessage: ((eventId: string) => void) | null = null;

  constructor() {
    super({ prefix: "pinned-dialog", ariaLabel: "Pinned messages" });

    this.buildHeader("── pinned messages ──", "Close pinned messages");

    // List
    this._listEl = document.createElement("div");
    this._listEl.className = "pinned-dialog__list";
    this.content.appendChild(this._listEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "pinned-dialog__footer";
    footer.textContent = "Esc close";
    footer.setAttribute("aria-hidden", "true");
    this.content.appendChild(footer);
  }

  /** Register a callback for when the user clicks a pinned message to jump to it. */
  onJumpToMessage(handler: (eventId: string) => void): void {
    this._onJumpToMessage = handler;
  }

  async show(): Promise<void> {
    const roomId = AppState.get("currentRoomId");

    this._listEl.innerHTML = "";

    const loading = document.createElement("div");
    loading.className = "pinned-dialog__item";
    loading.textContent = "Loading...";
    this._listEl.appendChild(loading);

    this.reveal();

    if (!roomId) {
      loading.textContent = "No room selected.";
      return;
    }

    let events: PinnedEventInfo[];
    try {
      events = await getPinnedEvents(roomId);
    } catch (err) {
      loading.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    this._listEl.innerHTML = "";

    if (events.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pinned-dialog__item pinned-dialog__item--empty";
      empty.textContent = "No pinned messages.";
      this._listEl.appendChild(empty);
      return;
    }

    for (const ev of events) {
      const item = document.createElement("div");
      item.className = "pinned-dialog__item";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.title = "Click to jump to message";
      item.dataset.eventId = ev.event_id;

      const senderEl = document.createElement("span");
      senderEl.className = "pinned-dialog__sender";
      senderEl.textContent = ev.sender;
      item.appendChild(senderEl);

      const tsEl = document.createElement("span");
      tsEl.className = "pinned-dialog__ts";
      const date = new Date(ev.timestamp);
      tsEl.textContent = date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      item.appendChild(tsEl);

      const bodyEl = document.createElement("div");
      bodyEl.className = "pinned-dialog__body";
      if (ev.encrypted) bodyEl.classList.add("pinned-dialog__body--utd");
      bodyEl.textContent = ev.body;
      item.appendChild(bodyEl);

      const jumpTo = () => {
        if (ev.event_id && this._onJumpToMessage) {
          this.hide();
          this._onJumpToMessage(ev.event_id);
        }
      };
      item.addEventListener("click", jumpTo);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jumpTo(); }
      });

      this._listEl.appendChild(item);
    }
  }
}
