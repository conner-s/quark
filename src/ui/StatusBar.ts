// Bottom-left status bar — connection and encryption status

export class StatusBar {
  private _el: HTMLElement;
  private _roomEl: HTMLElement;
  private _encEl: HTMLElement;
  private _connEl: HTMLElement;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "status-bar";
    this._el.setAttribute("role", "status");
    this._el.setAttribute("aria-label", "Status bar");

    // ── Connection status (left) ─────────────────────────────────────────────
    this._connEl = document.createElement("span");
    this._connEl.className = "status-bar__connection";
    this._connEl.setAttribute("aria-label", "Connection status");
    this._connEl.setAttribute("aria-live", "polite");
    this._connEl.textContent = "offline";
    this._el.appendChild(this._connEl);

    // ── Separator ────────────────────────────────────────────────────────────
    this._el.appendChild(this._makeSep());

    // ── Room name ────────────────────────────────────────────────────────────
    this._roomEl = document.createElement("span");
    this._roomEl.className = "status-bar__room";
    this._roomEl.setAttribute("aria-label", "Current room");
    this._roomEl.textContent = "—";
    this._el.appendChild(this._roomEl);

    // ── Spacer pushes encryption indicator to the right ──────────────────────
    const spacer = document.createElement("span");
    spacer.className = "status-bar__spacer";
    spacer.setAttribute("aria-hidden", "true");
    this._el.appendChild(spacer);

    // ── Encryption indicator (right) ─────────────────────────────────────────
    this._encEl = document.createElement("span");
    this._encEl.className = "status-bar__encryption";
    this._encEl.setAttribute("aria-label", "Encryption status");
    this._encEl.textContent = "🔓";
    this._el.appendChild(this._encEl);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getElement(): HTMLElement {
    return this._el;
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
