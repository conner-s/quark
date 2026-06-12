// Slim top bar shown only in mobile mode.
// Layout: [≡ hamburger] [room avatar — tap to open settings] [room name] [@ members]
//
// On mobile the desktop `.room-header` is hidden (it'd duplicate the room
// name and member count), so this bar carries the contextual room info too.

import { hashColor } from "./avatarColors.js";

export class MobileTopBar {
  private _el: HTMLElement;
  private _titleEl: HTMLElement;
  private _hamburgerEl: HTMLButtonElement;
  private _avatarBtnEl: HTMLButtonElement;
  private _membersBtnEl: HTMLButtonElement;
  private _onHamburger: (() => void) | null = null;
  private _onAvatar: (() => void) | null = null;
  private _onMembers: (() => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "mobile-top-bar";
    this._el.setAttribute("role", "toolbar");
    this._el.setAttribute("aria-label", "Mobile navigation");

    this._hamburgerEl = document.createElement("button");
    this._hamburgerEl.type = "button";
    this._hamburgerEl.className = "mobile-top-bar__btn mobile-top-bar__hamburger";
    this._hamburgerEl.setAttribute("aria-label", "Open navigation");
    this._hamburgerEl.textContent = "≡";
    this._hamburgerEl.addEventListener("click", () => this._onHamburger?.());

    // Room avatar — doubles as the entry point to room settings. Starts as
    // a fallback initial; setRoom() swaps in an <img> once an avatar URL
    // resolves. Wrapped in a button so the tap target is the full square.
    this._avatarBtnEl = document.createElement("button");
    this._avatarBtnEl.type = "button";
    this._avatarBtnEl.className = "mobile-top-bar__avatar mobile-top-bar__avatar--fallback";
    this._avatarBtnEl.setAttribute("aria-label", "Room settings");
    this._avatarBtnEl.textContent = "·";
    this._avatarBtnEl.addEventListener("click", () => this._onAvatar?.());

    this._titleEl = document.createElement("span");
    this._titleEl.className = "mobile-top-bar__title";
    this._titleEl.textContent = "Quark";

    // Member-list toggle on the right. Mirrors desktop's @ shortcut. Hidden
    // (via the --no-room modifier) until a room is selected so it doesn't
    // sit there inert at startup.
    this._membersBtnEl = document.createElement("button");
    this._membersBtnEl.type = "button";
    this._membersBtnEl.className = "mobile-top-bar__btn mobile-top-bar__members mobile-top-bar__members--hidden";
    this._membersBtnEl.setAttribute("aria-label", "Show members");
    this._membersBtnEl.textContent = "@";
    this._membersBtnEl.addEventListener("click", () => this._onMembers?.());

    this._el.appendChild(this._hamburgerEl);
    this._el.appendChild(this._avatarBtnEl);
    this._el.appendChild(this._titleEl);
    this._el.appendChild(this._membersBtnEl);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  setTitle(text: string): void {
    this._titleEl.textContent = text || "Quark";
  }

  /** Show or hide the @ members button (hidden when no room is selected). */
  setMembersButtonVisible(visible: boolean): void {
    this._membersBtnEl.classList.toggle("mobile-top-bar__members--hidden", !visible);
  }

  /**
   * Update the room avatar in the bar. Pass null/undefined to render a coloured
   * initial fallback derived from `name`.
   */
  setRoom(name: string, avatarUrl?: string | null): void {
    this._avatarBtnEl.innerHTML = "";
    if (avatarUrl) {
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.alt = "";
      img.className = "mobile-top-bar__avatar-img";
      this._avatarBtnEl.appendChild(img);
      this._avatarBtnEl.classList.remove("mobile-top-bar__avatar--fallback");
      this._avatarBtnEl.style.backgroundColor = "";
      this._avatarBtnEl.style.color = "";
    } else {
      this._avatarBtnEl.classList.add("mobile-top-bar__avatar--fallback");
      const initial = (name && name[0]) ? name[0].toUpperCase() : "·";
      this._avatarBtnEl.textContent = initial;
      const color = hashColor(name || "");
      this._avatarBtnEl.style.backgroundColor = `${color}33`;
      this._avatarBtnEl.style.color = color;
    }
  }

  onHamburgerClick(handler: () => void): void {
    this._onHamburger = handler;
  }

  /** Wire what happens when the user taps the room avatar (open settings). */
  onAvatarClick(handler: () => void): void {
    this._onAvatar = handler;
  }

  /** Wire what happens when the user taps the @ members button. */
  onMembersClick(handler: () => void): void {
    this._onMembers = handler;
  }
}
