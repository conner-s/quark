// Profile dialog — shows the current user's own profile

import { keymapManager } from "../vim/keybindings.js";
import { isAnimatedUrl } from "../app/animated_urls.js";

export interface ProfileData {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Presence status message, if known. */
  statusMessage?: string | null;
  /** If provided, a [message] button is shown that calls this when clicked. */
  onMessage?: () => void;
  /** If provided, an [edit profile] button is shown — typically only set
   *  when the profile being shown is the current user's. */
  onEdit?: () => void;
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
  private _homeserverEl: HTMLElement;
  private _statusMsgEl: HTMLElement;
  private _statusMsgRow: HTMLElement;
  private _copyBtn: HTMLButtonElement;
  private _dmBtn: HTMLButtonElement;
  private _editBtn: HTMLButtonElement;
  private _actionsEl: HTMLElement;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "profile-dialog";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Your profile");
    this._el.setAttribute("tabindex", "-1");
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
    this._copyBtn = document.createElement("button");
    this._copyBtn.type = "button";
    this._copyBtn.className = "profile-dialog__copy-btn";
    this._copyBtn.textContent = "[copy]";
    this._copyBtn.setAttribute("aria-label", "Copy user ID");
    this._copyBtn.setAttribute("tabindex", "-1");
    this._copyBtn.addEventListener("click", () => {
      const userId = this._userIdEl.textContent ?? "";
      navigator.clipboard.writeText(userId).then(() => {
        this._copyBtn.textContent = "[copied!]";
        setTimeout(() => {
          this._copyBtn.textContent = "[copy]";
        }, 1500);
      });
    });
    idRow.appendChild(idLabel);
    idRow.appendChild(this._userIdEl);
    idRow.appendChild(this._copyBtn);
    info.appendChild(idRow);

    const hsRow = document.createElement("div");
    hsRow.className = "profile-dialog__row";
    const hsLabel = document.createElement("span");
    hsLabel.className = "profile-dialog__label";
    hsLabel.textContent = "homeserver";
    this._homeserverEl = document.createElement("span");
    this._homeserverEl.className = "profile-dialog__value profile-dialog__value--muted";
    hsRow.appendChild(hsLabel);
    hsRow.appendChild(this._homeserverEl);
    info.appendChild(hsRow);

    this._statusMsgRow = document.createElement("div");
    this._statusMsgRow.className = "profile-dialog__row";
    const statusLabel = document.createElement("span");
    statusLabel.className = "profile-dialog__label";
    statusLabel.textContent = "status";
    this._statusMsgEl = document.createElement("span");
    this._statusMsgEl.className = "profile-dialog__value profile-dialog__value--status";
    this._statusMsgRow.appendChild(statusLabel);
    this._statusMsgRow.appendChild(this._statusMsgEl);
    this._statusMsgRow.style.display = "none";
    info.appendChild(this._statusMsgRow);

    this._el.appendChild(info);

    // ── Actions ───────────────────────────────────────────────────────────
    this._actionsEl = document.createElement("div");
    this._actionsEl.className = "profile-dialog__actions";

    this._dmBtn = document.createElement("button");
    this._dmBtn.type = "button";
    this._dmBtn.className = "profile-dialog__dm-btn";
    this._dmBtn.textContent = "[message]";
    this._dmBtn.setAttribute("aria-label", "Open direct message");
    this._dmBtn.setAttribute("tabindex", "-1");
    this._actionsEl.appendChild(this._dmBtn);

    // [edit profile] — only shown when caller provides `onEdit`, typically
    // for the user's own profile. Reusing the same actions row keeps the
    // dialog's geometry stable whether it's a self-view or other-view.
    this._editBtn = document.createElement("button");
    this._editBtn.type = "button";
    this._editBtn.className = "profile-dialog__dm-btn";
    this._editBtn.textContent = "[edit profile]";
    this._editBtn.setAttribute("aria-label", "Edit profile");
    this._editBtn.setAttribute("tabindex", "-1");
    this._actionsEl.appendChild(this._editBtn);

    this._actionsEl.style.display = "none";
    this._el.appendChild(this._actionsEl);

    // ── Hint ──────────────────────────────────────────────────────────────
    const hint = document.createElement("div");
    hint.className = "profile-dialog__hint";
    hint.textContent = "Esc: close";
    this._el.appendChild(hint);

    // Click/tap outside closes — both mousedown and touchstart for iOS.
    const outsideHandler = (e: Event): void => {
      if (this.isVisible() && !this._el.contains(e.target as Node)) {
        this.hide();
      }
    };
    document.addEventListener("mousedown", outsideHandler);
    document.addEventListener("touchstart", outsideHandler, { passive: true });

    // Keyboard handling — block global handler and support close action
    this._el.addEventListener("keydown", (e) => {
      e.stopPropagation();

      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
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
    const colonIdx = data.userId.indexOf(":");
    this._homeserverEl.textContent = colonIdx !== -1 ? data.userId.slice(colonIdx + 1) : data.userId;

    if (data.statusMessage) {
      this._statusMsgEl.textContent = data.statusMessage;
      this._statusMsgRow.style.display = "";
    } else {
      this._statusMsgRow.style.display = "none";
    }

    // Wire up DM button — replace existing listener by cloning the node.
    if (data.onMessage) {
      const handler = data.onMessage;
      const newBtn = this._dmBtn.cloneNode(true) as HTMLButtonElement;
      this._dmBtn.replaceWith(newBtn);
      this._dmBtn = newBtn;
      this._dmBtn.style.display = "";
      this._dmBtn.addEventListener("click", () => {
        this.hide();
        handler();
      });
    } else {
      this._dmBtn.style.display = "none";
    }

    // Wire up edit button. Same clone trick to drop the previous handler.
    if (data.onEdit) {
      const handler = data.onEdit;
      const newEdit = this._editBtn.cloneNode(true) as HTMLButtonElement;
      this._editBtn.replaceWith(newEdit);
      this._editBtn = newEdit;
      this._editBtn.style.display = "";
      this._editBtn.addEventListener("click", () => {
        this.hide();
        handler();
      });
    } else {
      this._editBtn.style.display = "none";
    }

    // Show the action row if either button is in use.
    this._actionsEl.style.display = data.onMessage || data.onEdit ? "" : "none";

    if (data.avatarUrl) {
      this._avatarEl.innerHTML = "";
      const img = document.createElement("img");
      img.src = data.avatarUrl;
      img.alt = data.displayName ?? data.userId;
      img.className = "profile-dialog__avatar-img";
      if (isAnimatedUrl(data.avatarUrl)) img.dataset.gif = "1";
      this._avatarEl.appendChild(img);
    } else {
      // Fallback: colored initial square
      const initial = (data.displayName ?? data.userId)[data.displayName ? 0 : 1]?.toUpperCase() ?? "?";
      this._avatarEl.textContent = initial;
      this._avatarEl.className = "profile-dialog__avatar profile-dialog__avatar--fallback";
    }

    this._el.style.display = "flex";
    this._el.focus();
  }

  hide(): void {
    this._el.style.display = "none";
  }
}
