// Bottom-left status bar — connection status and editable presence status

export class StatusBar {
  private _el: HTMLElement;
  private _encEl: HTMLElement;
  private _connEl: HTMLElement;
  private _statusEl: HTMLElement;
  private _statusInput: HTMLInputElement | null = null;
  private _onSetStatus: ((msg: string) => void) | null = null;

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

    // ── Spacer pushes right-side items to the right ──────────────────────────
    const spacer = document.createElement("span");
    spacer.className = "status-bar__spacer";
    spacer.setAttribute("aria-hidden", "true");
    this._el.appendChild(spacer);

    // ── Presence status message ───────────────────────────────────────────────
    this._statusEl = document.createElement("span");
    this._statusEl.className = "status-bar__status";
    this._statusEl.setAttribute("aria-label", "Presence status — click or press S to edit");
    this._statusEl.title = "Click or press S to set status";
    this._statusEl.textContent = "";
    this._statusEl.addEventListener("click", () => this.beginEdit());
    this._el.appendChild(this._statusEl);

    // ── Separator ────────────────────────────────────────────────────────────
    this._el.appendChild(this._makeSep());

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

  /** Display a presence status message. Pass empty string to show the placeholder. */
  setStatusMessage(msg: string): void {
    if (this._statusInput) return; // don't clobber mid-edit
    this._statusEl.textContent = msg || "set status…";
    this._statusEl.classList.toggle("status-bar__status--placeholder", !msg);
  }

  /** Return the currently-displayed status message, or empty string if unset. */
  getStatusMessage(): string {
    if (this._statusInput) return this._statusInput.value;
    if (this._statusEl.classList.contains("status-bar__status--placeholder")) return "";
    return this._statusEl.textContent ?? "";
  }

  /** Register a callback invoked when the user commits a new status message. */
  onSetStatus(cb: (msg: string) => void): void {
    this._onSetStatus = cb;
  }

  /** Enter inline editing mode for the status message. */
  beginEdit(): void {
    if (this._statusInput) return; // already editing

    const current = this._statusEl.textContent ?? "";
    const placeholder = this._statusEl.classList.contains("status-bar__status--placeholder");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "status-bar__status-input";
    input.value = placeholder ? "" : current;
    input.placeholder = "set status…";
    input.maxLength = 255;
    input.setAttribute("aria-label", "Presence status message");

    this._statusInput = input;
    this._statusEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const val = input.value.trim();
      input.replaceWith(this._statusEl);
      this._statusInput = null;
      this.setStatusMessage(val);
      this._onSetStatus?.(val);
    };

    const cancel = () => {
      input.replaceWith(this._statusEl);
      this._statusInput = null;
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape" || (e.key === "[" && e.ctrlKey)) { e.preventDefault(); cancel(); }
      e.stopPropagation(); // prevent vim mode from intercepting
    });
    input.addEventListener("blur", cancel);
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
