// Debug Viewer — shows raw JSON for events, rooms, and profiles.
// Opened via :debug command, or by the [raw] button in RoomInfoDialog / ProfileDialog.

import { keymapManager } from "../vim/keybindings.js";
import { AppState } from "../app/state.js";
import { getRoomStateEvents, getRawEvent } from "../ipc/room_settings.js";
import type { RawStateEvent } from "../ipc/room_settings.js";
import { getEventCacheDiagnostics, getRoomCacheDiagnostics } from "../ipc/media.js";
import { DialogBase } from "./DialogBase.js";

export type DebugSubject =
  | { kind: "room"; roomId: string }
  | { kind: "event"; roomId: string; eventId: string }
  | { kind: "profile"; userId: string; data: object }
  | { kind: "cache" };

export class DebugViewer extends DialogBase {
  private _panelEl: HTMLElement;
  private _titleEl: HTMLElement;
  private _bodyEl: HTMLElement;

  constructor() {
    super({ prefix: "debug-viewer", ariaLabel: "Debug Viewer" });
    this._panelEl = this.content;

    // Header — standard chrome (title + [× Esc] close button).
    this.buildHeader("── debug viewer ──", "Close debug viewer");
    this._titleEl = this.titleEl!;

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
  }

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
    this.reveal();
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

      case "cache": {
        this._titleEl.textContent = `── debug: event cache ──`;
        try {
          const roomId = AppState.snapshot.currentRoomId;
          const [global, room] = await Promise.all([
            getEventCacheDiagnostics(),
            roomId ? getRoomCacheDiagnostics(roomId).catch(() => null) : Promise.resolve(null),
          ]);
          this._bodyEl.textContent = this._formatCacheDiagnostics(global, roomId, room);
        } catch (err) {
          this._bodyEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        break;
      }
    }

    this._panelEl.focus();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _show(title: string, body: string): void {
    this.reveal();
    this._titleEl.textContent = title;
    this._bodyEl.textContent = body;
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

  private _formatCacheDiagnostics(
    d: import("../ipc/media.js").EventCacheDiagnostics,
    roomId: string | null,
    room: import("../ipc/media.js").RoomCacheDiagnostics | null,
  ): string {
    const fmtBytes = (b: number): string => {
      if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
      if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
      if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${b} B`;
    };

    const lines = [
      `── all rooms ──`,
      `rooms cached (cached/joined): ${d.rooms_with_cached_events}/${d.rooms_total}`,
      `total cached events:          ${d.total_cached_events}`,
      ``,
      `store size (main):            ${fmtBytes(d.store_main_bytes)}`,
      `store size (wal/shm):         ${fmtBytes(d.store_wal_bytes)}`,
      `store size (total):           ${fmtBytes(d.store_total_bytes)}`,
      ``,
      `── current room ──`,
    ];

    if (!roomId) {
      lines.push(`(no room selected)`);
    } else if (!room) {
      lines.push(roomId, `(diagnostics unavailable)`);
    } else {
      const range = room.oldest_ts && room.newest_ts
        ? `${new Date(room.oldest_ts).toISOString()} → ${new Date(room.newest_ts).toISOString()}`
        : `(none)`;
      lines.push(
        roomId,
        `cached events:                ${room.cached_events}`,
        `estimated size:               ${fmtBytes(room.estimated_bytes)}`,
        `time range:                   ${range}`,
      );
    }

    return lines.join("\n");
  }

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (this.isEscape(e)) {
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
