// Debug Viewer — shows raw JSON for events, rooms, and profiles.
// Opened via :debug command, or by the [raw] button in RoomInfoDialog / ProfileDialog.

import { keymapManager } from "../vim/keybindings.js";
import { AppState } from "../app/state.js";
import { getRoomStateEvents, getRawEvent } from "../ipc/room_settings.js";
import type { RawStateEvent } from "../ipc/room_settings.js";

export type DebugSubject =
  | { kind: "room"; roomId: string }
  | { kind: "event"; roomId: string; eventId: string }
  | { kind: "profile"; userId: string; data: object };

export class DebugViewer {
  private _el: HTMLElement;
  private _panelEl: HTMLElement;
  private _titleEl: HTMLElement;
  private _bodyEl: HTMLElement;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "debug-viewer";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Debug Viewer");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    this._panelEl = document.createElement("div");
    this._panelEl.className = "debug-viewer__panel";
    this._panelEl.tabIndex = -1;
    this._el.appendChild(this._panelEl);

    // Header
    const header = document.createElement("div");
    header.className = "debug-viewer__header";

    this._titleEl = document.createElement("span");
    this._titleEl.className = "debug-viewer__title";
    this._titleEl.textContent = "── debug viewer ──";
    header.appendChild(this._titleEl);

    const closeHint = document.createElement("span");
    closeHint.className = "debug-viewer__close-hint";
    closeHint.textContent = "Esc · q";
    closeHint.setAttribute("aria-hidden", "true");
    header.appendChild(closeHint);

    this._panelEl.appendChild(header);

    // Toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "debug-viewer__toolbar";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "debug-viewer__toolbar-btn";
    copyBtn.textContent = "[copy]";
    copyBtn.addEventListener("click", async () => {
      const text = this._bodyEl.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "[copied!]";
        setTimeout(() => { copyBtn.textContent = "[copy]"; }, 1500);
      } catch {
        copyBtn.textContent = "[copy failed]";
        setTimeout(() => { copyBtn.textContent = "[copy]"; }, 1500);
      }
    });
    toolbar.appendChild(copyBtn);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "debug-viewer__toolbar-btn";
    closeBtn.textContent = "[close]";
    closeBtn.addEventListener("click", () => this.hide());
    toolbar.appendChild(closeBtn);

    this._panelEl.appendChild(toolbar);

    // Body
    this._bodyEl = document.createElement("pre");
    this._bodyEl.className = "debug-viewer__body";
    this._panelEl.appendChild(this._bodyEl);

    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement { return this._el; }
  isVisible(): boolean { return this._el.style.display !== "none"; }

  /** Show the viewer for the current room's state events. */
  async showCurrentRoom(): Promise<void> {
    const roomId = AppState.snapshot.currentRoomId;
    if (!roomId) {
      this._show("── debug: no room ──", "(no room selected)");
      return;
    }
    await this.show({ kind: "room", roomId });
  }

  /** Show the viewer for a specific subject. */
  async show(subject: DebugSubject): Promise<void> {
    this._el.style.display = "flex";
    this._bodyEl.textContent = "Loading…";

    switch (subject.kind) {
      case "room": {
        this._titleEl.textContent = `── debug: room state ──`;
        try {
          const events = await getRoomStateEvents(subject.roomId);
          this._titleEl.textContent = `── debug: room ${subject.roomId} (${events.length} state events) ──`;
          this._bodyEl.textContent = this._formatStateEvents(events);
        } catch (err) {
          this._bodyEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        break;
      }

      case "event": {
        this._titleEl.textContent = `── debug: event ${subject.eventId} ──`;
        try {
          const json = await getRawEvent(subject.roomId, subject.eventId);
          this._bodyEl.textContent = json;
        } catch (err) {
          this._bodyEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        break;
      }

      case "profile": {
        this._titleEl.textContent = `── debug: profile ${subject.userId} ──`;
        this._bodyEl.textContent = JSON.stringify(subject.data, null, 2);
        break;
      }
    }

    this._panelEl.focus();
  }

  hide(): void {
    this._el.style.display = "none";
    keymapManager.resetSequence();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _show(title: string, body: string): void {
    this._el.style.display = "flex";
    this._titleEl.textContent = title;
    this._bodyEl.textContent = body;
    this._panelEl.focus();
  }

  private _formatStateEvents(events: RawStateEvent[]): string {
    const lines: string[] = [];
    for (const ev of events) {
      lines.push(`// ${ev.event_type} — state_key: ${JSON.stringify(ev.state_key)} — sender: ${ev.sender}`);
      if (ev.event_id) lines.push(`// event_id: ${ev.event_id}`);
      if (ev.origin_server_ts) {
        lines.push(`// ts: ${new Date(ev.origin_server_ts).toISOString()}`);
      }
      lines.push(ev.content_json);
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      return;
    }

    if (e.key === "q" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const active = document.activeElement;
      const isInInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (!isInInput) {
        e.preventDefault();
        this.hide();
        return;
      }
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
