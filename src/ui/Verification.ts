// SAS / QR device verification UI

export type VerificationState =
  | "incoming"   // Received a request from another device — show accept prompt
  | "waiting"    // We sent a request; waiting for the other device to respond
  | "comparing"  // Emoji are ready; user compares them
  | "verified"
  | "failed"
  | "cancelled";

export interface SasEmoji {
  /** Unicode emoji glyph */
  emoji: string;
  /** Human-readable description */
  description: string;
}

type VerificationCallback = () => void;

const STATE_MESSAGES: Record<VerificationState, string> = {
  incoming: "Incoming verification request",
  waiting: "Waiting for other device…",
  comparing: "Compare these emoji with the other device:",
  verified: "Verification successful!",
  failed: "Verification failed. The emoji did not match.",
  cancelled: "Verification was cancelled.",
};

/**
 * SAS emoji verification overlay.
 * Displays 7 emoji for comparison with another device, with confirm/deny
 * buttons and progress states.
 */
export class Verification {
  private _el: HTMLElement;
  private _statusEl: HTMLElement;
  private _emojiGridEl: HTMLElement;
  private _actionsEl: HTMLElement;
  private _confirmBtn: HTMLButtonElement;
  private _denyBtn: HTMLButtonElement;
  private _dismissBtn: HTMLButtonElement;

  private _state: VerificationState = "waiting";
  private _sasEmoji: SasEmoji[] = [];
  private _focusedAction: "confirm" | "deny" = "confirm";
  private _incomingSubtitleEl: HTMLElement;

  private _onConfirm: VerificationCallback | null = null;
  private _onDeny: VerificationCallback | null = null;
  private _onDismiss: VerificationCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "verification";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Device verification");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    // ── Title ─────────────────────────────────────────────────────────────
    const title = document.createElement("div");
    title.className = "verification__title";
    title.textContent = "Verify Device";
    this._el.appendChild(title);

    // ── Incoming request subtitle (device / user info) ────────────────────
    this._incomingSubtitleEl = document.createElement("div");
    this._incomingSubtitleEl.className = "verification__incoming-subtitle";
    this._incomingSubtitleEl.style.display = "none";
    this._el.appendChild(this._incomingSubtitleEl);

    // ── Status message ────────────────────────────────────────────────────
    this._statusEl = document.createElement("div");
    this._statusEl.className = "verification__status";
    this._statusEl.setAttribute("role", "status");
    this._statusEl.setAttribute("aria-live", "polite");
    this._statusEl.textContent = STATE_MESSAGES.waiting;
    this._el.appendChild(this._statusEl);

    // ── SAS emoji grid ────────────────────────────────────────────────────
    this._emojiGridEl = document.createElement("div");
    this._emojiGridEl.className = "verification__emoji-grid";
    this._emojiGridEl.setAttribute("role", "list");
    this._emojiGridEl.setAttribute("aria-label", "Verification emoji");
    this._el.appendChild(this._emojiGridEl);

    // ── Action buttons ────────────────────────────────────────────────────
    this._actionsEl = document.createElement("div");
    this._actionsEl.className = "verification__actions";
    this._el.appendChild(this._actionsEl);

    this._confirmBtn = document.createElement("button");
    this._confirmBtn.className = "verification__btn verification__btn--confirm";
    this._confirmBtn.type = "button";
    this._confirmBtn.textContent = "[ They Match ]";
    this._confirmBtn.setAttribute("aria-label", "Confirm — emoji match");
    this._confirmBtn.addEventListener("click", () => {
      this._onConfirm?.();
    });
    this._actionsEl.appendChild(this._confirmBtn);

    this._denyBtn = document.createElement("button");
    this._denyBtn.className = "verification__btn verification__btn--deny";
    this._denyBtn.type = "button";
    this._denyBtn.textContent = "[ They Don't Match ]";
    this._denyBtn.setAttribute("aria-label", "Deny — emoji do not match");
    this._denyBtn.addEventListener("click", () => {
      this._onDeny?.();
    });
    this._actionsEl.appendChild(this._denyBtn);

    // ── Dismiss button (shown after terminal state) ───────────────────────
    this._dismissBtn = document.createElement("button");
    this._dismissBtn.className = "verification__btn verification__btn--dismiss";
    this._dismissBtn.type = "button";
    this._dismissBtn.textContent = "[ Dismiss ]";
    this._dismissBtn.setAttribute("aria-label", "Dismiss verification");
    this._dismissBtn.style.display = "none";
    this._dismissBtn.addEventListener("click", () => {
      this._onDismiss?.();
      this.hide();
    });
    this._actionsEl.appendChild(this._dismissBtn);

    // ── Keyboard handling ─────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onConfirm(cb: VerificationCallback): void {
    this._onConfirm = cb;
  }

  onDeny(cb: VerificationCallback): void {
    this._onDeny = cb;
  }

  onDismiss(cb: VerificationCallback): void {
    this._onDismiss = cb;
  }

  show(): void {
    this._el.style.display = "";
    this._updateFocus();
  }

  hide(): void {
    this._el.style.display = "none";
  }

  setState(state: VerificationState): void {
    this._state = state;
    this._statusEl.textContent = STATE_MESSAGES[state];

    const isTerminal = state === "verified" || state === "failed" || state === "cancelled";
    const isComparing = state === "comparing";
    const isIncoming = state === "incoming";

    // Confirm/deny visible in "comparing" (emoji check) and "incoming" (accept/reject)
    const showActions = isComparing || isIncoming;
    this._confirmBtn.style.display = showActions ? "" : "none";
    this._denyBtn.style.display = showActions ? "" : "none";
    this._dismissBtn.style.display = isTerminal ? "" : "none";

    // Relabel buttons for incoming vs comparing contexts
    if (isIncoming) {
      this._confirmBtn.textContent = "[ Accept ]";
      this._confirmBtn.setAttribute("aria-label", "Accept verification request");
      this._denyBtn.textContent = "[ Reject ]";
      this._denyBtn.setAttribute("aria-label", "Reject verification request");
    } else {
      this._confirmBtn.textContent = "[ They Match ]";
      this._confirmBtn.setAttribute("aria-label", "Confirm — emoji match");
      this._denyBtn.textContent = "[ They Don't Match ]";
      this._denyBtn.setAttribute("aria-label", "Deny — emoji do not match");
    }

    // Show subtitle only for incoming state
    this._incomingSubtitleEl.style.display = isIncoming ? "" : "none";

    // Add state class to root for styling
    const allStates: VerificationState[] = ["incoming", "waiting", "comparing", "verified", "failed", "cancelled"];
    for (const s of allStates) {
      this._el.classList.toggle(`verification--${s}`, state === s);
    }

    if (showActions) {
      this._focusedAction = "confirm";
      this._updateFocus();
    } else if (isTerminal) {
      this._dismissBtn.focus();
    }
  }

  /**
   * Populate the "incoming" subtitle with who is asking to verify.
   * Call this before setState("incoming").
   */
  setIncomingRequest(fromUserId: string, fromDeviceId: string): void {
    this._incomingSubtitleEl.textContent =
      `${fromDeviceId} from ${fromUserId} wants to verify this Quark session.`;
  }

  /** Set the 7 SAS emoji to display for comparison. */
  setSasEmoji(emoji: SasEmoji[]): void {
    this._sasEmoji = emoji.slice(0, 7);
    this._renderEmojiGrid();
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _renderEmojiGrid(): void {
    this._emojiGridEl.innerHTML = "";

    for (const item of this._sasEmoji) {
      const cell = document.createElement("div");
      cell.className = "verification__emoji-cell";
      cell.setAttribute("role", "listitem");

      const glyph = document.createElement("span");
      glyph.className = "verification__emoji-glyph";
      glyph.textContent = item.emoji;
      glyph.setAttribute("aria-hidden", "true");
      cell.appendChild(glyph);

      const desc = document.createElement("span");
      desc.className = "verification__emoji-desc";
      desc.textContent = item.description;
      cell.appendChild(desc);

      this._emojiGridEl.appendChild(cell);
    }
  }

  private _updateFocus(): void {
    if (this._state !== "comparing" && this._state !== "incoming") return;
    if (this._focusedAction === "confirm") {
      this._confirmBtn.focus();
      this._confirmBtn.classList.add("verification__btn--focused");
      this._denyBtn.classList.remove("verification__btn--focused");
    } else {
      this._denyBtn.focus();
      this._denyBtn.classList.add("verification__btn--focused");
      this._confirmBtn.classList.remove("verification__btn--focused");
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        this._onDeny?.();
        this.hide();
        return;

      case "Enter":
        // Handled by button's own keydown via focus
        return;

      case "h":
      case "l":
      case "ArrowLeft":
      case "ArrowRight":
        if (this._state === "comparing" || this._state === "incoming") {
          e.preventDefault();
          this._focusedAction =
            this._focusedAction === "confirm" ? "deny" : "confirm";
          this._updateFocus();
        }
        return;

      case "Tab":
        if (this._state === "comparing" || this._state === "incoming") {
          e.preventDefault();
          this._focusedAction =
            this._focusedAction === "confirm" ? "deny" : "confirm";
          this._updateFocus();
        }
        return;
    }
  }
}
