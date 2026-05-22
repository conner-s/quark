// Profile edit dialog — lets the current user change their display name
// and presence status. Avatar editing is deliberately out of scope for now
// (needs a file picker → mxc:// upload → set_avatar_url pipeline).

import { keymapManager } from "../vim/keybindings.js";

export interface ProfileEditInitial {
  /** Read-only display of the user's MXID for context. */
  userId: string;
  /** Current display name; null when unset. */
  displayName: string | null;
  /** Current status (presence status_msg); null when unset. */
  statusMessage: string | null;
}

export interface ProfileEditSubmit {
  /** Trimmed display name; an empty string clears it. */
  displayName: string;
  /** Trimmed status message; an empty string clears it. */
  statusMessage: string;
  /** True if the display name was changed from initial. */
  displayNameChanged: boolean;
  /** True if the status message was changed from initial. */
  statusChanged: boolean;
}

export class ProfileEditDialog {
  private _el: HTMLElement;
  private _panelEl: HTMLElement;
  private _userIdEl: HTMLElement;
  private _displayNameInput: HTMLInputElement;
  private _statusInput: HTMLInputElement;
  private _saveBtn: HTMLButtonElement;
  private _statusEl: HTMLElement;
  private _onSubmit: ((data: ProfileEditSubmit) => Promise<void> | void) | null = null;
  private _initial: ProfileEditInitial | null = null;

  constructor() {
    // Backdrop
    this._el = document.createElement("div");
    this._el.className = "profile-edit-dialog";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Edit profile");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    // Panel
    this._panelEl = document.createElement("div");
    this._panelEl.className = "profile-edit-dialog__panel";
    this._panelEl.tabIndex = -1;
    this._el.appendChild(this._panelEl);

    // Header
    const header = document.createElement("div");
    header.className = "profile-edit-dialog__header";
    const title = document.createElement("span");
    title.className = "profile-edit-dialog__title";
    title.textContent = "── edit profile ──";
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "profile-edit-dialog__close dialog-close-btn";
    closeBtn.textContent = "[× Esc]";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.tabIndex = -1;
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    this._panelEl.appendChild(header);

    // User ID context line — read-only display so the user knows which
    // account they're editing if they're juggling multiple homeservers.
    const ctxRow = document.createElement("div");
    ctxRow.className = "profile-edit-dialog__row profile-edit-dialog__row--readonly";
    const ctxLabel = document.createElement("span");
    ctxLabel.className = "profile-edit-dialog__label";
    ctxLabel.textContent = "user";
    this._userIdEl = document.createElement("span");
    this._userIdEl.className = "profile-edit-dialog__value";
    ctxRow.appendChild(ctxLabel);
    ctxRow.appendChild(this._userIdEl);
    this._panelEl.appendChild(ctxRow);

    // Display name input
    const nameRow = document.createElement("div");
    nameRow.className = "profile-edit-dialog__row";
    const nameLabel = document.createElement("label");
    nameLabel.className = "profile-edit-dialog__label";
    nameLabel.textContent = "display name";
    this._displayNameInput = document.createElement("input");
    this._displayNameInput.type = "text";
    this._displayNameInput.className = "profile-edit-dialog__input";
    this._displayNameInput.setAttribute("autocomplete", "off");
    this._displayNameInput.setAttribute("autocapitalize", "words");
    this._displayNameInput.setAttribute("spellcheck", "false");
    this._displayNameInput.maxLength = 256;
    nameLabel.appendChild(this._displayNameInput);
    nameRow.appendChild(nameLabel);
    this._panelEl.appendChild(nameRow);

    // Status message input
    const statusRow = document.createElement("div");
    statusRow.className = "profile-edit-dialog__row";
    const statusLabel = document.createElement("label");
    statusLabel.className = "profile-edit-dialog__label";
    statusLabel.textContent = "status";
    this._statusInput = document.createElement("input");
    this._statusInput.type = "text";
    this._statusInput.className = "profile-edit-dialog__input";
    this._statusInput.setAttribute("autocomplete", "off");
    this._statusInput.setAttribute("spellcheck", "true");
    this._statusInput.placeholder = "What's up? (blank to clear)";
    this._statusInput.maxLength = 256;
    statusLabel.appendChild(this._statusInput);
    statusRow.appendChild(statusLabel);
    this._panelEl.appendChild(statusRow);

    // Status / error line
    this._statusEl = document.createElement("div");
    this._statusEl.className = "profile-edit-dialog__status";
    this._panelEl.appendChild(this._statusEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "profile-edit-dialog__footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "profile-edit-dialog__btn";
    cancelBtn.textContent = "[cancel]";
    cancelBtn.addEventListener("click", () => this.hide());
    footer.appendChild(cancelBtn);

    this._saveBtn = document.createElement("button");
    this._saveBtn.type = "button";
    this._saveBtn.className = "profile-edit-dialog__btn profile-edit-dialog__btn--primary";
    this._saveBtn.textContent = "[ save ]";
    this._saveBtn.addEventListener("click", () => void this._submit());
    footer.appendChild(this._saveBtn);

    this._panelEl.appendChild(footer);

    // Keyboard handling
    this._el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        e.preventDefault();
        this.hide();
        return;
      }
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        void this._submit();
        return;
      }
      // Block global vim shortcuts while typing in inputs.
      const result = keymapManager.resolveKey(e.key, "picker");
      if (result.kind === "partial") e.preventDefault();
    });
  }

  getElement(): HTMLElement {
    return this._el;
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  show(initial: ProfileEditInitial, onSubmit: (data: ProfileEditSubmit) => Promise<void> | void): void {
    this._initial = initial;
    this._onSubmit = onSubmit;
    this._userIdEl.textContent = initial.userId;
    this._displayNameInput.value = initial.displayName ?? "";
    this._statusInput.value = initial.statusMessage ?? "";
    this._setStatus("", "neutral");
    this._setSaving(false);
    this._el.style.display = "flex";
    // Focus the display-name field after layout settles.
    requestAnimationFrame(() => this._displayNameInput.focus());
  }

  hide(): void {
    this._el.style.display = "none";
    this._initial = null;
    this._onSubmit = null;
  }

  private async _submit(): Promise<void> {
    if (!this._initial || !this._onSubmit) return;
    const displayName = this._displayNameInput.value.trim();
    const statusMessage = this._statusInput.value.trim();
    const displayNameChanged = displayName !== (this._initial.displayName ?? "");
    const statusChanged = statusMessage !== (this._initial.statusMessage ?? "");

    if (!displayNameChanged && !statusChanged) {
      this._setStatus("Nothing changed.", "neutral");
      return;
    }

    this._setSaving(true);
    this._setStatus("Saving…", "neutral");
    try {
      await this._onSubmit({ displayName, statusMessage, displayNameChanged, statusChanged });
      this._setStatus("Saved.", "success");
      // Briefly show success before dismissing, so the user gets feedback.
      setTimeout(() => this.hide(), 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._setStatus(`Failed: ${msg}`, "error");
      this._setSaving(false);
    }
  }

  private _setSaving(saving: boolean): void {
    this._saveBtn.disabled = saving;
    this._saveBtn.textContent = saving ? "[ saving… ]" : "[ save ]";
  }

  private _setStatus(text: string, kind: "neutral" | "success" | "error"): void {
    this._statusEl.textContent = text;
    this._statusEl.className = `profile-edit-dialog__status profile-edit-dialog__status--${kind}`;
  }
}
