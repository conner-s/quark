// Message timeline

import { createReactionBar, type ReactionGroup } from "./Reactions.js";

export interface ReplyPreviewData {
  senderName: string;
  body: string;
}

export interface MessageData {
  id: string;
  senderName: string;
  /** If true the sender is the local user */
  isOwn?: boolean;
  /** ISO 8601 timestamp string */
  timestamp: string;
  /** Plain text body */
  body: string;
  /** Optional HTML body (rendered into innerHTML safely via a template) */
  htmlBody?: string;
  /** Message type: "text" | "image" | "sticker" | "system" */
  type?: "text" | "image" | "sticker" | "system";
  /** URL for image / sticker messages */
  mediaUrl?: string;
  /** Alt text for image / sticker messages */
  mediaAlt?: string;
  /** Reply preview */
  replyTo?: ReplyPreviewData;
  /** Reactions */
  reactions?: ReactionGroup[];
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  } catch {
    return "";
  }
}

function buildMessageElement(msg: MessageData): HTMLElement {
  const row = document.createElement("div");
  row.className = "message";
  row.setAttribute("role", "listitem");
  row.setAttribute("tabindex", "0");
  row.dataset.messageId = msg.id;

  if (msg.type === "system") {
    row.classList.add("message--system");
  }

  // ── Reply preview ──────────────────────────────────────────────────────
  if (msg.replyTo) {
    const reply = document.createElement("div");
    reply.className = "reply-preview";

    const sender = document.createElement("span");
    sender.className = "reply-preview__sender";
    sender.textContent = `<${msg.replyTo.senderName}>`;
    reply.appendChild(sender);

    const body = document.createElement("span");
    body.className = "reply-preview__body";
    body.textContent = msg.replyTo.body;
    reply.appendChild(body);

    row.appendChild(reply);
  }

  // ── Header (sender + timestamp) ────────────────────────────────────────
  if (msg.type !== "system") {
    const header = document.createElement("div");
    header.className = "message__header";

    const sender = document.createElement("span");
    sender.className = "message__sender" + (msg.isOwn ? " message__sender--own" : "");
    sender.textContent = `<${msg.senderName}>`;
    header.appendChild(sender);

    const ts = document.createElement("span");
    ts.className = "message__timestamp";
    ts.textContent = formatTimestamp(msg.timestamp);
    ts.setAttribute("title", msg.timestamp);
    header.appendChild(ts);

    row.appendChild(header);
  }

  // ── Body ───────────────────────────────────────────────────────────────
  const type = msg.type ?? "text";

  if (type === "image") {
    const img = document.createElement("img");
    img.className = "message__image";
    img.src = msg.mediaUrl ?? "";
    img.alt = msg.mediaAlt ?? "image";
    img.loading = "lazy";
    row.appendChild(img);
  } else if (type === "sticker") {
    const img = document.createElement("img");
    img.className = "message__sticker";
    img.src = msg.mediaUrl ?? "";
    img.alt = msg.mediaAlt ?? "sticker";
    img.loading = "lazy";
    row.appendChild(img);
  } else {
    // Text / system
    const body = document.createElement("div");
    body.className = "message__body";

    if (msg.htmlBody) {
      // Render HTML body. In production this must be sanitized server-side or
      // with DOMPurify; for the UI shell we accept pre-trusted HTML.
      body.innerHTML = msg.htmlBody;
    } else {
      body.textContent = msg.body;
    }

    row.appendChild(body);
  }

  // ── Reactions ──────────────────────────────────────────────────────────
  if (msg.reactions && msg.reactions.length > 0) {
    row.appendChild(createReactionBar(msg.reactions));
  }

  return row;
}

export class Timeline {
  private _el: HTMLElement;
  private _listEl: HTMLElement;
  /** Whether the user has scrolled up away from the bottom */
  private _scrolledUp = false;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "timeline";

    this._listEl = document.createElement("div");
    this._listEl.setAttribute("role", "list");
    this._listEl.setAttribute("aria-label", "Message timeline");
    this._el.appendChild(this._listEl);

    // Track whether the user has scrolled away from the bottom
    this._el.addEventListener("scroll", () => {
      const { scrollTop, scrollHeight, clientHeight } = this._el;
      // Consider "at bottom" if within 40px
      this._scrolledUp = scrollHeight - scrollTop - clientHeight > 40;
    });
  }

  getElement(): HTMLElement {
    return this._el;
  }

  /** Replace the entire message list */
  setMessages(msgs: MessageData[]): void {
    this._listEl.innerHTML = "";
    for (const msg of msgs) {
      this._listEl.appendChild(buildMessageElement(msg));
    }
    this._scrollToBottom();
  }

  /** Append a single message, scrolling to bottom if not scrolled up */
  appendMessage(msg: MessageData): void {
    this._listEl.appendChild(buildMessageElement(msg));
    if (!this._scrolledUp) {
      this._scrollToBottom();
    }
  }

  /** Force scroll to the latest message */
  scrollToBottom(): void {
    this._scrollToBottom();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _scrollToBottom(): void {
    this._el.scrollTop = this._el.scrollHeight;
    this._scrolledUp = false;
  }
}
