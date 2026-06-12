// Space selector strip — narrow vertical column of space icons

import { isAnimatedUrl } from "../app/animated_urls.js";
import { PSEUDO_SPACES, isPseudoSpace } from "../app/pseudo_spaces.js";

export interface SpaceItem {
  id: string;
  /** Display label (first letter of name used as fallback icon) */
  name: string;
  /** Optional avatar URL */
  avatarUrl?: string;
}

export class SpaceStrip {
  private _el: HTMLElement;
  private _items: SpaceItem[] = [];
  private _activeId: string | null = null;
  private _onSelect: ((id: string) => void) | null = null;
  private _onSettings: (() => void) | null = null;
  private _onProfile: (() => void) | null = null;
  private _onContextMenu: ((spaceId: string, x: number, y: number) => void) | null = null;
  private _ownAvatarUrl: string | null = null;
  private _ownInitial: string = "?";

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "space-strip";
    this._el.setAttribute("role", "listbox");
    this._el.setAttribute("aria-label", "Spaces");

  }

  getElement(): HTMLElement {
    return this._el;
  }

  onSelect(handler: (id: string) => void): void {
    this._onSelect = handler;
  }

  onSettingsClick(handler: () => void): void {
    this._onSettings = handler;
  }

  onProfileClick(handler: () => void): void {
    this._onProfile = handler;
  }

  /**
   * Update the profile-button avatar. Pass `null` to render a colored initial
   * fallback derived from `initial` (typically the first character of the
   * user's display name or MXID localpart).
   */
  setOwnProfile(initial: string, avatarUrl: string | null): void {
    this._ownAvatarUrl = avatarUrl;
    this._ownInitial = (initial && initial[0]) ? initial[0].toUpperCase() : "?";
    this._render();
  }

  onContextMenu(handler: (spaceId: string, x: number, y: number) => void): void {
    this._onContextMenu = handler;
  }

  setSpaces(items: SpaceItem[]): void {
    this._items = items;
    this._render();
  }

  setActiveSpace(id: string): void {
    this._activeId = id;
    this._updateActive();
  }

  focusActive(): void {
    const active = this._el.querySelector<HTMLElement>(".space-strip__item--active");
    const first = this._el.querySelector<HTMLElement>(".space-strip__item");
    (active ?? first)?.focus();
  }

  navDown(): void {
    const items = Array.from(this._el.querySelectorAll<HTMLElement>(".space-strip__item"));
    const focused = document.activeElement as HTMLElement;
    const idx = items.indexOf(focused);
    const next = items[idx + 1] ?? items[0];
    next?.focus();
  }

  navUp(): void {
    const items = Array.from(this._el.querySelectorAll<HTMLElement>(".space-strip__item"));
    const focused = document.activeElement as HTMLElement;
    const idx = items.indexOf(focused);
    const prev = idx <= 0 ? items[items.length - 1] : items[idx - 1];
    prev?.focus();
  }

  selectFocused(): void {
    const focused = document.activeElement as HTMLElement;
    const id = focused?.dataset.spaceId;
    if (id) this._selectId(id);
  }

  navFirst(): void {
    this._el.querySelector<HTMLElement>(".space-strip__item")?.focus();
  }

  navLast(): void {
    const items = this._el.querySelectorAll<HTMLElement>(".space-strip__item");
    items[items.length - 1]?.focus();
  }

  /** Swap in a resolved avatar data URL for a space item. */
  updateSpaceAvatar(spaceId: string, dataUrl: string): void {
    const item = this._el.querySelector<HTMLElement>(`[data-space-id="${CSS.escape(spaceId)}"]`);
    if (!item) return;
    // Replace existing img or text with the resolved image
    const existing = item.querySelector("img");
    if (existing) {
      existing.src = dataUrl;
      if (isAnimatedUrl(dataUrl)) existing.dataset.gif = "1";
    } else {
      item.textContent = "";
      const img = document.createElement("img");
	  img.className = "space-strip__icon";
      img.src = dataUrl;
      img.alt = "";
      if (isAnimatedUrl(dataUrl)) img.dataset.gif = "1";
      item.appendChild(img);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _render(): void {
    this._el.innerHTML = "";

    const topPseudos = PSEUDO_SPACES.filter((p) => p.position === "top");
    const bottomPseudos = PSEUDO_SPACES.filter((p) => p.position === "bottom");

    for (const ps of topPseudos) {
      this._el.appendChild(this._createItem({ id: ps.id, name: ps.label }, ps.icon));
    }

    if (this._items.length > 0) {
      this._el.appendChild(this._createDivider());
    }

    for (const item of this._items) {
      this._el.appendChild(this._createItem(item));
    }

    if (this._items.length > 0) {
      this._el.appendChild(this._createDivider());
    }

    for (const ps of bottomPseudos) {
      this._el.appendChild(this._createItem({ id: ps.id, name: ps.label }, ps.icon));
    }

    // Spacer pushes the settings + profile buttons to the bottom
    const spacer = document.createElement("div");
    spacer.className = "space-strip__spacer";
    spacer.setAttribute("aria-hidden", "true");
    this._el.appendChild(spacer);

    // Settings button — sits above the profile button so the profile (your
    // identity) is the very last item, closest to the screen edge / thumb.
    const settingsBtn = document.createElement("div");
    settingsBtn.className = "space-strip__settings-btn";
    settingsBtn.setAttribute("role", "button");
    settingsBtn.setAttribute("tabindex", "0");
    settingsBtn.setAttribute("aria-label", "Settings");
    settingsBtn.title = "Settings (?)";
    settingsBtn.textContent = "⚙";
    settingsBtn.addEventListener("click", () => this._onSettings?.());
    settingsBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._onSettings?.();
      }
    });
    this._el.appendChild(settingsBtn);

    // Profile button — the avatar (or coloured initial fallback) is the
    // universal entry point to "my profile" on both desktop and mobile.
    const profileBtn = document.createElement("div");
    profileBtn.className = "space-strip__profile-btn";
    profileBtn.setAttribute("role", "button");
    profileBtn.setAttribute("tabindex", "0");
    profileBtn.setAttribute("aria-label", "Your profile");
    profileBtn.title = "Profile";
    if (this._ownAvatarUrl) {
      const img = document.createElement("img");
      img.src = this._ownAvatarUrl;
      img.alt = "";
      img.className = "space-strip__profile-img";
      profileBtn.appendChild(img);
    } else {
      profileBtn.classList.add("space-strip__profile-btn--fallback");
      profileBtn.textContent = this._ownInitial;
    }
    profileBtn.addEventListener("click", () => this._onProfile?.());
    profileBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._onProfile?.();
      }
    });
    this._el.appendChild(profileBtn);

    this._updateActive();
  }

  private _createItem(item: SpaceItem, overrideLabel?: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "space-strip__item";
    el.setAttribute("role", "option");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", item.name);
    el.dataset.spaceId = item.id;

    if (item.avatarUrl) {
      const img = document.createElement("img");
      img.src = item.avatarUrl;
      img.alt = item.name;
      img.style.width = "20px";
      img.style.height = "20px";
      img.style.objectFit = "cover";
      if (isAnimatedUrl(item.avatarUrl)) img.dataset.gif = "1";
      el.appendChild(img);
    } else {
      el.textContent = overrideLabel ?? item.name.charAt(0).toUpperCase();
    }

    el.addEventListener("click", () => this._selectId(item.id));
    if (!isPseudoSpace(item.id)) {
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this._onContextMenu?.(item.id, e.clientX, e.clientY);
      });
    }
    el.addEventListener("focus", () => {
      // Dispatch a focusspace event so keyboard.ts can update activePanel
      this._el.dispatchEvent(new CustomEvent("quark:space-focused", { bubbles: true }));
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._selectId(item.id);
      }
    });

    return el;
  }

  private _createDivider(): HTMLElement {
    const divider = document.createElement("div");
    divider.className = "space-strip__divider";
    divider.setAttribute("role", "separator");
    return divider;
  }

  private _selectId(id: string): void {
    this._activeId = id;
    this._updateActive();
    this._onSelect?.(id);
  }

  private _updateActive(): void {
    for (const el of this._el.querySelectorAll<HTMLElement>(".space-strip__item")) {
      const isActive = el.dataset.spaceId === this._activeId;
      el.classList.toggle("space-strip__item--active", isActive);
      el.setAttribute("aria-selected", String(isActive));
    }
  }

  // Navigation (j/k/arrows) is handled by the global keymap via AppState.navDown/navUp.
  // Enter/Space activation is handled by individual item listeners in _createItem.
}
