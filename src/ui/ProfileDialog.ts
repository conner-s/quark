// Profile dialog — shows the current user's own profile

import { keymapManager } from "../vim/keybindings.js";

export interface ProfileData {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Modal overlay showing the current user's profile.
 * Opened via :profile command or P keybind; closed with Escape.
 */
export class ProfileDialog {
  private _el: HTMLElement;
  private _avatarEl: HTMLElement;
  private _displayNameEl: HTMLElement;
  private _userIdEl: HTMLElement;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "profile-dialog";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Your profile");
    this._el.style.display = "none";

    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "profile-dialog__header";

    const title = document.createElement("span");
    title.className = "profile-dialog__title";
    title.textContent = "── profile ──";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "profile-dialog__close";
    closeBtn.textContent = "[x]";
    closeBtn.setAttribute("aria-label", "Close profile");
    closeBtn.setAttribute("tabindex", "-1");
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);

    this._el.appendChild(header);

    // ── Avatar ────────────────────────────────────────────────────────────
    this._avatarEl = document.createElement("div");
    this._avatarEl.className = "profile-dialog__avatar";
    this._el.appendChild(this._avatarEl);

    // ── Info rows ─────────────────────────────────────────────────────────
    const info = document.createElement("div");
    info.className = "profile-dialog__info";

    const nameRow = document.createElement("div");
    nameRow.className = "profile-dialog__row";
    const nameLabel = document.createElement("span");
    nameLabel.className = "profile-dialog__label";
    nameLabel.textContent = "display name";
    this._displayNameEl = document.createElement("span");
    this._displayNameEl.className = "profile-dialog__value";
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(this._displayNameEl);
    info.appendChild(nameRow);

    const idRow = document.createElement("div");
    idRow.className = "profile-dialog__row";
    const idLabel = document.createElement("span");
    idLabel.className = "profile-dialog__label";
    idLabel.textContent = "user id";
    this._userIdEl = document.createElement("span");
    this._userIdEl.className = "profile-dialog__value profile-dialog__value--muted";
    idRow.appendChild(idLabel);
    idRow.appendChild(this._userIdEl);
    info.appendChild(idRow);

    this._el.appendChild(info);

    // ── Hint ──────────────────────────────────────────────────────────────
    const hint = document.createElement("div");
    hint.className = "profile-dialog__hint";
    hint.textContent = "Esc: close";
    this._el.appendChild(hint);

    // Click outside closes
    document.addEventListener("mousedown", (e) => {
      if (this.isVisible() && !this._el.contains(e.target as Node)) {
        this.hide();
      }
    });

    // Keyboard handling — block global handler and support close action
    this._el.addEventListener("keydown", (e) => {
      e.stopPropagation();

      if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
        return;
      }

      const result = keymapManager.resolveKey(e.key, "picker");
      if (result.kind === "action" && result.action === "close") {
        e.preventDefault();
        this.hide();
      } else if (result.kind === "partial") {
        e.preventDefault();
      }
    });
  }

  getElement(): HTMLElement {
    return this._el;
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  show(data: ProfileData): void {
    this._displayNameEl.textContent = data.displayName ?? "(not set)";
    this._userIdEl.textContent = data.userId;

    if (data.avatarUrl) {
      this._avatarEl.innerHTML = "";
      const img = document.createElement("img");
      img.src = data.avatarUrl;
      img.alt = data.displayName ?? data.userId;
      img.className = "profile-dialog__avatar-img";
      this._avatarEl.appendChild(img);
    } else {
      // Fallback: colored initial square
      const initial = (data.displayName ?? data.userId)[data.displayName ? 0 : 1]?.toUpperCase() ?? "?";
      this._avatarEl.textContent = initial;
      this._avatarEl.className = "profile-dialog__avatar profile-dialog__avatar--fallback";
    }

    this._el.style.display = "flex";
  }

  hide(): void {
    this._el.style.display = "none";
  }
}
