// Header bar for the main panel — room name, topic, member count, encryption

// ── Avatar colours (mirrors Timeline.ts palette) ──────────────────────────────
const AVATAR_COLORS = [
  "#00ff41", "#00aaff", "#ff4466", "#ffaa00",
  "#aa44ff", "#00ffcc", "#ff6600", "#44ccff",
];

function _roomColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export interface RoomHeaderData {
  name: string;
  topic?: string;
  memberCount?: number;
  encrypted?: boolean;
  avatarUrl?: string;
}

export class RoomHeader {
  private _el: HTMLElement;
  private _avatarEl: HTMLElement;
  private _nameEl: HTMLElement;
  private _topicEl: HTMLElement;
  private _metaEl: HTMLElement;
  private _memberCountEl: HTMLElement;
  private _encEl: HTMLElement;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "room-header";
    this._el.setAttribute("role", "banner");
    this._el.setAttribute("aria-label", "Room header");

    // ── Avatar (far left) ────────────────────────────────────────────────────
    this._avatarEl = document.createElement("span");
    this._avatarEl.className = "room-header__avatar-fallback";
    this._avatarEl.setAttribute("aria-hidden", "true");
    this._el.appendChild(this._avatarEl);

    // ── Left section: room name + topic ──────────────────────────────────────
    const left = document.createElement("div");
    left.className = "room-header__left";

    this._nameEl = document.createElement("span");
    this._nameEl.className = "room-header__name";
    this._nameEl.setAttribute("aria-label", "Room name");
    this._nameEl.textContent = "—";
    left.appendChild(this._nameEl);

    const topicSep = document.createElement("span");
    topicSep.className = "room-header__sep";
    topicSep.setAttribute("aria-hidden", "true");
    topicSep.textContent = " · ";
    left.appendChild(topicSep);

    this._topicEl = document.createElement("span");
    this._topicEl.className = "room-header__topic";
    this._topicEl.setAttribute("aria-label", "Room topic");
    this._topicEl.textContent = "";
    left.appendChild(this._topicEl);

    this._el.appendChild(left);

    // ── Right section: member count + encryption ──────────────────────────────
    this._metaEl = document.createElement("div");
    this._metaEl.className = "room-header__meta";

    this._memberCountEl = document.createElement("span");
    this._memberCountEl.className = "room-header__members";
    this._memberCountEl.setAttribute("aria-label", "Member count");
    this._metaEl.appendChild(this._memberCountEl);

    const metaSep = document.createElement("span");
    metaSep.className = "room-header__sep";
    metaSep.setAttribute("aria-hidden", "true");
    metaSep.textContent = " │ ";
    this._metaEl.appendChild(metaSep);

    this._encEl = document.createElement("span");
    this._encEl.className = "room-header__encryption";
    this._encEl.setAttribute("aria-label", "Encryption status");
    this._metaEl.appendChild(this._encEl);

    this._el.appendChild(this._metaEl);

    // Set a blank default state
    this._applyData({ name: "" });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getElement(): HTMLElement {
    return this._el;
  }

  /**
   * Update all header fields at once.
   * Pass undefined for fields that should not change.
   */
  setRoom(
    name: string,
    topic?: string,
    memberCount?: number,
    encrypted?: boolean,
    avatarUrl?: string
  ): void {
    this._applyData({ name, topic, memberCount, encrypted, avatarUrl });
  }

  /**
   * Swap in a resolved avatar URL after an async download completes.
   * Replaces the fallback letter with the actual image without re-rendering
   * the whole header.
   */
  setAvatarUrl(url: string): void {
    const img = document.createElement("img");
    img.className = "room-header__avatar";
    img.src = url;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.onerror = () => { /* keep existing element on load failure */ };
    this._avatarEl.replaceWith(img);
    this._avatarEl = img;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _applyData(data: RoomHeaderData): void {
    // Avatar
    const displayName = data.name || "—";
    const color = _roomColor(displayName);
    if (data.avatarUrl) {
      const img = document.createElement("img");
      img.className = "room-header__avatar";
      img.src = data.avatarUrl;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.onerror = () => {
        const fallback = this._buildFallback(displayName, color);
        img.replaceWith(fallback);
        this._avatarEl = fallback;
      };
      this._avatarEl.replaceWith(img);
      this._avatarEl = img;
    } else {
      // Always rebuild the fallback so the initial letter stays current
      const fallback = this._buildFallback(displayName, color);
      this._avatarEl.replaceWith(fallback);
      this._avatarEl = fallback;
    }

    // Name
    this._nameEl.textContent = displayName;

    // Topic
    if (data.topic) {
      this._topicEl.textContent = data.topic;
      this._topicEl.style.display = "";
      this._topicEl.previousElementSibling?.removeAttribute("hidden");
    } else {
      this._topicEl.textContent = "";
      this._topicEl.style.display = "none";
      this._topicEl.previousElementSibling?.setAttribute("hidden", "");
    }

    // Member count
    if (data.memberCount !== undefined) {
      this._memberCountEl.textContent = `${data.memberCount} member${data.memberCount === 1 ? "" : "s"}`;
      this._memberCountEl.setAttribute(
        "aria-label",
        `${data.memberCount} member${data.memberCount === 1 ? "" : "s"}`
      );
    } else {
      this._memberCountEl.textContent = "";
    }

    // Encryption
    const encrypted = data.encrypted ?? false;
    this._encEl.textContent = encrypted ? "🔒 encrypted" : "🔓 unencrypted";
    this._encEl.setAttribute(
      "aria-label",
      encrypted ? "End-to-end encrypted" : "Not encrypted"
    );
    this._encEl.classList.toggle("room-header__encryption--on", encrypted);
    this._encEl.classList.toggle("room-header__encryption--off", !encrypted);
  }

  private _buildFallback(name: string, color: string): HTMLElement {
    const initial = (name.startsWith("#") || name.startsWith("!"))
      ? (name[1] ?? name[0]).toUpperCase()
      : name[0]?.toUpperCase() ?? "?";
    const el = document.createElement("span");
    el.className = "room-header__avatar-fallback";
    el.textContent = initial === "—" ? "#" : initial;
    el.style.color = color;
    el.style.borderColor = color;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}
