// Pinned Messages dialog — shows pinned events for the current room

import { keymapManager } from "../vim/keybindings.js";
import { AppState } from "../app/state.js";
import { getPinnedEvents } from "../ipc/rooms.js";
import type { PinnedEventInfo } from "../ipc/types.js";

export class PinnedMessagesDialog {
  private _el: HTMLElement;
  private _panelEl: HTMLElement;
  private _listEl: HTMLElement;
  private _onJumpToMessage: ((eventId: string) => void) | null = null;

  constructor() {
    // Backdrop
    this._el = document.createElement("div");
    this._el.className = "pinned-dialog";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Pinned messages");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    // Panel
    this._panelEl = document.createElement("div");
    this._panelEl.className = "pinned-dialog__panel";
    this._panelEl.setAttribute("tabindex", "-1");
    this._el.appendChild(this._panelEl);

    // Header
    const header = document.createElement("div");
    header.className = "pinned-dialog__header";

    const title = document.createElement("span");
    title.className = "pinned-dialog__title";
    title.textContent = "── pinned messages ──";
    header.appendChild(title);

    const closeHint = document.createElement("span");
    closeHint.className = "pinned-dialog__close-hint";
    closeHint.textContent = "Esc";
    closeHint.setAttribute("aria-hidden", "true");
    header.appendChild(closeHint);

    this._panelEl.appendChild(header);

    // List
    this._listEl = document.createElement("div");
    this._listEl.className = "pinned-dialog__list";
    this._panelEl.appendChild(this._listEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "pinned-dialog__footer";
    footer.textContent = "Esc close";
    footer.setAttribute("aria-hidden", "true");
    this._panelEl.appendChild(footer);

    // Keyboard
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement { return this._el; }

  isVisible(): boolean { return this._el.style.display !== "none"; }

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

    this._el.style.display = "flex";
    this._panelEl.focus();

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

  hide(): void {
    this._el.style.display = "none";
    keymapManager.resetSequence();
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.ctrlKey && e.key === "[") {
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
  }
}
