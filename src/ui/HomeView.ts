// Home view — a WaraWara-Plaza-style canvas that replaces the room list +
// timeline while the Home pseudo-space is selected (desktop only). DM
// partners' avatars drift slowly around the canvas, each with a chat bubble
// showing their latest message; the own profile sits fixed on the left with
// inline status editing and avatar upload.
//
// Pure DOM component: data arrives via show()/update*() from
// app/actions/home.ts, interactions leave via the handlers. Drift animation
// is CSS-only (one shared keyframe over per-item custom properties) — no JS
// animation loop, GPU-friendly transforms, and positions are deterministic
// per room so the layout is stable across refreshes.

export interface HomeFloater {
  roomId: string;
  name: string;
  dmUserId: string | null;
  /** Resolved data/blob URL (not mxc) — null renders an initial tile. */
  avatarUrl: string | null;
  presence: "online" | "unavailable" | "offline";
  /** Pre-rendered single-line preview ("🔒 encrypted", "📷 image", text…). */
  snippet: string;
  /** The partner's presence status message — shown instead of the snippet
   *  while the chat is caught up (no unreads). Null when unset/unknown. */
  statusMessage: string | null;
  lastTs: number | null;
  unreadCount: number;
}

export interface HomeOwnProfile {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  statusMessage: string | null;
}

export interface HomeViewHandlers {
  onOpenRoom: (roomId: string) => void;
  onSaveStatus: (status: string) => void;
  onChangeAvatar: () => void;
}

/** Compact relative-age label for bubble headers ("now", "5m", "3h", "2d"). */
export function relativeAge(ts: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - ts);
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Small deterministic hash for stable per-room slot jitter/timing. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class HomeView {
  private _el: HTMLElement;
  private _profileEl: HTMLElement;
  private _canvasEl: HTMLElement;
  private _avatarEl: HTMLElement;
  private _nameEl: HTMLElement;
  private _mxidEl: HTMLElement;
  private _statusInput: HTMLInputElement;
  private _handlers: HomeViewHandlers | null = null;
  private _floaters: HomeFloater[] = [];
  private _lastSavedStatus = "";

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "home-view";
    this._el.style.display = "none";

    // ── Own profile card (fixed left) ─────────────────────────────────────
    this._profileEl = document.createElement("div");
    this._profileEl.className = "home-view__profile";

    this._avatarEl = document.createElement("div");
    this._avatarEl.className = "home-view__profile-avatar";
    this._profileEl.appendChild(this._avatarEl);

    this._nameEl = document.createElement("div");
    this._nameEl.className = "home-view__profile-name";
    this._profileEl.appendChild(this._nameEl);

    this._mxidEl = document.createElement("div");
    this._mxidEl.className = "home-view__profile-mxid";
    this._profileEl.appendChild(this._mxidEl);

    const statusLabel = document.createElement("label");
    statusLabel.className = "home-view__profile-status-label";
    statusLabel.textContent = "status";
    this._statusInput = document.createElement("input");
    this._statusInput.type = "text";
    this._statusInput.className = "home-view__profile-status";
    this._statusInput.placeholder = "What's up?";
    this._statusInput.maxLength = 256;
    this._statusInput.setAttribute("autocomplete", "off");
    // Save on Enter or blur — but only when actually changed, so tabbing
    // through the card doesn't spam presence updates.
    const save = () => {
      const text = this._statusInput.value.trim();
      if (text === this._lastSavedStatus) return;
      this._lastSavedStatus = text;
      this._handlers?.onSaveStatus(text);
    };
    this._statusInput.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep vim keys out of the input
      if (e.key === "Enter") {
        e.preventDefault();
        save();
        this._statusInput.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this._statusInput.value = this._lastSavedStatus;
        this._statusInput.blur();
      }
    });
    this._statusInput.addEventListener("blur", save);
    statusLabel.appendChild(this._statusInput);
    this._profileEl.appendChild(statusLabel);

    const avatarBtn = document.createElement("button");
    avatarBtn.type = "button";
    avatarBtn.className = "home-view__profile-btn";
    avatarBtn.textContent = "[change avatar]";
    avatarBtn.addEventListener("click", () => this._handlers?.onChangeAvatar());
    this._profileEl.appendChild(avatarBtn);

    this._el.appendChild(this._profileEl);

    // ── Floating DM canvas ─────────────────────────────────────────────────
    this._canvasEl = document.createElement("div");
    this._canvasEl.className = "home-view__canvas";
    this._canvasEl.setAttribute("role", "listbox");
    this._canvasEl.setAttribute("aria-label", "Direct messages");
    this._el.appendChild(this._canvasEl);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  setHandlers(handlers: HomeViewHandlers): void {
    this._handlers = handlers;
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  show(own: HomeOwnProfile, floaters: HomeFloater[]): void {
    this.updateOwnProfile(own);
    this.setFloaters(floaters);
    this._el.style.display = "";
  }

  hide(): void {
    this._el.style.display = "none";
  }

  updateOwnProfile(own: Partial<HomeOwnProfile>): void {
    if (own.userId !== undefined) this._mxidEl.textContent = own.userId;
    if (own.displayName !== undefined || own.userId !== undefined) {
      this._nameEl.textContent =
        own.displayName ?? this._nameEl.textContent ?? own.userId ?? "";
    }
    if (own.avatarUrl !== undefined) {
      this._renderAvatar(this._avatarEl, own.avatarUrl, this._nameEl.textContent ?? "?");
    }
    if (own.statusMessage !== undefined) {
      this._lastSavedStatus = own.statusMessage ?? "";
      this._statusInput.value = this._lastSavedStatus;
    }
  }

  /** Replace the full floater set (initial load and top-N reorders). */
  setFloaters(floaters: HomeFloater[]): void {
    this._floaters = floaters;
    this._canvasEl.innerHTML = "";

    if (floaters.length === 0) {
      const empty = document.createElement("div");
      empty.className = "home-view__empty";
      empty.textContent = "┌─ no direct messages ─┐\n  start one with :directory\n  or invite a friend\n└──────────────────────┘";
      this._canvasEl.appendChild(empty);
      return;
    }

    floaters.forEach((f, i) => {
      this._canvasEl.appendChild(this._createFloater(f, i, floaters.length));
    });
  }

  /**
   * Update a floater's bubble in place (live message). No-op if absent.
   * Partner messages also bump the unread badge — the chat is no longer
   * caught up, which flips a status-message bubble back to the preview.
   */
  updateBubble(roomId: string, snippet: string, ts: number, fromPartner: boolean): void {
    const item = this._floaterEl(roomId);
    const f = this._floaters.find((x) => x.roomId === roomId);
    if (!item || !f) return;
    f.snippet = snippet;
    f.lastTs = ts;
    if (fromPartner) {
      f.unreadCount += 1;
      this._renderBadge(item, f.unreadCount);
    }
    this._renderBubbleText(item, f);
    const age = item.querySelector(".home-view__bubble-age");
    if (age) age.textContent = relativeAge(ts);
  }

  /** Update a partner's status message by user id (live presence / fetch). */
  updateStatusMessage(userId: string, statusMessage: string | null): void {
    for (const f of this._floaters) {
      if (f.dmUserId !== userId) continue;
      f.statusMessage = statusMessage;
      const item = this._floaterEl(f.roomId);
      if (item) this._renderBubbleText(item, f);
    }
  }

  updatePresence(userId: string, presence: "online" | "unavailable" | "offline"): void {
    const items = this._canvasEl.querySelectorAll<HTMLElement>(
      `[data-dm-user-id="${CSS.escape(userId)}"]`,
    );
    for (const item of items) {
      const dot = item.querySelector<HTMLElement>(".home-view__presence");
      if (dot) {
        dot.className = `home-view__presence home-view__presence--${presence}`;
        dot.setAttribute("aria-label", presence);
      }
    }
  }

  /** Paint a floater's avatar once its media resolves. */
  updateFloaterAvatar(roomId: string, url: string): void {
    const item = this._floaterEl(roomId);
    const avatar = item?.querySelector<HTMLElement>(".home-view__float-avatar");
    const f = this._floaters.find((x) => x.roomId === roomId);
    if (avatar && f) {
      f.avatarUrl = url;
      this._renderAvatar(avatar, url, f.name);
    }
  }

  /** Room IDs currently displayed, in slot order. */
  floaterRoomIds(): string[] {
    return this._floaters.map((f) => f.roomId);
  }

  // ── Panel navigation (j/k cycle, Enter opens) ───────────────────────────

  navNext(): void {
    this._moveFocus(1);
  }

  navPrev(): void {
    this._moveFocus(-1);
  }

  selectFocused(): void {
    const focused = document.activeElement as HTMLElement | null;
    const roomId = focused?.closest<HTMLElement>(".home-view__float")?.dataset.roomId;
    if (roomId) this._handlers?.onOpenRoom(roomId);
  }

  focusActive(): void {
    const first = this._canvasEl.querySelector<HTMLElement>(".home-view__float");
    first?.focus({ preventScroll: true });
  }

  private _moveFocus(step: number): void {
    const items = Array.from(
      this._canvasEl.querySelectorAll<HTMLElement>(".home-view__float"),
    );
    if (items.length === 0) return;
    const focused = document.activeElement as HTMLElement | null;
    const idx = items.indexOf(focused?.closest(".home-view__float") as HTMLElement);
    const next = idx < 0 ? 0 : (idx + step + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  // ── Private rendering ────────────────────────────────────────────────────

  private _floaterEl(roomId: string): HTMLElement | null {
    return this._canvasEl.querySelector<HTMLElement>(
      `[data-room-id="${CSS.escape(roomId)}"]`,
    );
  }

  /**
   * What the bubble shows: the partner's status message while the chat is
   * caught up (no unreads) and a status is set, otherwise the latest-message
   * preview.
   */
  private _bubbleContent(f: HomeFloater): { text: string; isStatus: boolean } {
    const status = f.statusMessage?.trim();
    if (status && f.unreadCount === 0) return { text: status, isStatus: true };
    return { text: f.snippet, isStatus: false };
  }

  private _renderBubbleText(item: HTMLElement, f: HomeFloater): void {
    const textEl = item.querySelector<HTMLElement>(".home-view__bubble-text");
    if (!textEl) return;
    const { text, isStatus } = this._bubbleContent(f);
    textEl.textContent = text;
    textEl.classList.toggle("home-view__bubble-text--status", isStatus);
    item.setAttribute("aria-label", `${f.name}: ${text}`);
  }

  /** Add/update/remove the unread badge on a floater's avatar. */
  private _renderBadge(item: HTMLElement, count: number): void {
    const wrap = item.querySelector<HTMLElement>(".home-view__float-avatar-wrap");
    if (!wrap) return;
    let badge = wrap.querySelector<HTMLElement>(".home-view__float-badge");
    if (count <= 0) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "home-view__float-badge";
      wrap.appendChild(badge);
    }
    badge.textContent = count > 9 ? "9+" : String(count);
  }

  private _renderAvatar(el: HTMLElement, url: string | null, name: string): void {
    el.innerHTML = "";
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.draggable = false;
      el.appendChild(img);
    } else {
      const initial = document.createElement("span");
      initial.className = "home-view__avatar-initial";
      initial.textContent = (name.trim()[0] ?? "?").toUpperCase();
      el.appendChild(initial);
    }
  }

  /**
   * Deterministic slot on two concentric ellipses around the canvas centre,
   * jittered by a hash of the room id so each DM keeps its spot across
   * refreshes. Even indices take the outer ring, odd the inner — neighbours
   * in recency order land on different rings, which keeps bubbles apart
   * without any collision physics.
   */
  private _createFloater(f: HomeFloater, index: number, total: number): HTMLElement {
    const el = document.createElement("div");
    el.className = "home-view__float";
    el.setAttribute("role", "option");
    el.setAttribute("tabindex", "0");
    el.dataset.roomId = f.roomId;
    if (f.dmUserId) el.dataset.dmUserId = f.dmUserId;

    const h = hash32(f.roomId);
    const ringCount = Math.ceil(total / 2);
    const ringIndex = Math.floor(index / 2);
    const outer = index % 2 === 0;
    // Spread each ring's items evenly, offset the inner ring by half a step
    // so rings interleave; ±9° of stable per-room jitter breaks the grid feel.
    const baseAngle = (ringIndex / Math.max(1, ringCount)) * 2 * Math.PI;
    const ringOffset = outer ? 0 : Math.PI / Math.max(1, ringCount);
    const jitter = ((h % 100) / 100 - 0.5) * 0.31;
    const angle = baseAngle + ringOffset + jitter;
    const rx = outer ? 38 : 21;
    const ry = outer ? 34 : 17;
    const x = 50 + rx * Math.cos(angle);
    const y = 50 + ry * Math.sin(angle);

    el.style.setProperty("--x", `${x.toFixed(2)}%`);
    el.style.setProperty("--y", `${y.toFixed(2)}%`);
    el.style.setProperty("--drift-dur", `${18 + (h % 13)}s`);
    el.style.setProperty("--drift-delay", `-${h % 17}s`);
    el.style.setProperty("--drift-rx", `${8 + (h % 9)}px`);
    el.style.setProperty("--drift-ry", `${6 + ((h >> 4) % 8)}px`);

    // Avatar circle + presence dot
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "home-view__float-avatar-wrap";
    const avatar = document.createElement("div");
    avatar.className = "home-view__float-avatar";
    this._renderAvatar(avatar, f.avatarUrl, f.name);
    avatarWrap.appendChild(avatar);
    const dot = document.createElement("span");
    dot.className = `home-view__presence home-view__presence--${f.presence}`;
    dot.setAttribute("aria-label", f.presence);
    avatarWrap.appendChild(dot);
    el.appendChild(avatarWrap);
    this._renderBadge(el, f.unreadCount);

    // Chat bubble
    const bubble = document.createElement("div");
    bubble.className = "home-view__bubble";
    const header = document.createElement("div");
    header.className = "home-view__bubble-header";
    const nameEl = document.createElement("span");
    nameEl.className = "home-view__bubble-name";
    nameEl.textContent = f.name;
    header.appendChild(nameEl);
    const ageEl = document.createElement("span");
    ageEl.className = "home-view__bubble-age";
    ageEl.textContent = f.lastTs ? relativeAge(f.lastTs) : "";
    header.appendChild(ageEl);
    bubble.appendChild(header);
    const text = document.createElement("div");
    text.className = "home-view__bubble-text";
    bubble.appendChild(text);
    el.appendChild(bubble);
    this._renderBubbleText(el, f);

    el.addEventListener("click", () => this._handlers?.onOpenRoom(f.roomId));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._handlers?.onOpenRoom(f.roomId);
      }
    });

    return el;
  }
}
