// Device picker overlay — keyboard-navigable list of devices for verification

import type { VerificationStatus } from "../ipc/types.js";
import { PickerBase, SelectionList } from "./PickerBase.js";

type PickCallback = (device: VerificationStatus) => void;
type CancelCallback = () => void;

/**
 * Floating overlay that lists a user's devices and lets the user pick one
 * with keyboard navigation + Enter. Used before starting a SAS verification.
 *
 * Navigation routes through `keymapManager` (via SelectionList) so user
 * `quarkrc` rebindings of the movement keys apply here too.
 */
export class DevicePicker extends PickerBase {
  private _titleEl: HTMLElement;
  private _listEl: HTMLElement;

  private _devices: VerificationStatus[] = [];
  private _list: SelectionList;

  private _onPick: PickCallback | null = null;
  private _onCancel: CancelCallback | null = null;

  constructor() {
    super({
      className: "device-picker",
      ariaLabel: "Choose device to verify",
      focusable: true,
    });

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

    this._list = new SelectionList({
      columns: 1,
      highlight: { kind: "class", activeClass: "device-picker__item--selected" },
      getItems: () =>
        Array.from(this._listEl.querySelectorAll<HTMLElement>(".device-picker__item")),
      onSelect: () => this._confirm(),
      onFocusChange: (i) => {
        // Keep aria-selected in sync with the highlighted item.
        const items = this._listEl.querySelectorAll<HTMLElement>(".device-picker__item");
        items.forEach((el, idx) => el.setAttribute("aria-selected", String(idx === i)));
      },
    });

    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  onPick(cb: PickCallback): void {
    this._onPick = cb;
  }

  onCancel(cb: CancelCallback): void {
    this._onCancel = cb;
  }

  show(devices: VerificationStatus[], targetUserId: string): void {
    this._devices = devices;
    this._titleEl.textContent = `Choose device for ${targetUserId}`;
    this._render();
    this.reveal();
    this._list.setFocus(0);
    this._el.focus();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _render(): void {
    this._listEl.innerHTML = "";

    this._devices.forEach((device, i) => {
      const item = document.createElement("li");
      item.className = "device-picker__item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");

      const idSpan = document.createElement("span");
      idSpan.className = "device-picker__device-id";
      idSpan.textContent = device.device_id;
      item.appendChild(idSpan);

      const trustSpan = document.createElement("span");
      trustSpan.className = "device-picker__trust";
      trustSpan.textContent = `  [${device.trust_level}]`;
      item.appendChild(trustSpan);

      item.addEventListener("click", () => {
        this._list.setFocus(i);
        this._confirm();
      });

      this._listEl.appendChild(item);
    });
  }

  private _confirm(): void {
    const device = this._devices[this._list.focusIndex];
    if (device) {
      this.hide();
      this._onPick?.(device);
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    // Escape / Ctrl+[ cancel the picker (overlay-specific teardown + callback).
    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
      e.preventDefault();
      this.hide();
      this._onCancel?.();
      return;
    }

    // Navigation + select route through the keymap (honours rebindings).
    const { consumed, partial } = this._list.handleKey(e.key);
    if (consumed || partial) e.preventDefault();
  }
}
