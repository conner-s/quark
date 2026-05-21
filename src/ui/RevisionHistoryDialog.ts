// Revision History Dialog — shows all edit revisions for a message

import { keymapManager } from "../vim/keybindings.js";
import { AppState } from "../app/state.js";
import { getMessageRevisions } from "../ipc/timeline.js";
import type { TimelineEvent } from "../ipc/types.js";

export class RevisionHistoryDialog {
  private _el: HTMLElement;
  private _panelEl: HTMLElement;
  private _listEl: HTMLElement;
  private _titleEl: HTMLElement;

  constructor() {
    // Backdrop
    this._el = document.createElement("div");
    this._el.className = "revision-dialog";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Message revision history");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    // Panel
    this._panelEl = document.createElement("div");
    this._panelEl.className = "revision-dialog__panel";
    this._panelEl.setAttribute("tabindex", "-1");
    this._el.appendChild(this._panelEl);

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
      }
    });

    // Header
    const header = document.createElement("div");
    header.className = "revision-dialog__header";

    this._titleEl = document.createElement("span");
    this._titleEl.className = "revision-dialog__title";
    this._titleEl.textContent = "── edit history ──";
    header.appendChild(this._titleEl);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "revision-dialog__close-hint dialog-close-btn";
    closeBtn.textContent = "[× Esc]";
    closeBtn.setAttribute("aria-label", "Close edit history");
    closeBtn.tabIndex = -1;
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);

    this._panelEl.appendChild(header);

    // List
    this._listEl = document.createElement("div");
    this._listEl.className = "revision-dialog__list";
    this._panelEl.appendChild(this._listEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "revision-dialog__footer";
    footer.textContent = "Esc close";
    footer.setAttribute("aria-hidden", "true");
    this._panelEl.appendChild(footer);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  show(eventId: string, originalBody: string): void {
    this._listEl.innerHTML = "";

    // Show original as the first version
    this._renderRevision(originalBody, null, 0);

    const roomId = AppState.get("currentRoomId");
    if (!roomId) return;

    this._el.style.display = "";
    this._panelEl.focus();

    void getMessageRevisions(roomId, eventId).then((revisions) => {
      if (!this.isVisible()) return; // dialog closed while loading
      this._listEl.innerHTML = "";
      this._renderRevision(originalBody, null, 0);
      for (const rev of revisions) {
        this._renderRevision(rev.body, rev.timestamp, revisions.indexOf(rev) + 1);
      }
    }).catch((err) => {
      if (!this.isVisible()) return;
      const errEl = document.createElement("div");
      errEl.className = "revision-dialog__error";
      errEl.textContent = `Failed to load history: ${String(err)}`;
      this._listEl.appendChild(errEl);
    });
  }

  hide(): void {
    this._el.style.display = "none";
    this._listEl.innerHTML = "";
  }

  private _renderRevision(body: string, timestamp: number | null, index: number): void {
    const item = document.createElement("div");
    item.className = "revision-dialog__item";

    const meta = document.createElement("div");
    meta.className = "revision-dialog__meta";

    const label = document.createElement("span");
    label.className = "revision-dialog__version";
    label.textContent = index === 0 ? "original" : `edit ${index}`;
    meta.appendChild(label);

    if (timestamp !== null) {
      const ts = document.createElement("span");
      ts.className = "revision-dialog__timestamp";
      ts.textContent = new Date(timestamp).toLocaleString();
      meta.appendChild(ts);
    }

    item.appendChild(meta);

    const bodyEl = document.createElement("div");
    bodyEl.className = "revision-dialog__body";
    bodyEl.textContent = body;
    item.appendChild(bodyEl);

    this._listEl.appendChild(item);
  }
}
