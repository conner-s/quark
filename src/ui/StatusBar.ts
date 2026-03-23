// Bottom status bar — mode indicator, room name, encryption, connection

import { Mode } from "../vim/mode.js";

const MODE_LABELS: Record<string, string> = {
  Normal: "NOR",
  Insert: "INS",
  Command: "CMD",
  Visual: "VIS",
};

const MODE_CSS_CLASS: Record<string, string> = {
  Normal: "",
  Insert: "status-bar__mode--insert",
  Command: "status-bar__mode--command",
  Visual: "status-bar__mode--visual",
};

export class StatusBar {
  private _el: HTMLElement;
  private _modeEl: HTMLElement;
  private _roomEl: HTMLElement;
  private _encEl: HTMLElement;
  private _connEl: HTMLElement;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "status-bar";
    this._el.setAttribute("role", "status");
    this._el.setAttribute("aria-label", "Status bar");

    // ── Mode indicator (left) ────────────────────────────────────────────────
    this._modeEl = document.createElement("span");
    this._modeEl.className = "status-bar__mode";
    this._modeEl.setAttribute("aria-live", "polite");
    this._modeEl.setAttribute("aria-label", "Editor mode");
    this._modeEl.textContent = "NOR";
    this._el.appendChild(this._modeEl);

    // ── Separator ────────────────────────────────────────────────────────────
    this._el.appendChild(this._makeSep());

    // ── Room name (centre-left) ──────────────────────────────────────────────
    this._roomEl = document.createElement("span");
    this._roomEl.className = "status-bar__room";
    this._roomEl.setAttribute("aria-label", "Current room");
    this._roomEl.textContent = "—";
    this._el.appendChild(this._roomEl);

    // ── Spacer pushes right-side items to the right ──────────────────────────
    const spacer = document.createElement("span");
    spacer.className = "status-bar__spacer";
    spacer.setAttribute("aria-hidden", "true");
    this._el.appendChild(spacer);

    // ── Encryption indicator ─────────────────────────────────────────────────
    this._encEl = document.createElement("span");
    this._encEl.className = "status-bar__encryption";
    this._encEl.setAttribute("aria-label", "Encryption status");
    this._encEl.textContent = "🔓";
    this._el.appendChild(this._encEl);

    // ── Separator ────────────────────────────────────────────────────────────
    this._el.appendChild(this._makeSep());

    // ── Connection status ────────────────────────────────────────────────────
    this._connEl = document.createElement("span");
    this._connEl.className = "status-bar__connection";
    this._connEl.setAttribute("aria-label", "Connection status");
    this._connEl.setAttribute("aria-live", "polite");
    this._connEl.textContent = "offline";
    this._el.appendChild(this._connEl);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getElement(): HTMLElement {
    return this._el;
  }

  setMode(mode: Mode): void {
    const label = mode as string;

    // Remove all previous mode classes
    for (const cls of Object.values(MODE_CSS_CLASS)) {
      if (cls) this._modeEl.classList.remove(cls);
    }

    this._modeEl.textContent = MODE_LABELS[label] ?? label.slice(0, 3).toUpperCase();

    const cls = MODE_CSS_CLASS[label];
    if (cls) this._modeEl.classList.add(cls);
  }

  setRoom(name: string | null): void {
    this._roomEl.textContent = name ?? "—";
  }

  setEncrypted(encrypted: boolean): void {
    this._encEl.textContent = encrypted ? "🔒" : "🔓";
    this._encEl.setAttribute(
      "aria-label",
      encrypted ? "End-to-end encrypted" : "Not encrypted"
    );
    this._encEl.classList.toggle("status-bar__encryption--on", encrypted);
    this._encEl.classList.toggle("status-bar__encryption--off", !encrypted);
  }

  setConnected(connected: boolean): void {
    this._connEl.textContent = connected ? "online" : "offline";
    this._connEl.classList.toggle("status-bar__connection--online", connected);
    this._connEl.classList.toggle("status-bar__connection--offline", !connected);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _makeSep(): HTMLElement {
    const sep = document.createElement("span");
    sep.className = "status-bar__sep";
    sep.setAttribute("aria-hidden", "true");
    sep.textContent = " │ ";
    return sep;
  }
}
