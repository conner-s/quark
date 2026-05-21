// Device picker overlay — keyboard-navigable list of devices for verification

import type { VerificationStatus } from "../ipc/types.js";

type PickCallback = (device: VerificationStatus) => void;
type CancelCallback = () => void;

/**
 * Floating overlay that lists a user's devices and lets the user pick one
 * with j/k + Enter navigation. Used before starting a SAS verification.
 */
export class DevicePicker {
  private _el: HTMLElement;
  private _titleEl: HTMLElement;
  private _listEl: HTMLElement;

  private _devices: VerificationStatus[] = [];
  private _selectedIndex = 0;

  private _onPick: PickCallback | null = null;
  private _onCancel: CancelCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "device-picker";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Choose device to verify");
    this._el.setAttribute("aria-modal", "true");
    this._el.setAttribute("tabindex", "-1");
    this._el.style.display = "none";

    // Header row: title + close button so touch users can dismiss without Esc.
    const header = document.createElement("div");
    header.className = "device-picker__header";

    this._titleEl = document.createElement("div");
    this._titleEl.className = "device-picker__title";
    this._titleEl.textContent = "Choose device to verify";
    header.appendChild(this._titleEl);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "device-picker__close-hint dialog-close-btn";
    closeBtn.textContent = "[× Esc]";
    closeBtn.setAttribute("aria-label", "Cancel device selection");
    closeBtn.tabIndex = -1;
    closeBtn.addEventListener("click", () => {
      this.hide();
      this._onCancel?.();
    });
    header.appendChild(closeBtn);

    this._el.appendChild(header);

    const hint = document.createElement("div");
    hint.className = "device-picker__hint";
    hint.textContent = "j/k — move  ·  Enter — select  ·  Esc — cancel";
    this._el.appendChild(hint);

    this._listEl = document.createElement("ul");
    this._listEl.className = "device-picker__list";
    this._listEl.setAttribute("role", "listbox");
    this._el.appendChild(this._listEl);

    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onPick(cb: PickCallback): void {
    this._onPick = cb;
  }

  onCancel(cb: CancelCallback): void {
    this._onCancel = cb;
  }

  show(devices: VerificationStatus[], targetUserId: string): void {
    this._devices = devices;
    this._selectedIndex = 0;
    this._titleEl.textContent = `Choose device for ${targetUserId}`;
    this._render();
    this._el.style.display = "";
    this._el.focus();
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  hide(): void {
    this._el.style.display = "none";
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _render(): void {
    this._listEl.innerHTML = "";

    this._devices.forEach((device, i) => {
      const item = document.createElement("li");
      item.className = "device-picker__item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === this._selectedIndex));

      if (i === this._selectedIndex) {
        item.classList.add("device-picker__item--selected");
      }

      const idSpan = document.createElement("span");
      idSpan.className = "device-picker__device-id";
      idSpan.textContent = device.device_id;
      item.appendChild(idSpan);

      const trustSpan = document.createElement("span");
      trustSpan.className = "device-picker__trust";
      trustSpan.textContent = `  [${device.trust_level}]`;
      item.appendChild(trustSpan);

      item.addEventListener("click", () => {
        this._selectedIndex = i;
        this._confirm();
      });

      this._listEl.appendChild(item);
    });
  }

  private _moveCursor(delta: number): void {
    this._selectedIndex = Math.max(
      0,
      Math.min(this._devices.length - 1, this._selectedIndex + delta),
    );
    this._render();
  }

  private _confirm(): void {
    const device = this._devices[this._selectedIndex];
    if (device) {
      this.hide();
      this._onPick?.(device);
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        this._moveCursor(1);
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        this._moveCursor(-1);
        break;
      case "Enter":
        e.preventDefault();
        this._confirm();
        break;
      case "Escape":
        e.preventDefault();
        this.hide();
        this._onCancel?.();
        break;
    }
  }
}
