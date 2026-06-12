// Reply compose preview — shown above the input bar when composing a reply

type DismissCallback = () => void;

export interface ReplyPreviewData {
  /** Matrix event ID of the message being replied to */
  eventId: string;
  /** Display name of the message sender */
  senderName: string;
  /** Plain-text snippet of the quoted message body */
  snippet: string;
}

/**
 * Shows a quoted message preview above the input bar while the user is
 * composing a reply. The caller is responsible for inserting this element
 * into the DOM immediately above the input bar.
 */
export class ReplyPreview {
  private _el: HTMLElement;
  private _senderEl: HTMLElement;
  private _snippetEl: HTMLElement;
  private _closeBtn: HTMLButtonElement;

  private _currentReply: ReplyPreviewData | null = null;
  private _threadMode = false;
  private _onDismiss: DismissCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "reply-preview-bar";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Reply preview");
    this._el.style.display = "none";

    // ── Left gutter / indicator ───────────────────────────────────────────
    const indicator = document.createElement("span");
    indicator.className = "reply-preview-bar__indicator";
    indicator.textContent = "┊";
    indicator.setAttribute("aria-hidden", "true");
    this._el.appendChild(indicator);

    // ── Content area ──────────────────────────────────────────────────────
    const content = document.createElement("div");
    content.className = "reply-preview-bar__content";
    this._el.appendChild(content);

    this._senderEl = document.createElement("span");
    this._senderEl.className = "reply-preview-bar__sender";
    content.appendChild(this._senderEl);

    this._snippetEl = document.createElement("span");
    this._snippetEl.className = "reply-preview-bar__snippet";
    content.appendChild(this._snippetEl);

    // ── Close / cancel button ─────────────────────────────────────────────
    this._closeBtn = document.createElement("button");
    this._closeBtn.className = "reply-preview-bar__close";
    this._closeBtn.type = "button";
    this._closeBtn.textContent = "[x]";
    this._closeBtn.setAttribute("aria-label", "Cancel reply");
    this._closeBtn.addEventListener("click", () => this._dismiss());
    this._el.appendChild(this._closeBtn);

    // ── Keyboard handling ─────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        e.preventDefault();
        this._dismiss();
      }
    });
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onDismiss(cb: DismissCallback): void {
    this._onDismiss = cb;
  }

  /** Display the preview for the given reply target. */
  show(data: ReplyPreviewData): void {
    this._threadMode = false;
    this._currentReply = data;
    this._el.classList.remove("reply-preview-bar--thread");

    this._senderEl.textContent = `<${data.senderName}>`;
    const MAX_SNIPPET = 80;
    const displaySnippet =
      data.snippet.length > MAX_SNIPPET
        ? data.snippet.slice(0, MAX_SNIPPET) + "…"
        : data.snippet;
    this._snippetEl.textContent = displaySnippet;

    this._el.style.display = "";
    this._el.setAttribute("aria-label", `Replying to ${data.senderName}`);
  }

  /** Show an edit-mode banner (sending will edit the original message). */
  showEdit(snippet: string): void {
    this._threadMode = false;
    this._currentReply = null;
    this._el.classList.remove("reply-preview-bar--thread");
    this._el.classList.add("reply-preview-bar--edit");

    this._senderEl.textContent = "Editing";
    const MAX_SNIPPET = 80;
    this._snippetEl.textContent =
      snippet.length > MAX_SNIPPET ? snippet.slice(0, MAX_SNIPPET) + "…" : snippet;

    this._el.style.display = "";
    this._el.setAttribute("aria-label", "Editing message");
  }

  /** Show a thread-mode banner (sending goes to the open inline thread). */
  showThread(snippet: string): void {
    this._threadMode = true;
    this._currentReply = null;
    this._el.classList.add("reply-preview-bar--thread");

    this._senderEl.textContent = "⌥ Thread";
    const MAX_SNIPPET = 80;
    this._snippetEl.textContent =
      snippet.length > MAX_SNIPPET ? snippet.slice(0, MAX_SNIPPET) + "…" : snippet;

    this._el.style.display = "";
    this._el.setAttribute("aria-label", "Replying in thread");
  }

  hide(): void {
    this._el.style.display = "none";
    this._currentReply = null;
    this._threadMode = false;
    this._el.classList.remove("reply-preview-bar--thread");
    this._el.classList.remove("reply-preview-bar--edit");
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  /** True when the bar is showing the thread-send indicator (not a reply). */
  isThreadMode(): boolean {
    return this._threadMode;
  }

  /** Returns the event ID currently being replied to, or null. */
  getCurrentReplyEventId(): string | null {
    return this._currentReply?.eventId ?? null;
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _dismiss(): void {
    this.hide();
    this._onDismiss?.();
  }
}
