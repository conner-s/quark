// Themed hover card listing users: a message's readers, or who reacted with a
// key. The timeline and the thread panel each own one; the card itself only
// knows how to draw a list of user IDs next to an anchor and keep it there.

import { isAnimatedUrl } from "../app/animated_urls.js";
import { viewportPan } from "../app/mobile.js";
import { hashColor } from "./avatarColors.js";
import { mountOverlay } from "./overlay.js";
import type { ReactionGroup } from "./Reactions.js";

/** Injected from the app layer so UI components can render real avatars and
 *  names without importing app/actions (layering). */
export interface UserResolvers {
  avatarUrl: (userId: string) => string | undefined;
  displayName: (userId: string) => string;
}

/** One user in the card, with optional trailing detail (a receipt's time). */
export interface UserListRow {
  userId: string;
  detail?: string;
}

/** Rows the card lists before summing the rest as "and N more", so a busy
 *  room's card can't outgrow the window. */
const MAX_ROWS = 15;

export class UserListCard {
  /** Lazily created on `<body>` (position:fixed) so no panel's overflow can
   *  clip it. */
  private _el: HTMLElement | null = null;
  private _anchor: HTMLElement | null = null;

  constructor(private readonly _resolvers: () => UserResolvers | null) {}

  /** The element the card is showing for, if any. */
  get anchor(): HTMLElement | null {
    return this._anchor;
  }

  /** Populate and position the card above (or below) `anchor`: a title, then
   *  one avatar + name row per user. */
  show(anchor: HTMLElement, title: (string | Node)[], rows: UserListRow[]): void {
    this._anchor = anchor;
    const tip = this._ensure();
    tip.replaceChildren();
    const resolvers = this._resolvers();

    const titleEl = document.createElement("div");
    titleEl.className = "user-list-card__title";
    titleEl.append(...title);
    tip.appendChild(titleEl);

    for (const entry of rows.slice(0, MAX_ROWS)) {
      const row = document.createElement("div");
      row.className = "user-list-card__row";

      const avatar = document.createElement("span");
      avatar.className = "read-receipt";
      avatar.appendChild(buildUserAvatar(entry.userId, resolvers?.avatarUrl(entry.userId)));
      row.appendChild(avatar);

      const name = document.createElement("span");
      name.className = "user-list-card__name";
      name.textContent = resolvers?.displayName(entry.userId) ?? entry.userId;
      row.appendChild(name);

      if (entry.detail !== undefined) {
        const detail = document.createElement("span");
        detail.className = "user-list-card__detail";
        detail.textContent = entry.detail;
        row.appendChild(detail);
      }

      tip.appendChild(row);
    }

    const hidden = rows.length - MAX_ROWS;
    if (hidden > 0) {
      const more = document.createElement("div");
      more.className = "user-list-card__more";
      more.textContent = `and ${hidden} more`;
      tip.appendChild(more);
    }

    tip.style.display = "block";
    this._position(anchor, tip);
  }

  /** Everyone who reacted with a chip's key, under the emoji itself. A chip
   *  with no known senders shows nothing. */
  showReaction(chip: HTMLElement, reaction: ReactionGroup): void {
    const senders = reaction.senders ?? [];
    if (senders.length === 0) {
      this.hide();
      return;
    }
    const title: (string | Node)[] = [];
    if (reaction.imageUrl) {
      const img = document.createElement("img");
      img.className = "user-list-card__emoji";
      img.src = reaction.imageUrl;
      img.alt = "";
      title.push(img);
    } else if (!reaction.key.startsWith("mxc://")) {
      title.push(`${reaction.key} `);
    }
    title.push(senders.length === 1 ? "Reacted by" : `Reacted by ${senders.length}`);
    this.show(chip, title, senders.map((userId) => ({ userId })));
  }

  hide(): void {
    this._anchor = null;
    if (this._el) this._el.style.display = "none";
  }

  /** Close the card if its anchor has left the document. A detached node never
   *  gets mouseleave, so nothing else would close it. */
  closeIfDetached(): void {
    if (this._anchor && !this._anchor.isConnected) this.hide();
  }

  /** After `view` scrolls: move the open card with its anchor, or close it
   *  once the anchor has left `view`'s visible area. On touch, where
   *  mouseleave may never come, it would otherwise float at its old place. */
  follow(view: HTMLElement): void {
    const anchor = this._anchor;
    const tip = this._el;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const v = view.getBoundingClientRect();
    if (!anchor.isConnected || a.bottom <= v.top || a.top >= v.bottom) {
      this.hide();
      return;
    }
    this._position(anchor, tip);
  }

  private _ensure(): HTMLElement {
    if (this._el) return this._el;
    const el = document.createElement("div");
    el.className = "user-list-card";
    el.style.display = "none";
    mountOverlay(el);
    this._el = el;
    return el;
  }

  /** Measure, then position the card above its anchor (flip below if it would
   *  clip), right-aligned to the anchor and clamped to the viewport. */
  private _position(anchor: HTMLElement, tip: HTMLElement): void {
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = a.top - t.height - 6;
    if (top < 8) top = a.bottom + 6;
    const left = Math.max(8, Math.min(a.right - t.width, window.innerWidth - t.width - 8));
    tip.style.left = `${left}px`;
    // The rects are layout-viewport space; the card is in the overlay layer,
    // which carries the viewport pan (#33).
    tip.style.top = `${top - viewportPan()}px`;
  }
}

/** A 14px user avatar: an <img> when a blob URL is known, else a colored
 *  initial (also what a failed image falls back to). */
export function buildUserAvatar(userId: string, avatarUrl?: string): HTMLElement {
  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "read-receipt__avatar";
    img.src = avatarUrl;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    if (isAnimatedUrl(avatarUrl)) img.dataset.gif = "1";
    img.onerror = () => img.replaceWith(buildAvatarFallback(userId));
    return img;
  }
  return buildAvatarFallback(userId);
}

function buildAvatarFallback(userId: string): HTMLElement {
  const color = hashColor(userId);
  const initial = (userId.startsWith("@") ? userId[1] : userId[0] ?? "?").toUpperCase();
  const el = document.createElement("span");
  el.className = "read-receipt__fallback";
  el.textContent = initial;
  // A solid colored disc with a bg-colored initial reads clearly at 14px,
  // where a nested colored border (as the group avatars use) would not.
  el.style.background = color;
  el.setAttribute("aria-hidden", "true");
  return el;
}
