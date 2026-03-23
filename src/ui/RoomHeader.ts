// Header bar for the main panel — room name, topic, member count, encryption

export interface RoomHeaderData {
  name: string;
  topic?: string;
  memberCount?: number;
  encrypted?: boolean;
}

export class RoomHeader {
  private _el: HTMLElement;
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
    encrypted?: boolean
  ): void {
    this._applyData({ name, topic, memberCount, encrypted });
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _applyData(data: RoomHeaderData): void {
    // Name
    this._nameEl.textContent = data.name || "—";

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
}
