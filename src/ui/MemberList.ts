// Room member sidebar

export type PresenceStatus = "online" | "unavailable" | "offline";
export type PowerLevel = "admin" | "mod" | "member";

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

    // ── Keyboard handling ────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement {
    return this._el;
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
    el.setAttribute("aria-label", `${member.name}, ${member.powerLevel}`);
    el.dataset.memberId = member.id;

    // Presence indicator
    const presence = member.presence ?? "offline";
    const presenceEl = document.createElement("span");
    presenceEl.className = `member-list__presence member-list__presence--${presence}`;
    presenceEl.textContent = PRESENCE_SYMBOL[presence];
    presenceEl.setAttribute("aria-label", presence);
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

  private _handleKeydown(e: KeyboardEvent): void {
    const items = Array.from(
      this._scrollEl.querySelectorAll<HTMLElement>(".member-list__item")
    );
    const focused = document.activeElement as HTMLElement;
    const currentIndex = items.indexOf(focused);

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      items[currentIndex + 1]?.focus();
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      items[currentIndex - 1]?.focus();
    } else if (e.key === "Enter" && currentIndex >= 0) {
      e.preventDefault();
      const member = this._members.find(
        (m) => m.id === items[currentIndex].dataset.memberId
      );
      if (member) this._selectMember(member);
    }
  }
}
