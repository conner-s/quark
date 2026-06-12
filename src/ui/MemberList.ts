// Room member sidebar

import { attachResizeHandle } from "./ResizeHandle.js";
import { isAnimatedUrl } from "../app/animated_urls.js";
import { hashColor } from "./avatarColors.js";

export type PresenceStatus = "online" | "unavailable" | "offline";
export type PowerLevel = "admin" | "mod" | "member";

// ── Avatar helpers ────────────────────────────────────────────────────────────

function _memberColor(name: string): string {
  return hashColor(name);
}

function _buildFallbackAvatar(name: string): HTMLElement {
  const color = _memberColor(name);
  const initial = name[0]?.toUpperCase() ?? "?";
  const el = document.createElement("span");
  el.className = "member-list__avatar member-list__avatar--fallback";
  el.textContent = initial;
  el.style.color = color;
  el.style.border = `1px solid ${color}`;
  el.setAttribute("aria-hidden", "true");
  return el;
}

function _buildAvatarElement(name: string, avatarUrl?: string): HTMLElement {
  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "member-list__avatar";
    img.src = avatarUrl;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    if (isAnimatedUrl(avatarUrl)) img.dataset.gif = "1";
    img.onerror = () => img.replaceWith(_buildFallbackAvatar(name));
    return img;
  }
  return _buildFallbackAvatar(name);
}

export interface MemberEntry {
  id: string;
  /** Display name */
  name: string;
  /** Matrix user ID, e.g. @alice:matrix.org */
  userId: string;
  powerLevel: PowerLevel;
  presence?: PresenceStatus;
  /** Optional avatar URL */
  avatarUrl?: string;
}

type MemberSelectCallback = (member: MemberEntry) => void;

const POWER_LEVEL_ORDER: PowerLevel[] = ["admin", "mod", "member"];
const POWER_LEVEL_LABELS: Record<PowerLevel, string> = {
  admin: "Admins",
  mod: "Moderators",
  member: "Members",
};

const PRESENCE_SYMBOL: Record<PresenceStatus, string> = {
  online: "●",
  unavailable: "◐",
  offline: "○",
};

/** Collapsible room member sidebar grouped by power level. */
export class MemberList {
  private _el: HTMLElement;
  private _headerEl: HTMLElement;
  private _countEl: HTMLElement;
  private _scrollEl: HTMLElement;

  private _members: MemberEntry[] = [];
  private _activeId: string | null = null;
  private _collapsed: Set<PowerLevel> = new Set();

  private _onSelect: MemberSelectCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "member-list";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Room members");

    // ── Header ───────────────────────────────────────────────────────────
    this._headerEl = document.createElement("div");
    this._headerEl.className = "member-list__header";
    this._el.appendChild(this._headerEl);

    const headerTitle = document.createElement("span");
    headerTitle.className = "member-list__header-title";
    headerTitle.textContent = "Members";
    this._headerEl.appendChild(headerTitle);

    this._countEl = document.createElement("span");
    this._countEl.className = "member-list__count";
    this._headerEl.appendChild(this._countEl);

    // ── Scroll area ──────────────────────────────────────────────────────
    this._scrollEl = document.createElement("div");
    this._scrollEl.className = "member-list__scroll";
    this._scrollEl.setAttribute("role", "list");
    this._el.appendChild(this._scrollEl);

    // Drag-to-resize handle at the left edge
    attachResizeHandle(this._el, "--member-list-width", "left", 120, 400);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  /** Header element exposed so callers can wire mobile close behaviour. */
  getHeaderElement(): HTMLElement {
    return this._headerEl;
  }

  onSelect(cb: MemberSelectCallback): void {
    this._onSelect = cb;
  }

  setMembers(members: MemberEntry[]): void {
    this._members = members;
    this._countEl.textContent = `(${members.length})`;
    this._render();
  }

  setActiveMember(id: string): void {
    this._activeId = id;
    this._updateActive();
  }

  /**
   * Update the presence indicator for a specific member in-place.
   * Called when a presence event arrives via sync.
   */
  updateMemberPresence(userId: string, presence: PresenceStatus): void {
    // Update the cached entry so re-renders use the new presence
    const entry = this._members.find((m) => m.userId === userId);
    if (entry) entry.presence = presence;

    // Update the DOM element if currently rendered
    const item = this._scrollEl.querySelector<HTMLElement>(`[data-member-id="${CSS.escape(userId)}"]`);
    if (!item) return;
    const presenceEl = item.querySelector<HTMLElement>(".member-list__presence");
    if (!presenceEl) return;
    // Remove old modifier classes and apply new one
    presenceEl.className = `member-list__presence member-list__presence--${presence}`;
    presenceEl.textContent = PRESENCE_SYMBOL[presence];
    presenceEl.setAttribute("aria-label", presence);
  }

  /**
   * Update the avatar for a specific member in-place (called after async download).
   * Swaps the fallback span for an img without re-rendering the whole list.
   */
  updateMemberAvatar(userId: string, resolvedUrl: string): void {
    // Update the cached entry so re-renders use the resolved URL
    const entry = this._members.find((m) => m.userId === userId);
    if (entry) entry.avatarUrl = resolvedUrl;

    // Swap the avatar element in the DOM if the item is currently rendered
    const item = this._scrollEl.querySelector<HTMLElement>(`[data-member-id="${CSS.escape(userId)}"]`);
    if (!item) return;
    const existing = item.querySelector<HTMLElement>(".member-list__avatar");
    if (!existing) return;
    const name = entry?.name ?? userId;
    const img = document.createElement("img");
    img.className = "member-list__avatar";
    img.src = resolvedUrl;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    if (isAnimatedUrl(resolvedUrl)) img.dataset.gif = "1";
    img.onerror = () => img.replaceWith(_buildFallbackAvatar(name));
    existing.replaceWith(img);
  }

  /** Return the currently focused MemberEntry, or null if no member item is focused. */
  getFocusedMember(): MemberEntry | null {
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || !this._scrollEl.contains(focused)) return null;
    const memberId = focused.dataset.memberId;
    if (!memberId) return null;
    return this._members.find((m) => m.id === memberId) ?? null;
  }

  focusFirst(): void {
    this._scrollEl.querySelector<HTMLElement>(".member-list__item, .member-list__section-header")?.focus();
  }

  navFirst(): void {
    this.focusFirst();
  }

  navLast(): void {
    const items = this._scrollEl.querySelectorAll<HTMLElement>(".member-list__item, .member-list__section-header");
    items[items.length - 1]?.focus();
  }

  navDown(): void {
    const items = Array.from(
      this._scrollEl.querySelectorAll<HTMLElement>(".member-list__item, .member-list__section-header")
    );
    const focused = document.activeElement as HTMLElement;
    const idx = items.indexOf(focused);
    const next = items[idx + 1] ?? items[0];
    next?.focus();
  }

  navUp(): void {
    const items = Array.from(
      this._scrollEl.querySelectorAll<HTMLElement>(".member-list__item, .member-list__section-header")
    );
    const focused = document.activeElement as HTMLElement;
    const idx = items.indexOf(focused);
    const prev = idx <= 0 ? items[items.length - 1] : items[idx - 1];
    prev?.focus();
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _render(): void {
    this._scrollEl.innerHTML = "";

    // Group members by power level
    const groups = new Map<PowerLevel, MemberEntry[]>();
    for (const level of POWER_LEVEL_ORDER) {
      groups.set(level, []);
    }
    for (const member of this._members) {
      groups.get(member.powerLevel)?.push(member);
    }

    for (const level of POWER_LEVEL_ORDER) {
      const levelMembers = groups.get(level);
      if (!levelMembers || levelMembers.length === 0) continue;

      // Section header
      const sectionHeader = document.createElement("div");
      sectionHeader.className = "member-list__section-header";
      sectionHeader.setAttribute("role", "button");
      sectionHeader.setAttribute("tabindex", "0");
      sectionHeader.dataset.level = level;

      const isCollapsed = this._collapsed.has(level);

      const arrow = document.createElement("span");
      arrow.className = "member-list__section-arrow";
      arrow.textContent = isCollapsed ? "▸" : "▾";
      arrow.setAttribute("aria-hidden", "true");
      sectionHeader.appendChild(arrow);

      const label = document.createElement("span");
      label.textContent = `${POWER_LEVEL_LABELS[level]} (${levelMembers.length})`;
      sectionHeader.appendChild(label);

      sectionHeader.addEventListener("click", () => this._toggleSection(level));
      sectionHeader.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this._toggleSection(level);
        }
      });

      this._scrollEl.appendChild(sectionHeader);

      if (!isCollapsed) {
        for (const member of levelMembers) {
          this._scrollEl.appendChild(this._createMemberItem(member));
        }
      }
    }

    this._updateActive();
  }

  private _createMemberItem(member: MemberEntry): HTMLElement {
    const el = document.createElement("div");
    el.className = "member-list__item";
    el.setAttribute("role", "listitem");
    el.setAttribute("tabindex", "0");
    const presenceLabel = member.presence ?? "offline";
    el.setAttribute("aria-label", `${member.name}, ${member.powerLevel}, ${presenceLabel}`);
    el.dataset.memberId = member.id;

    // Avatar
    el.appendChild(_buildAvatarElement(member.name, member.avatarUrl));

    // Presence indicator
    const presenceEl = document.createElement("span");
    presenceEl.className = `member-list__presence member-list__presence--${presenceLabel}`;
    presenceEl.textContent = PRESENCE_SYMBOL[presenceLabel];
    presenceEl.setAttribute("aria-label", presenceLabel);
    el.appendChild(presenceEl);

    // Display name
    const nameEl = document.createElement("span");
    nameEl.className = "member-list__name";
    nameEl.textContent = member.name;
    el.appendChild(nameEl);

    // Power level badge for admin/mod
    if (member.powerLevel !== "member") {
      const badge = document.createElement("span");
      badge.className = `member-list__badge member-list__badge--${member.powerLevel}`;
      badge.textContent = member.powerLevel === "admin" ? "@" : "+";
      badge.setAttribute("aria-label", member.powerLevel);
      el.appendChild(badge);
    }

    el.addEventListener("click", () => this._selectMember(member));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._selectMember(member);
      }
    });

    return el;
  }

  private _selectMember(member: MemberEntry): void {
    this._activeId = member.id;
    this._updateActive();
    this._onSelect?.(member);
  }

  private _toggleSection(level: PowerLevel): void {
    if (this._collapsed.has(level)) {
      this._collapsed.delete(level);
    } else {
      this._collapsed.add(level);
    }
    this._render();
  }

  private _updateActive(): void {
    for (const el of this._scrollEl.querySelectorAll<HTMLElement>(".member-list__item")) {
      const isActive = el.dataset.memberId === this._activeId;
      el.classList.toggle("member-list__item--active", isActive);
    }
  }

  // Navigation (j/k/arrows) is handled by the global keymap via AppState.navDown/navUp.
  // Enter activation is handled by individual item listeners.
}
