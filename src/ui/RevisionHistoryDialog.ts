// Revision History Dialog — shows all edit revisions for a message

import { keymapManager } from "../vim/keybindings.js";
import { AppState } from "../app/state.js";
import { getMessageRevisions } from "../ipc/timeline.js";
import { DialogBase } from "./DialogBase.js";

export class RevisionHistoryDialog extends DialogBase {
  private _listEl: HTMLElement;

  constructor() {
    // Original used display:"" on show and did not reset the key sequence on
    // hide (it cleared the list instead).
    super({
      prefix: "revision-dialog",
      ariaLabel: "Message revision history",
      showDisplay: "",
      resetSequenceOnHide: false,
    });

    this.buildHeader("── edit history ──", "Close edit history");

    // List
    this._listEl = document.createElement("div");
    this._listEl.className = "revision-dialog__list";
    this.content.appendChild(this._listEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "revision-dialog__footer";
    footer.textContent = "Esc close";
    footer.setAttribute("aria-hidden", "true");
    this.content.appendChild(footer);
  }

  show(eventId: string, originalBody: string): void {
    this._listEl.innerHTML = "";

    // Show original as the first version
    this._renderRevision(originalBody, null, 0);

    const roomId = AppState.get("currentRoomId");
    if (!roomId) return;

    this.reveal();

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

  protected override onHide(): void {
    this._listEl.innerHTML = "";
  }

  // Original handler did not consume partial sequences, so we route the close
  // action explicitly instead of using the base `routeKey`.
  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (this.isEscape(e)) {
      e.preventDefault();
      this.hide();
      return;
    }
    const result = keymapManager.resolveKey(e.key, "picker");
    if (result.kind === "action" && result.action === "close") {
      e.preventDefault();
      this.hide();
    }
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
