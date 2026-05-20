// Slim top bar shown only in mobile mode — hamburger + room title + members toggle.

export class MobileTopBar {
  private _el: HTMLElement;
  private _titleEl: HTMLElement;
  private _hamburgerEl: HTMLButtonElement;
  private _membersBtnEl: HTMLButtonElement;
  private _onHamburger: (() => void) | null = null;
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

    this._titleEl = document.createElement("span");
    this._titleEl.className = "mobile-top-bar__title";
    this._titleEl.textContent = "Quark";

    this._membersBtnEl = document.createElement("button");
    this._membersBtnEl.type = "button";
    this._membersBtnEl.className = "mobile-top-bar__btn mobile-top-bar__members";
    this._membersBtnEl.setAttribute("aria-label", "Toggle member list");
    this._membersBtnEl.textContent = "@";
    this._membersBtnEl.addEventListener("click", () => this._onMembers?.());

    this._el.appendChild(this._hamburgerEl);
    this._el.appendChild(this._titleEl);
    this._el.appendChild(this._membersBtnEl);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  setTitle(text: string): void {
    this._titleEl.textContent = text || "Quark";
  }

  onHamburgerClick(handler: () => void): void {
    this._onHamburger = handler;
  }

  onMembersClick(handler: () => void): void {
    this._onMembers = handler;
  }
}
