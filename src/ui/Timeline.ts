// Message timeline

import { createReactionBar, updateReactionBar, type ReactionGroup } from "./Reactions.js";
import { invoke } from "../ipc/invoke.js";
import type { ThreadMessageData } from "./ThreadView.js";
import { isAnimatedUrl } from "../app/animated_urls.js";

// ── URL linkification ─────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * Render plain text with http/https URLs as clickable anchor elements.
 * Splits the text on URL boundaries and appends text nodes + <a> tags.
 */
function appendLinkifiedText(container: HTMLElement, text: string): void {
  let last = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > last) {
      container.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    const url = match[0].replace(/[.,;:!?]+$/, ""); // strip trailing punctuation
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = url;
    a.className = "message__link";
    a.title = url;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      // Only open safe http/https URLs (already guaranteed by regex, but double-check)
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void invoke("plugin:shell|open", { path: url }).catch(() => {
          window.open(url, "_blank", "noopener,noreferrer");
        });
      }
    });
    container.appendChild(a);
    last = match.index + url.length;
  }
  if (last < text.length) {
    container.appendChild(document.createTextNode(text.slice(last)));
  }
}

// ── URL preview cards ─────────────────────────────────────────────────────────

/** In-memory cache: url → preview data (null = fetched but no preview available) */
const _urlPreviewCache = new Map<string, { title: string | null; description: string | null; imageUrl: string | null; siteName: string | null } | null>();

/**
 * Extracts the first http/https URL from a text string.
 * Returns null if none found.
 */
function extractFirstUrl(text: string): string | null {
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  const m = re.exec(text);
  if (!m) return null;
  return m[0].replace(/[.,;:!?]+$/, "");
}

/**
 * Builds a URL preview card element. The image (if present) is loaded async.
 */
function buildUrlPreviewCard(preview: { title: string | null; description: string | null; imageUrl: string | null; siteName: string | null }): HTMLElement {
  const card = document.createElement("div");
  card.className = "message__url-preview";

  if (preview.imageUrl) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "message__url-preview-img-wrap";
    const img = document.createElement("img");
    img.className = "message__url-preview-img";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.addEventListener("error", () => { imgWrap.style.display = "none"; });
    imgWrap.appendChild(img);
    card.appendChild(imgWrap);

    if (preview.imageUrl.startsWith("mxc://")) {
      // Matrix-proxied image — download via IPC and convert to data URL
      void invoke<{ data_base64: string; mime_type: string }>("download_media", {
        mxcUrl: preview.imageUrl,
        thumbnail: true,
        thumbnailWidth: 80,
        thumbnailHeight: 80,
        encryptionInfo: null,
      }).then((dl) => {
        img.src = `data:${dl.mime_type};base64,${dl.data_base64}`;
      }).catch(() => { imgWrap.style.display = "none"; });
    } else {
      // Plain https:// URL from direct-fetch fallback — set directly; CSP is null
      img.src = preview.imageUrl;
    }
  }

  const meta = document.createElement("div");
  meta.className = "message__url-preview-meta";

  if (preview.siteName) {
    const site = document.createElement("div");
    site.className = "message__url-preview-site";
    site.textContent = preview.siteName;
    meta.appendChild(site);
  }

  if (preview.title) {
    const title = document.createElement("div");
    title.className = "message__url-preview-title";
    title.textContent = preview.title;
    meta.appendChild(title);
  }

  if (preview.description) {
    const desc = document.createElement("div");
    desc.className = "message__url-preview-desc";
    desc.textContent = preview.description;
    meta.appendChild(desc);
  }

  card.appendChild(meta);
  return card;
}

/**
 * Asynchronously fetch a URL preview and append the card to `container`.
 * Uses the module-level cache to avoid duplicate fetches.
 */
function attachUrlPreview(url: string, container: HTMLElement): void {
  if (_urlPreviewCache.has(url)) {
    const cached = _urlPreviewCache.get(url)!;
    if (cached !== null) container.appendChild(buildUrlPreviewCard(cached));
    return;
  }
  void invoke<{ title: string | null; description: string | null; image_url: string | null; site_name: string | null } | null>("get_url_preview", { url })
    .then((preview) => {
      if (!preview) {
        _urlPreviewCache.set(url, null);
        return;
      }
      const data = { title: preview.title, description: preview.description, imageUrl: preview.image_url, siteName: preview.site_name };
      _urlPreviewCache.set(url, data);
      container.appendChild(buildUrlPreviewCard(data));
    })
    .catch((err) => {
      console.warn("[url-preview] failed for", url, err);
      _urlPreviewCache.set(url, null);
    });
}

// ── Avatar generation ─────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#00ff41", "#00aaff", "#ff4466", "#ffaa00",
  "#aa44ff", "#00ffcc", "#ff6600", "#44ccff",
];

function senderColor(sender: string): string {
  let h = 0;
  for (let i = 0; i < sender.length; i++) h = (h * 31 + sender.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function buildFallbackAvatar(sender: string): HTMLElement {
  const color = senderColor(sender);
  const initial = (sender.startsWith("@") ? sender[1] : sender[0]).toUpperCase();
  const el = document.createElement("span");
  el.className = "message-group__avatar-fallback";
  el.textContent = initial;
  el.style.color = color;
  el.style.border = `1px solid ${color}`;
  el.style.opacity = "0.85";
  el.setAttribute("aria-hidden", "true");
  return el;
}

function buildAvatarElement(sender: string, avatarUrl?: string): HTMLElement {
  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "message-group__avatar";
    img.src = avatarUrl;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    if (isAnimatedUrl(avatarUrl)) img.dataset.gif = "1";
    img.onerror = () => img.replaceWith(buildFallbackAvatar(sender));
    return img;
  }
  return buildFallbackAvatar(sender);
}

export interface ReplyPreviewData {
  /** Matrix event ID of the message being replied to */
  eventId: string;
  senderName: string;
  body: string;
}

export interface MessageData {
  id: string;
  senderName: string;
  /** Matrix user ID of the sender — used for avatar lookup; falls back to senderName */
  senderId?: string;
  /** URL for the sender's avatar image (mxc:// resolved to https://) */
  senderAvatarUrl?: string;
  /** If true the sender is the local user */
  isOwn?: boolean;
  /** ISO 8601 timestamp string */
  timestamp: string;
  /** Plain text body */
  body: string;
  /** Optional HTML body (rendered into innerHTML safely via a template) */
  htmlBody?: string;
  /** Message type: "text" | "image" | "video" | "sticker" | "file" | "system" */
  type?: "text" | "image" | "video" | "sticker" | "file" | "system";
  /** URL for image / sticker messages (mxc:// for video) */
  mediaUrl?: string;
  /** Alt text for image / sticker messages; filename for video */
  mediaAlt?: string;
  /** MIME type for media messages (used for video canPlayType check) */
  mediaMimeType?: string;
  /** JSON-serialized EncryptedFile for E2EE video/audio; absent for plain media */
  mediaEncryptionInfo?: string;
  /** mxc:// URL of the video thumbnail image */
  mediaThumbnailUrl?: string;
  /** JSON-serialized EncryptedFile for E2EE video thumbnail */
  mediaThumbnailEncryptionInfo?: string;
  /** Reply preview */
  replyTo?: ReplyPreviewData;
  /** Reactions */
  reactions?: ReactionGroup[];
  /** If true, this message has thread replies — show a thread indicator */
  isThreadRoot?: boolean;
  /** Number of thread replies (shown in the indicator) */
  threadReplyCount?: number;
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

const TIME_SEPARATOR_GAP_MS = 30 * 60 * 1000; // 30 minutes

interface TimeSeparator {
  type: "time-separator";
  timestamp: string;
}

function formatSeparatorLabel(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const h = date.getHours();
    const m = date.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const hour12 = ((h % 12) || 12).toString();
    const time = `${hour12}:${m} ${ampm}`;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (msgDay.getTime() === today.getTime()) return `Today at ${time}`;
    if (msgDay.getTime() === yesterday.getTime()) return `Yesterday at ${time}`;

    const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
    const dateStr = date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
    return `${weekday}, ${dateStr} at ${time}`;
  } catch {
    return "";
  }
}

function buildTimeSeparator(isoString: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "time-separator";
  el.setAttribute("role", "separator");
  const label = formatSeparatorLabel(isoString);
  el.textContent = label;
  return el;
}

/**
 * Build a click-to-play affordance for video messages.
 * Dispatches `quark:open-video` when activated so actions.ts can decide
 * whether to play inline (GStreamer available) or open externally.
 * If `thumbnailMxcUrl` is provided the thumbnail is loaded async and shown.
 */
function buildVideoAffordance(
  mxcUrl?: string,
  filename?: string,
  mimeType?: string,
  encryptionInfo?: string,
  thumbnailMxcUrl?: string,
  thumbnailEncryptionInfo?: string,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "message__video-affordance";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.title = "Click to play video";

  if (thumbnailMxcUrl) {
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "message__video-affordance-thumb";
    const thumbImg = document.createElement("img");
    thumbImg.className = "message__video-affordance-thumb-img";
    thumbImg.alt = "";
    thumbImg.setAttribute("aria-hidden", "true");
    thumbWrap.appendChild(thumbImg);

    // Overlay play icon on thumbnail
    const overlay = document.createElement("span");
    overlay.className = "message__video-affordance-thumb-overlay";
    overlay.textContent = "▶";
    overlay.setAttribute("aria-hidden", "true");
    thumbWrap.appendChild(overlay);

    el.appendChild(thumbWrap);

    // Load thumbnail async
    void invoke<{ data_base64: string; mime_type: string }>("download_media", {
      mxcUrl: thumbnailMxcUrl,
      thumbnail: true,
      thumbnailWidth: 160,
      thumbnailHeight: 90,
      encryptionInfo: thumbnailEncryptionInfo ?? null,
    }).then((dl) => {
      thumbImg.src = `data:${dl.mime_type};base64,${dl.data_base64}`;
    }).catch(() => { /* thumbnail failed to load — affordance still works */ });
  } else {
    const icon = document.createElement("span");
    icon.className = "message__video-affordance-icon";
    icon.textContent = "▶";
    icon.setAttribute("aria-hidden", "true");
    el.appendChild(icon);
  }

  const label = document.createElement("span");
  label.className = "message__video-affordance-label";
  label.textContent = filename || "video";
  el.appendChild(label);

  const activate = () => {
    el.dispatchEvent(new CustomEvent("quark:open-video", {
      bubbles: true,
      detail: { mxcUrl, filename, mimeType, encryptionInfo },
    }));
  };
  el.addEventListener("click", activate);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
  });

  return el;
}

function buildFileAffordance(
  mxcUrl?: string,
  filename?: string,
  mimeType?: string,
  encryptionInfo?: string,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "message__file-affordance";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.title = "Click to open file";

  const icon = document.createElement("span");
  icon.className = "message__file-affordance-icon";
  icon.textContent = "📎";
  icon.setAttribute("aria-hidden", "true");
  el.appendChild(icon);

  const label = document.createElement("span");
  label.className = "message__file-affordance-label";
  label.textContent = filename || "file";
  el.appendChild(label);

  if (mimeType) {
    const type = document.createElement("span");
    type.className = "message__file-affordance-type";
    type.textContent = mimeType.split("/")[1]?.toUpperCase() ?? mimeType;
    el.appendChild(type);
  }

  const activate = () => {
    el.dispatchEvent(new CustomEvent("quark:open-file", {
      bubbles: true,
      detail: { mxcUrl, filename, mimeType, encryptionInfo },
    }));
  };
  el.addEventListener("click", activate);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
  });

  return el;
}

/**
 * Build the inner content of a single message (body, media, reactions) —
 * does NOT include the sender/timestamp header (that lives on the group).
 */
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
    const replyTo = msg.replyTo;

    const reply = document.createElement("div");
    reply.className = "reply-preview";
    reply.setAttribute("role", "button");
    reply.setAttribute("tabindex", "0");
    reply.setAttribute("aria-label", `Reply to ${replyTo.senderName}: ${replyTo.body}`);
    reply.title = "Jump to original message";

    // Reply icon — clicking jumps to the original
    const icon = document.createElement("span");
    icon.className = "reply-preview__icon";
    icon.textContent = "↩";
    icon.setAttribute("aria-hidden", "true");
    reply.appendChild(icon);

    const sender = document.createElement("span");
    sender.className = "reply-preview__sender";
    // Strip @user:server.org → just the local part for display
    const localPart = replyTo.senderName.startsWith("@")
      ? replyTo.senderName.slice(1).split(":")[0]
      : replyTo.senderName;
    sender.textContent = localPart;
    reply.appendChild(sender);

    const body = document.createElement("span");
    body.className = "reply-preview__body";
    body.textContent = replyTo.body;
    reply.appendChild(body);

    // Click / Enter → bubble a jump event up to the Timeline element
    const jump = () => {
      reply.dispatchEvent(
        new CustomEvent("quark:jump-to-message", {
          bubbles: true,
          detail: { eventId: replyTo.eventId },
        })
      );
    };
    reply.addEventListener("click", jump);
    reply.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(); }
    });

    row.appendChild(reply);
  }

  // ── Header (sender + timestamp) — only for ungrouped/system messages ──
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
    row.classList.add("message--image");
    const img = document.createElement("img");
    img.className = "message__image";
    img.src = msg.mediaUrl ?? "";
    img.alt = msg.mediaAlt ?? "image";
    // Mark GIFs so the focus/blur handler can pause/resume animation
    if ((msg.mediaUrl ?? "").match(/\.gif($|\?)/i) || msg.mediaMimeType === "image/gif") {
      img.dataset.gif = "1";
    }
    row.appendChild(img);
  } else if (type === "video") {
    row.classList.add("message--video");
    const aff = buildVideoAffordance(msg.mediaUrl, msg.mediaAlt, msg.mediaMimeType, msg.mediaEncryptionInfo, msg.mediaThumbnailUrl, msg.mediaThumbnailEncryptionInfo);
    row.appendChild(aff);
  } else if (type === "sticker") {
    const img = document.createElement("img");
    img.className = "message__sticker";
    img.src = msg.mediaUrl ?? "";
    img.alt = msg.mediaAlt ?? "sticker";
    row.appendChild(img);
  } else if (type === "file") {
    const aff = buildFileAffordance(msg.mediaUrl, msg.body, msg.mediaMimeType, msg.mediaEncryptionInfo);
    row.appendChild(aff);
  } else {
    // Text / system
    const body = document.createElement("div");
    body.className = "message__body";

    if (msg.htmlBody) {
      // Render HTML body. In production this must be sanitized server-side or
      // with DOMPurify; for the UI shell we accept pre-trusted HTML.
      body.innerHTML = msg.htmlBody;
      // Stash mxc:// src in data-mxc so actions.ts can resolve them later,
      // and clear src to avoid broken-image icons in the meantime.
      for (const img of body.querySelectorAll<HTMLImageElement>("img[data-mx-emoticon]")) {
        if (img.src.startsWith("mxc://") || img.getAttribute("src")?.startsWith("mxc://")) {
          img.dataset.mxc = img.getAttribute("src") ?? img.src;
          img.removeAttribute("src");
        }
      }
      // Intercept all anchor clicks so they open in the system browser rather
      // than navigating the Tauri WebView away from the chat UI.
      for (const a of body.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const href = a.getAttribute("href") ?? "";
        a.removeAttribute("href");
        a.setAttribute("role", "link");
        a.style.cursor = "pointer";
        a.addEventListener("click", (e) => {
          e.preventDefault();
          if (href.startsWith("http://") || href.startsWith("https://")) {
            void invoke("plugin:shell|open", { path: href }).catch(() => {
              window.open(href, "_blank", "noopener,noreferrer");
            });
          }
        });
      }
    } else {
      appendLinkifiedText(body, msg.body);
    }

    row.appendChild(body);

    // ── URL preview card ─────────────────────────────────────────────────
    const previewUrl = extractFirstUrl(msg.body);
    if (previewUrl) {
      attachUrlPreview(previewUrl, row);
    }
  }

  // ── Reactions ──────────────────────────────────────────────────────────
  if (msg.reactions && msg.reactions.length > 0) {
    row.appendChild(createReactionBar(msg.reactions));
  }

  // ── Thread indicator ───────────────────────────────────────────────────
  if (msg.isThreadRoot) {
    const indicator = document.createElement("button");
    indicator.className = "message__thread-indicator";
    indicator.setAttribute("tabindex", "0");
    const count = msg.threadReplyCount ?? 0;
    indicator.textContent = count > 0 ? `⌥ ${count} repl${count === 1 ? "y" : "ies"}` : "⌥ thread";
    indicator.title = "Open thread (t)";
    indicator.addEventListener("click", (e) => {
      e.stopPropagation();
      row.dispatchEvent(
        new CustomEvent("quark:open-thread", {
          bubbles: true,
          detail: { eventId: msg.id },
        })
      );
    });
    row.appendChild(indicator);
  }

  // ── Hover action bar ───────────────────────────────────────────────────
  if (msg.type !== "system") {
    const actions = document.createElement("div");
    actions.className = "message__actions";
    actions.setAttribute("aria-hidden", "true");

    const reactBtn = document.createElement("button");
    reactBtn.className = "message__action-btn";
    reactBtn.textContent = "😀";
    reactBtn.title = "React (e)";
    reactBtn.setAttribute("tabindex", "-1");
    reactBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      row.dispatchEvent(
        new CustomEvent("quark:msg-react", {
          bubbles: true,
          detail: { eventId: msg.id },
        })
      );
    });

    const replyBtn = document.createElement("button");
    replyBtn.className = "message__action-btn";
    replyBtn.textContent = "↩";
    replyBtn.title = "Reply (r)";
    replyBtn.setAttribute("tabindex", "-1");
    replyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      row.dispatchEvent(
        new CustomEvent("quark:msg-reply", {
          bubbles: true,
          detail: { eventId: msg.id },
        })
      );
    });

    const threadBtn = document.createElement("button");
    threadBtn.className = "message__action-btn";
    threadBtn.textContent = "⌥";
    threadBtn.title = "Open thread (t)";
    threadBtn.setAttribute("tabindex", "-1");
    threadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      row.dispatchEvent(
        new CustomEvent("quark:open-thread", {
          bubbles: true,
          detail: { eventId: msg.id },
        })
      );
    });

    actions.appendChild(reactBtn);
    actions.appendChild(replyBtn);
    actions.appendChild(threadBtn);
    row.appendChild(actions);
  }

  return row;
}

/**
 * Build a grouped wrapper for consecutive messages from the same sender.
 * CSS-bordered box with the sender label positioned as an inline legend
 * on the top border.
 */
function buildMessageGroup(msgs: MessageData[]): HTMLElement {
  const first = msgs[0];
  const group = document.createElement("div");
  group.className = "message-group";

  // ── Inline label (positioned on the top border via CSS) ────────────────
  const label = document.createElement("div");
  label.className = "message-group__header";

  const senderId = first.senderId ?? first.senderName;
  const sender = document.createElement("span");
  sender.className = "message-group__sender" + (first.isOwn ? " message-group__sender--own" : "");
  sender.textContent = first.senderName;
  sender.style.cursor = "pointer";
  sender.title = "View profile";
  sender.addEventListener("click", () => {
    sender.dispatchEvent(
      new CustomEvent("quark:open-profile", { bubbles: true, detail: { userId: senderId } })
    );
  });
  label.appendChild(sender);

  const ts = document.createElement("span");
  ts.className = "message-group__timestamp";
  ts.textContent = formatTimestamp(first.timestamp);
  ts.setAttribute("title", first.timestamp);
  label.appendChild(ts);

  group.appendChild(label);

  // ── Messages (body only, no per-message header) ────────────────────────
  for (const msg of msgs) {
    const el = buildMessageElement(msg);
    // Hide the per-message header since the group label covers it
    const msgHeader = el.querySelector(".message__header");
    if (msgHeader) (msgHeader as HTMLElement).style.display = "none";
    group.appendChild(el);
  }

  // ── Wrapper: avatar to the left, box to the right ─────────────────────
  const wrapper = document.createElement("div");
  wrapper.className = "message-group-wrapper";
  wrapper.dataset.sender = first.senderId ?? first.senderName;

  // Wrap the avatar in a column that stretches to the full group height.
  // This gives position:sticky on the avatar a proper containing block —
  // the sticky zone spans the whole group, not just the 32px avatar height.
  const avatarCol = document.createElement("div");
  avatarCol.className = "message-group__avatar-col";
  avatarCol.style.cursor = "pointer";
  avatarCol.title = "View profile";
  avatarCol.addEventListener("click", () => {
    avatarCol.dispatchEvent(
      new CustomEvent("quark:open-profile", { bubbles: true, detail: { userId: senderId } })
    );
  });
  const avatar = buildAvatarElement(first.senderName, first.senderAvatarUrl);
  avatarCol.appendChild(avatar);
  wrapper.appendChild(avatarCol);
  wrapper.appendChild(group);

  return wrapper;
}

/** Check whether a message can be grouped (non-system text-like message). */
function isGroupable(msg: MessageData): boolean {
  return msg.type !== "system";
}

/**
 * Group consecutive messages from the same sender into arrays.
 * System messages, sender changes, reply messages, and 30-minute time gaps
 * break the group. Time gaps also insert a TimeSeparator into the output.
 */
function groupMessages(msgs: MessageData[]): (MessageData | MessageData[] | TimeSeparator)[] {
  const result: (MessageData | MessageData[] | TimeSeparator)[] = [];
  let currentGroup: MessageData[] = [];
  let prevTimestamp = 0;

  const flushGroup = () => {
    if (currentGroup.length > 0) {
      result.push(currentGroup);
      currentGroup = [];
    }
  };

  for (const msg of msgs) {
    const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
    const gap = ts - prevTimestamp;
    const bigGap = prevTimestamp > 0 && gap > TIME_SEPARATOR_GAP_MS;

    if (!isGroupable(msg)) {
      flushGroup();
      if (bigGap) result.push({ type: "time-separator", timestamp: msg.timestamp });
      result.push(msg);
    } else if (bigGap) {
      // Time gap — flush, insert separator, start new group
      flushGroup();
      result.push({ type: "time-separator", timestamp: msg.timestamp });
      currentGroup = [msg];
    } else if (
      currentGroup.length > 0 &&
      (currentGroup[0].senderId ?? currentGroup[0].senderName) === (msg.senderId ?? msg.senderName) &&
      !msg.replyTo // replies always start a fresh group
    ) {
      currentGroup.push(msg);
    } else {
      // Different sender or reply message — flush and start new group
      flushGroup();
      currentGroup = [msg];
    }

    if (ts > 0) prevTimestamp = ts;
  }

  flushGroup();
  return result;
}

export class Timeline {
  private _el: HTMLElement;
  private _listEl: HTMLElement;
  private _loadingEl: HTMLElement;
  /** Floating skeleton overlay shown while a room loads; null when not active */
  private _skeletonEl: HTMLElement | null = null;
  /** Timestamp when the skeleton was last shown, used to enforce a minimum display time */
  private _skeletonShownAt = 0;
  /** Whether the user has scrolled up away from the bottom */
  private _scrolledUp = false;
  /** Track messages for grouping on append */
  private _messages: MessageData[] = [];
  /** Index of the currently selected (highlighted) message, or -1 for none */
  private _selectedIndex = -1;
  /** The last element appended via appendMessageHidden, pending reveal */
  private _lastHiddenEl: HTMLElement | null = null;
  private _onScrollTopCallback: (() => void) | null = null;
  /** Fired when the user clicks inside the timeline area (used to update activePanel). */
  private _onFocusCallback: (() => void) | null = null;
  /** Fired when an image message is clicked — passes (src, alt). */
  private _onImageClickCallback: ((src: string, alt: string) => void) | null = null;
  /** Fired when a jump-to-message is requested but the message is not in the current view. */
  private _onJumpToMessageCallback: ((eventId: string) => void) | null = null;
  /** Fired when the "jump to latest" button is clicked. */
  private _onJumpToLatestCallback: (() => void) | null = null;
  /** The "jump to latest" button element. */
  private _jumpToLatestBtn!: HTMLButtonElement;
  /** True when the timeline is showing a context window, not the live end. */
  private _inContextView = false;
  private _scrollTopFired = false;
  /** Handle for the cleanup timeout of the scroll animation, so we can cancel it */
  private _scrollAnimCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  /** Number of unread messages at the tail of the current message list. */
  private _unreadCount = 0;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "timeline";

    this._loadingEl = document.createElement("div");
    this._loadingEl.className = "timeline__loading-more";
    this._loadingEl.textContent = "Loading…";
    this._loadingEl.style.display = "none";
    this._el.appendChild(this._loadingEl);

    this._listEl = document.createElement("div");
    this._listEl.setAttribute("role", "list");
    this._listEl.setAttribute("aria-label", "Message timeline");
    this._el.appendChild(this._listEl);

    // "Jump to latest" button — shown when scrolled up or in context view
    this._jumpToLatestBtn = document.createElement("button");
    this._jumpToLatestBtn.type = "button";
    this._jumpToLatestBtn.className = "timeline__jump-to-latest";
    this._jumpToLatestBtn.textContent = "↓ jump to latest";
    this._jumpToLatestBtn.style.display = "none";
    this._jumpToLatestBtn.addEventListener("click", () => this._onJumpToLatestCallback?.());
    this._el.appendChild(this._jumpToLatestBtn);

    // Track whether the user has scrolled away from the bottom,
    // and fire the scroll-to-top callback when near the top.
    this._el.addEventListener("scroll", () => {
      const { scrollTop, scrollHeight, clientHeight } = this._el;
      this._scrolledUp = scrollHeight - scrollTop - clientHeight > 40;
      this._updateJumpToLatestVisibility();

      if (scrollTop < 80 && !this._scrollTopFired) {
        this._scrollTopFired = true;
        this._onScrollTopCallback?.();
      } else if (scrollTop >= 80) {
        this._scrollTopFired = false;
      }
    });

    // Scroll to bottom when images finish loading so the initial room load doesn't
    // strand the user in the middle of history. Use capture phase because `load`
    // doesn't bubble.
    this._el.addEventListener("load", (e) => {
      if (e.target instanceof HTMLImageElement && !this._scrolledUp) {
        this._scrollToBottom();
      }
    }, true);

    // Reply preview "jump to original" — fired by reply-preview clicks
    this._listEl.addEventListener("quark:jump-to-message", (e: Event) => {
      const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
      const found = this.scrollToMessage(eventId);
      if (!found) this._onJumpToMessageCallback?.(eventId);
    });

    // Clicking inside the timeline notifies panels.ts so that activePanel is
    // updated to "timeline". This ensures keyboard navigation (j/k) works
    // immediately after a mouse click without needing to press l first.
    // Also sync _selectedIndex so subsequent keyboard actions (r/e/dd) target
    // the clicked message.
    this._el.addEventListener("click", (e) => {
      this._onFocusCallback?.();

      // Image lightbox — intercept clicks on message images
      const target = e.target as HTMLElement;
      if (target instanceof HTMLImageElement && target.classList.contains("message__image")) {
        e.preventDefault();
        e.stopPropagation();
        this._onImageClickCallback?.(target.src, target.alt);
        return;
      }

      const msgEl = target.closest<HTMLElement>("[data-message-id]");
      if (msgEl) {
        const eventId = msgEl.dataset.messageId;
        const idx = this._messages.findIndex((m) => m.id === eventId);
        if (idx >= 0) this._setSelected(idx);
      }
    });
  }

  getElement(): HTMLElement {
    return this._el;
  }

  /** Register a callback fired when the user scrolls near the top (once per approach). */
  onScrollToTop(cb: () => void): void {
    this._onScrollTopCallback = cb;
  }

  /**
   * Register a callback fired when the user clicks inside the timeline.
   * Use this to update activePanel so keyboard nav immediately works.
   */
  onFocus(cb: () => void): void {
    this._onFocusCallback = cb;
  }

  /** Register a callback fired when the user clicks an image message. */
  onImageClick(cb: (src: string, alt: string) => void): void {
    this._onImageClickCallback = cb;
  }

  /** Register a callback fired when a jump-to-message is requested but the message isn't loaded. */
  onJumpToMessage(cb: (eventId: string) => void): void {
    this._onJumpToMessageCallback = cb;
  }

  /** Register a callback fired when the "jump to latest" button is clicked. */
  onJumpToLatest(cb: () => void): void {
    this._onJumpToLatestCallback = cb;
  }

  /**
   * Set whether the timeline is in "context view" (showing a window around a
   * jumped-to message rather than the live end). Shows or hides the jump-to-latest button.
   */
  setContextView(inContext: boolean): void {
    this._inContextView = inContext;
    this._updateJumpToLatestVisibility();
  }

  /**
   * Set the number of unread messages at the tail of the next `setMessages()` call.
   * A `── NEW ──` separator will be inserted before those messages, and the
   * timeline will scroll to the separator instead of the bottom.
   * Reset to 0 after the separator is consumed.
   */
  setUnreadCount(count: number): void {
    this._unreadCount = count;
  }

  /** Scroll the timeline to the unread separator if one exists. */
  scrollToUnreadSeparator(): void {
    const sep = this._listEl.querySelector<HTMLElement>(".unread-separator");
    if (sep) {
      sep.scrollIntoView({ block: "center" });
    }
  }

  /** Show a "Loading…" indicator above the message list. */
  showLoadingMore(): void {
    this._loadingEl.style.display = "block";
  }

  /** Hide the loading indicator. */
  hideLoadingMore(): void {
    this._loadingEl.style.display = "none";
  }

  /**
   * Show a floating skeleton overlay while a room's timeline is loading.
   * The overlay sits on top of the existing content so real messages can render
   * beneath it. Call setMessages() to trigger the fade-out, which waits for
   * images to finish loading before dismissing.
   */
  showSkeleton(): void {
    // Dismiss any existing skeleton immediately (rapid room switching)
    if (this._skeletonEl) {
      this._skeletonEl.remove();
      this._skeletonEl = null;
    }

    this._skeletonShownAt = Date.now();

    // Use position:fixed coordinates matching the timeline's viewport rect so
    // the overlay isn't clipped or scrolled by the timeline's overflow:auto.
    const rect = this._el.getBoundingClientRect();

    const overlay = document.createElement("div");
    overlay.className = "skeleton-overlay";
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    this._skeletonEl = overlay;

    const groups: Array<{ nameWidth: number; lines: number[] }> = [
      { nameWidth: 38, lines: [72, 48] },
      { nameWidth: 52, lines: [88, 35, 61] },
      { nameWidth: 31, lines: [44] },
      { nameWidth: 65, lines: [79, 28] },
      { nameWidth: 43, lines: [91, 56] },
      { nameWidth: 58, lines: [67] },
      { nameWidth: 35, lines: [82, 44, 23] },
    ];

    const fragment = document.createDocumentFragment();
    groups.forEach((group, gi) => {
      const row = document.createElement("div");
      row.className = "skeleton-group";
      row.style.animationDelay = `${gi * 55}ms`;

      const avatar = document.createElement("div");
      avatar.className = "skeleton-group__avatar";
      avatar.style.animationDelay = `${gi * 55}ms`;

      const content = document.createElement("div");
      content.className = "skeleton-group__content";

      const name = document.createElement("div");
      name.className = "skeleton-group__name";
      name.style.width = `${group.nameWidth}%`;
      name.style.animationDelay = `${gi * 55}ms`;
      content.appendChild(name);

      group.lines.forEach((width, li) => {
        const line = document.createElement("div");
        line.className = "skeleton-group__line";
        line.style.width = `${width}%`;
        line.style.animationDelay = `${gi * 55 + li * 30}ms`;
        content.appendChild(line);
      });

      row.appendChild(avatar);
      row.appendChild(content);
      fragment.appendChild(row);
    });

    overlay.appendChild(fragment);
    // Append to body so it isn't clipped by the timeline's overflow or scroll position
    document.body.appendChild(overlay);
  }

  /**
   * Fade out the skeleton overlay, waiting for any images in the freshly-rendered
   * list to finish loading first. Enforces a minimum skeleton display time so
   * fast loads don't produce a jarring flash.
   */
  private _fadeOutSkeletonAfterImages(): void {
    const skeleton = this._skeletonEl;
    if (!skeleton) return;

    const MIN_MS = 600;

    const doFade = () => {
      // Guard against a new skeleton being shown before this fires
      if (this._skeletonEl !== skeleton) return;
      skeleton.classList.add("skeleton-overlay--out");
      skeleton.addEventListener("transitionend", () => skeleton.remove(), { once: true });
      this._skeletonEl = null;
    };

    const scheduleWithMinimum = () => {
      const elapsed = Date.now() - this._skeletonShownAt;
      const remaining = Math.max(0, MIN_MS - elapsed);
      setTimeout(doFade, remaining);
    };

    // Collect images that haven't finished loading yet
    const imgs = Array.from(this._listEl.querySelectorAll<HTMLImageElement>("img"));
    const pending = imgs.filter((img) => !img.complete);

    if (pending.length === 0) {
      scheduleWithMinimum();
      return;
    }

    // Wait for all pending images, then enforce the minimum
    let resolved = 0;
    const onSettled = () => {
      resolved++;
      if (resolved >= pending.length) scheduleWithMinimum();
    };
    pending.forEach((img) => {
      img.addEventListener("load", onSettled, { once: true });
      img.addEventListener("error", onSettled, { once: true });
    });

    // Hard timeout: don't hold the skeleton forever if an image stalls
    setTimeout(scheduleWithMinimum, 3000);
  }

  /** Prepend older messages above the current list, preserving scroll position. */
  prependMessages(msgs: MessageData[]): void {
    if (msgs.length === 0) return;
    const oldScrollHeight = this._el.scrollHeight;
    const oldScrollTop = this._el.scrollTop;
    this._messages = [...msgs, ...this._messages];
    // Shift selection forward so it still points at the same message after prepend.
    if (this._selectedIndex >= 0) {
      this._selectedIndex += msgs.length;
    }

    // Insert new DOM nodes at the top without clearing existing content.
    // This avoids blanking the visible timeline while the DOM rebuilds.
    const groups = groupMessages(msgs);
    const fragment = document.createDocumentFragment();
    for (const entry of groups) {
      if (Array.isArray(entry)) {
        fragment.appendChild(buildMessageGroup(entry));
      } else if ("type" in entry && entry.type === "time-separator") {
        fragment.appendChild(buildTimeSeparator(entry.timestamp));
      } else {
        const el = buildMessageElement(entry as MessageData);
        el.classList.add("message--ungrouped");
        fragment.appendChild(el);
      }
    }
    // Check for a time gap at the junction between prepended and existing messages
    const lastPrepended = msgs[msgs.length - 1];
    const firstExisting = this._messages[msgs.length];
    if (lastPrepended && firstExisting && firstExisting.timestamp && lastPrepended.timestamp) {
      const gap = new Date(firstExisting.timestamp).getTime() - new Date(lastPrepended.timestamp).getTime();
      if (gap > TIME_SEPARATOR_GAP_MS) {
        fragment.appendChild(buildTimeSeparator(firstExisting.timestamp));
      }
    }
    this._listEl.insertBefore(fragment, this._listEl.firstChild);

    // Restore position so the previously-visible messages stay in view
    this._el.scrollTop = oldScrollTop + (this._el.scrollHeight - oldScrollHeight);

    // Reset _scrollTopFired so future keyboard navigation or scrolling can
    // trigger another page load. The _paginationLoading guard in loadMoreMessages
    // prevents a double-fire during the current load (which is still in progress
    // when prependMessages runs). Without this reset, _scrollTopFired can stay
    // true after restoration and block subsequent loads via keyboard nav.
    this._scrollTopFired = false;
  }

  /** Replace the entire message list.
   *
   * By default (preserveScroll = false) scrolls to the bottom after rendering —
   * used when first loading a room.  Pass preserveScroll = true for async
   * re-renders (e.g. member-data refresh) so that a user who has already
   * scrolled up to read history keeps their position.
   */
  setMessages(msgs: MessageData[], opts?: { preserveScroll?: boolean }): void {
    // Cancel any in-progress scroll animation to prevent stuck transforms
    if (this._scrollAnimCleanupTimer !== null) {
      clearTimeout(this._scrollAnimCleanupTimer);
      this._scrollAnimCleanupTimer = null;
      this._listEl.style.transition = "";
      this._listEl.style.transform = "";
    }

    // Reset selection so _selectedIndex can't be out-of-range for the new message list.
    // Without this, navigating after a room switch can get stuck because _selectedIndex
    // still holds an index from the previous room's (longer) message list, making
    // selectNext/selectPrev think the selection is already at the boundary.
    this._selectedIndex = -1;

    const preserveScroll = opts?.preserveScroll ?? false;
    // Capture scroll state before re-render so we can restore it
    const wasScrolledUp = this._scrolledUp;
    const savedScrollTop = this._el.scrollTop;
    const savedScrollHeight = this._el.scrollHeight;

    this._messages = [...msgs];
    this._renderAll();

    if (preserveScroll && wasScrolledUp) {
      // Restore the user's reading position by compensating for any height change
      const heightDelta = this._el.scrollHeight - savedScrollHeight;
      this._el.scrollTop = savedScrollTop + heightDelta;
      // Keep _scrolledUp true so incoming messages don't auto-scroll the user
      this._scrolledUp = true;
    } else if (this._unreadCount > 0 && !preserveScroll) {
      // Insert unread separator and scroll to it so the user sees new messages
      this._insertUnreadSeparator();
      this._unreadCount = 0;
      this._scrolledUp = false;
      this._scrollTopFired = false;
      // Scroll to bottom first so layout is stable, then scroll to the separator
      this._scrollToBottom();
      requestAnimationFrame(() => {
        this.scrollToUnreadSeparator();
        this._scrolledUp = true;
        this._updateJumpToLatestVisibility();
      });
    } else {
      this._scrolledUp = false;
      this._scrollTopFired = false;
      // Scroll immediately (for text content), then again after images may have loaded
      this._scrollToBottom();
      requestAnimationFrame(() => {
        this._scrollToBottom();
        // Second pass after a short delay to catch any late-loading content
        setTimeout(() => this._scrollToBottom(), 150);
      });
    }
    this._updateJumpToLatestVisibility();
    this._fadeOutSkeletonAfterImages();
  }

  /** Append a single message, scrolling to bottom if not scrolled up */
  appendMessage(msg: MessageData, opts?: { animate?: boolean }): void {
    this._messages.push(msg);
    const animate = opts?.animate ?? false;

    // Check 30-minute time gap from the previous message
    const prevMsg = this._messages[this._messages.length - 2];
    const prevTs = prevMsg?.timestamp ? new Date(prevMsg.timestamp).getTime() : 0;
    const newTs = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
    const bigGap = prevTs > 0 && newTs - prevTs > TIME_SEPARATOR_GAP_MS;

    if (bigGap) {
      this._listEl.appendChild(buildTimeSeparator(msg.timestamp));
    }

    // Check if this message can be merged into the last group on screen.
    // Never merge across a time gap — same condition as groupMessages().
    if (!bigGap) {
      const lastWrapper = this._listEl.lastElementChild;
      if (
        lastWrapper &&
        lastWrapper.classList.contains("message-group-wrapper") &&
        isGroupable(msg)
      ) {
        // Check sender of the existing group (compare by Matrix user ID, not display name)
        const wrapperSenderId = (lastWrapper as HTMLElement).dataset.sender;
        if (wrapperSenderId === (msg.senderId ?? msg.senderName) && !msg.replyTo) {
          // Append into existing group (replies always start a new group)
          const innerGroup = lastWrapper.querySelector<HTMLElement>(".message-group");
          if (!innerGroup) return;
          const el = buildMessageElement(msg);
          const msgHeader = el.querySelector(".message__header");
          if (msgHeader) (msgHeader as HTMLElement).style.display = "none";
          if (animate) el.classList.add("message--entering");
          innerGroup.appendChild(el);
          if (!this._scrolledUp) this._scrollToBottom();
          return;
        }
      }
    }

    // Otherwise, render as a new group or ungrouped element
    if (isGroupable(msg)) {
      const wrapper = buildMessageGroup([msg]);
      if (animate) wrapper.classList.add("message-group-wrapper--entering");
      this._listEl.appendChild(wrapper);
    } else {
      const el = buildMessageElement(msg);
      el.classList.add("message--ungrouped");
      this._listEl.appendChild(el);
    }

    if (!this._scrolledUp) {
      this._scrollToBottom();
    }
  }

  /** Force scroll to the latest message */
  scrollToBottom(): void {
    this._scrollToBottom();
  }

  // ── Inline thread panel ────────────────────────────────────────────────────

  private _inlineThreadEl: HTMLElement | null = null;
  private _inlineThreadRootId: string | null = null;
  private _inlineThreadMessages: ThreadMessageData[] = [];
  private _threadSelectedIndex = -1;
  private _inlineThreadCloseCallback: (() => void) | null = null;

  /** Register callback fired when the user closes the inline thread. */
  onInlineThreadClose(cb: () => void): void {
    this._inlineThreadCloseCallback = cb;
  }

  /** The event ID of the currently-open inline thread root, or null. */
  get inlineThreadRootId(): string | null {
    return this._inlineThreadRootId;
  }

  /**
   * Insert (or replace) the inline thread panel directly after the wrapper
   * element that contains the thread root message, then animate it open.
   */
  openInlineThread(rootEventId: string, replies: ThreadMessageData[]): void {
    // Remove any previously-open panel immediately (no close animation — the
    // new panel snaps open in the correct position).
    this._removeInlineThread(false);
    this._inlineThreadMessages = [...replies];
    this._threadSelectedIndex = -1;

    const rootMsgEl = this._listEl.querySelector<HTMLElement>(`[data-message-id="${rootEventId}"]`);
    const anchor =
      rootMsgEl?.closest<HTMLElement>(".message-group-wrapper") ??
      rootMsgEl?.closest<HTMLElement>(".message--ungrouped");
    if (!anchor) return;

    this._inlineThreadRootId = rootEventId;
    const panel = this._buildInlinePanel(rootEventId, replies);
    this._inlineThreadEl = panel;
    anchor.insertAdjacentElement("afterend", panel);

    // Animate open on the next frame so the browser has painted the 0fr state.
    requestAnimationFrame(() => {
      panel.classList.add("thread-inline--open");
    });

    // After the panel opens, scroll the anchor back into view so the root
    // message stays visible above the expanded panel.
    setTimeout(() => {
      anchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 240);
  }

  /** Animate the inline thread panel closed then remove it from the DOM. */
  closeInlineThread(): void {
    this._removeInlineThread(true);
  }

  /** Append a new reply to the already-open inline thread panel. */
  appendInlineReply(msg: ThreadMessageData): void {
    if (!this._inlineThreadEl) return;
    const tl = this._inlineThreadEl.querySelector<HTMLElement>(".thread-inline__timeline");
    if (!tl) return;
    this._inlineThreadMessages.push(msg);
    tl.appendChild(this._buildInlineMsgEl(msg));
    tl.scrollTop = tl.scrollHeight;
  }

  // ── Thread navigation ──────────────────────────────────────────────────────

  /** Navigate to the next thread reply (or first if nothing selected). */
  threadSelectNext(): void {
    if (!this._inlineThreadEl || this._inlineThreadMessages.length === 0) return;
    const next = this._threadSelectedIndex < this._inlineThreadMessages.length - 1
      ? this._threadSelectedIndex + 1
      : this._threadSelectedIndex;
    this._setThreadSelected(next);
  }

  /** Navigate to the previous thread reply. */
  threadSelectPrev(): void {
    if (!this._inlineThreadEl || this._inlineThreadMessages.length === 0) return;
    const prev = this._threadSelectedIndex > 0
      ? this._threadSelectedIndex - 1
      : 0;
    this._setThreadSelected(prev);
  }

  /** Jump to the first thread reply. */
  threadSelectFirst(): void {
    if (this._inlineThreadMessages.length > 0) this._setThreadSelected(0);
  }

  /** Jump to the last thread reply. */
  threadSelectLast(): void {
    const len = this._inlineThreadMessages.length;
    if (len > 0) this._setThreadSelected(len - 1);
  }

  /** Clear thread selection (but leave thread open). */
  threadClearSelection(): void {
    this._setThreadSelected(-1);
  }

  /** The event ID of the currently-selected thread reply, or null. */
  get threadSelectedMessageId(): string | null {
    if (this._threadSelectedIndex < 0 || this._threadSelectedIndex >= this._inlineThreadMessages.length) return null;
    return this._inlineThreadMessages[this._threadSelectedIndex].id;
  }

  /** Return the DOM element for a message inside the inline thread, or null. */
  getInlineThreadMessageEl(eventId: string): HTMLElement | null {
    return this._inlineThreadEl?.querySelector<HTMLElement>(`[data-message-id="${eventId}"]`) ?? null;
  }

  /** Swap in a resolved data URL for a media message inside the inline thread. */
  updateInlineThreadMedia(eventId: string, dataUrl: string): void {
    if (!this._inlineThreadEl) return;
    const el = this._inlineThreadEl.querySelector<HTMLElement>(`[data-message-id="${eventId}"]`);
    const img = el?.querySelector<HTMLImageElement>(".thread-inline__message-image, .thread-inline__message-sticker");
    if (img) img.src = dataUrl;
  }

  private _setThreadSelected(index: number): void {
    // Remove highlight from previous
    if (this._threadSelectedIndex >= 0 && this._inlineThreadEl) {
      const prevId = this._inlineThreadMessages[this._threadSelectedIndex]?.id;
      if (prevId) {
        const el = this._inlineThreadEl.querySelector<HTMLElement>(`[data-message-id="${prevId}"]`);
        el?.classList.remove("thread-inline__message--selected");
      }
    }

    this._threadSelectedIndex = index;

    if (index >= 0 && this._inlineThreadEl) {
      const msgId = this._inlineThreadMessages[index]?.id;
      if (msgId) {
        const el = this._inlineThreadEl.querySelector<HTMLElement>(`[data-message-id="${msgId}"]`);
        if (el) {
          el.classList.add("thread-inline__message--selected");
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }
  }

  private _removeInlineThread(animate: boolean): void {
    const panel = this._inlineThreadEl;
    if (!panel) return;
    this._inlineThreadEl = null;
    this._inlineThreadRootId = null;
    this._inlineThreadMessages = [];
    this._setThreadSelected(-1);

    if (!animate) {
      panel.remove();
      return;
    }
    panel.classList.remove("thread-inline--open");
    const onDone = () => panel.remove();
    panel.addEventListener("transitionend", onDone, { once: true });
    // Fallback: if transition somehow doesn't fire (e.g., tab hidden), clean up.
    setTimeout(onDone, 350);
  }

  private _buildInlinePanel(rootEventId: string, replies: ThreadMessageData[]): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "thread-inline";
    panel.dataset.threadRoot = rootEventId;

    const inner = document.createElement("div");
    inner.className = "thread-inline__inner";

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "thread-inline__header";

    const title = document.createElement("span");
    title.className = "thread-inline__title";
    title.textContent = "⌥ Thread";
    header.appendChild(title);

    const countEl = document.createElement("span");
    countEl.className = "thread-inline__count";
    const n = replies.length;
    countEl.textContent = n > 0 ? `${n} repl${n === 1 ? "y" : "ies"}` : "no replies yet";
    header.appendChild(countEl);

    const closeBtn = document.createElement("button");
    closeBtn.className = "thread-inline__close";
    closeBtn.type = "button";
    closeBtn.textContent = "[x]";
    closeBtn.setAttribute("aria-label", "Close thread");
    closeBtn.addEventListener("click", () => this._inlineThreadCloseCallback?.());
    header.appendChild(closeBtn);

    inner.appendChild(header);

    // ── Reply timeline ───────────────────────────────────────────────────────
    const timelineEl = document.createElement("div");
    timelineEl.className = "thread-inline__timeline";
    timelineEl.setAttribute("role", "list");
    timelineEl.setAttribute("aria-label", "Thread replies");

    for (const msg of replies) {
      timelineEl.appendChild(this._buildInlineMsgEl(msg));
    }

    inner.appendChild(timelineEl);
    panel.appendChild(inner);
    return panel;
  }

  private _buildInlineMsgEl(msg: ThreadMessageData): HTMLElement {
    const row = document.createElement("div");
    row.className = "thread-inline__message" + (msg.isOwn ? " thread-inline__message--own" : "");
    row.setAttribute("role", "listitem");
    row.dataset.messageId = msg.id;

    const hdr = document.createElement("div");
    hdr.className = "thread-inline__message-header";

    const senderEl = document.createElement("span");
    senderEl.className =
      "thread-inline__message-sender" + (msg.isOwn ? " thread-inline__message-sender--own" : "");
    senderEl.textContent = msg.senderName;
    hdr.appendChild(senderEl);

    const tsEl = document.createElement("span");
    tsEl.className = "thread-inline__message-timestamp";
    try {
      const d = new Date(msg.timestamp);
      tsEl.textContent = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    } catch { /* leave empty */ }
    tsEl.setAttribute("title", msg.timestamp);
    hdr.appendChild(tsEl);

    row.appendChild(hdr);

    const type = msg.type ?? "text";
    if (type === "image" || type === "sticker") {
      const img = document.createElement("img");
      img.className = `thread-inline__message-${type}`;
      img.src = msg.mediaUrl ?? "";
      img.alt = msg.mediaAlt ?? type;
      img.loading = "lazy";
      row.appendChild(img);
    } else if (type === "video") {
      const aff = buildVideoAffordance(msg.mediaUrl, msg.mediaAlt, msg.mediaMimeType, msg.mediaEncryptionInfo, msg.mediaThumbnailUrl, msg.mediaThumbnailEncryptionInfo);
      row.appendChild(aff);
    } else {
      const body = document.createElement("div");
      body.className = "thread-inline__message-body";
      if (msg.htmlBody) {
        body.innerHTML = msg.htmlBody;
      } else {
        body.textContent = msg.body;
      }
      row.appendChild(body);
    }

    if (msg.reactions && msg.reactions.length > 0) {
      row.appendChild(createReactionBar(msg.reactions));
    }

    return row;
  }

  /**
   * The event ID of the currently selected message (or thread reply when a
   * thread is open and a reply is highlighted), or null.
   */
  get selectedMessageId(): string | null {
    if (this._inlineThreadRootId !== null && this._threadSelectedIndex >= 0) {
      return this.threadSelectedMessageId;
    }
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) return null;
    return this._messages[this._selectedIndex].id;
  }

  /** Always returns the main-timeline selection, ignoring any thread navigation. */
  get timelineSelectedMessageId(): string | null {
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) return null;
    return this._messages[this._selectedIndex].id;
  }

  /** Returns the full MessageData of the currently selected timeline message, or null. */
  get selectedMessage(): MessageData | null {
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) return null;
    return this._messages[this._selectedIndex];
  }

  /** Move selection down. Navigates thread replies when a thread is open. */
  selectNext(): void {
    if (this._inlineThreadRootId !== null) { this.threadSelectNext(); return; }
    if (this._messages.length === 0) return;
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) {
      this._setSelected(this._messages.length - 1);
    } else if (this._selectedIndex < this._messages.length - 1) {
      this._setSelected(this._selectedIndex + 1);
    }
  }

  /** Move selection up. Navigates thread replies when a thread is open. */
  selectPrev(): void {
    if (this._inlineThreadRootId !== null) { this.threadSelectPrev(); return; }
    if (this._messages.length === 0) return;
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) {
      this._setSelected(this._messages.length - 1);
    } else if (this._selectedIndex > 0) {
      this._setSelected(this._selectedIndex - 1);
    }
  }

  /** Jump to first. Goes to first thread reply when a thread is open. */
  selectFirst(): void {
    if (this._inlineThreadRootId !== null) { this.threadSelectFirst(); return; }
    if (this._messages.length === 0) return;
    this._setSelected(0);
  }

  /** Jump to last. Goes to last thread reply when a thread is open. */
  selectLast(): void {
    if (this._inlineThreadRootId !== null) { this.threadSelectLast(); return; }
    if (this._messages.length === 0) return;
    this._setSelected(this._messages.length - 1);
    this._scrollToBottom();
  }

  /** Clear selection (clears thread selection when a thread is open). */
  clearSelection(): void {
    if (this._inlineThreadRootId !== null) { this.threadClearSelection(); return; }
    this._setSelected(-1);
  }

  /**
   * Append a message to the timeline but keep it invisible (opacity: 0).
   * Call showLastHiddenMessage() to reveal it with an animation.
   * Used for the send animation: message lands silently, then the flying
   * clone arrives and this method reveals it at that moment.
   */
  appendMessageHidden(msg: MessageData): void {
    this._messages.push(msg);

    // Check 30-minute time gap from the previous message
    const prevMsg = this._messages[this._messages.length - 2];
    const prevTs = prevMsg?.timestamp ? new Date(prevMsg.timestamp).getTime() : 0;
    const newTs = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
    const bigGap = prevTs > 0 && newTs - prevTs > TIME_SEPARATOR_GAP_MS;

    if (bigGap) {
      this._listEl.appendChild(buildTimeSeparator(msg.timestamp));
    }

    if (!bigGap) {
      const lastWrapper = this._listEl.lastElementChild;
      if (
        lastWrapper &&
        lastWrapper.classList.contains("message-group-wrapper") &&
        isGroupable(msg)
      ) {
        const innerGroup = lastWrapper.querySelector<HTMLElement>(".message-group");
        const groupSender = innerGroup?.querySelector(".message-group__sender");
        if (groupSender && groupSender.textContent === msg.senderName && !msg.replyTo) {
          const el = buildMessageElement(msg);
          const msgHeader = el.querySelector(".message__header");
          if (msgHeader) (msgHeader as HTMLElement).style.display = "none";
          el.style.opacity = "0";
          innerGroup!.appendChild(el);
          this._lastHiddenEl = el;
          if (!this._scrolledUp) this._scrollAnimated();
          return;
        }
      }
    }

    if (isGroupable(msg)) {
      const wrapper = buildMessageGroup([msg]);
      wrapper.style.opacity = "0";
      this._listEl.appendChild(wrapper);
      this._lastHiddenEl = wrapper;
      if (!this._scrolledUp) this._scrollAnimated();
    } else {
      const el = buildMessageElement(msg);
      el.classList.add("message--ungrouped");
      el.style.opacity = "0";
      this._listEl.appendChild(el);
      this._lastHiddenEl = el;
      if (!this._scrolledUp) this._scrollAnimated();
    }
  }

  /**
   * Reveal a hidden message element (appended via appendMessageHidden).
   * Pass the specific element captured at send time to avoid a race where
   * rapid successive sends overwrite the shared _lastHiddenEl slot.
   * For a new group: the box appears instantly and only the header fades in.
   * For a merged message: fades it in.
   */
  showLastHiddenMessage(target?: HTMLElement): void {
    const el = target ?? this._lastHiddenEl;
    if (!el) return;
    if (el === this._lastHiddenEl) this._lastHiddenEl = null;

    if (el.classList.contains("message-group-wrapper")) {
      const header = el.querySelector<HTMLElement>(".message-group__header");
      const avatar = el.querySelector<HTMLElement>(".message-group__avatar, .message-group__avatar-fallback");

      if (header) header.style.opacity = "0";
      if (avatar) avatar.style.opacity = "0";
      el.style.opacity = "";

      requestAnimationFrame(() => {
        if (header) {
          header.style.opacity = "";
          header.classList.add("msg-header--reveal");
        }
        if (avatar) {
          avatar.style.opacity = "";
          avatar.classList.add("msg-header--reveal");
        }
      });
    } else {
      el.style.opacity = "";
    }
  }

  /**
   * Replace fallback avatars for a sender with a real image.
   * Called after an avatar thumbnail has been downloaded.
   */
  /** Update display name text for all message groups from a given sender ID in place. */
  updateSenderName(senderId: string, displayName: string): void {
    const wrappers = this._listEl.querySelectorAll<HTMLElement>(`[data-sender="${CSS.escape(senderId)}"]`);
    for (const wrapper of wrappers) {
      const nameEl = wrapper.querySelector<HTMLElement>(".message-group__sender");
      if (nameEl) nameEl.textContent = displayName;
    }
  }

  updateSenderAvatar(sender: string, dataUrl: string): void {
    const wrappers = this._listEl.querySelectorAll<HTMLElement>(`[data-sender="${CSS.escape(sender)}"]`);
    for (const wrapper of wrappers) {
      const fallback = wrapper.querySelector<HTMLElement>(".message-group__avatar-fallback");
      if (!fallback) continue;
      const img = document.createElement("img");
      img.className = "message-group__avatar";
      img.src = dataUrl;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      if (isAnimatedUrl(dataUrl)) img.dataset.gif = "1";
      img.onerror = () => img.replaceWith(buildFallbackAvatar(sender));
      fallback.replaceWith(img);
    }
  }

  /** Returns the DOM element for the given message event ID, or null. */
  getMessageElementById(eventId: string): HTMLElement | null {
    return this._listEl.querySelector<HTMLElement>(`[data-message-id="${eventId}"]`);
  }

  /**
   * Swap out the src of an image/sticker message once the mxc:// content
   * has been downloaded and converted to a data URL.
   */
  /** Return all unique mxc:// URLs needed for unresolved inline custom emoji. */
  getPendingInlineEmojiUrls(): string[] {
    const imgs = this._listEl.querySelectorAll<HTMLImageElement>("img[data-mx-emoticon][data-mxc]");
    return [...new Set(Array.from(imgs).map((img) => img.dataset.mxc!))];
  }

  /** Swap in a data: URL for all inline custom emoji with the given mxc URL. */
  resolveInlineEmoji(mxcUrl: string, dataUrl: string): void {
    for (const img of this._listEl.querySelectorAll<HTMLImageElement>(`img[data-mxc]`)) {
      if (img.dataset.mxc === mxcUrl) img.src = dataUrl;
    }
  }

  updateMessageMedia(eventId: string, dataUrl: string): void {
    const idx = this._messages.findIndex((m) => m.id === eventId);
    if (idx >= 0) this._messages[idx].mediaUrl = dataUrl;
    const el = this.getMessageElementById(eventId);
    if (!el) return;
    const img = el.querySelector<HTMLImageElement>(".message__image, .message__sticker");
    if (img) img.src = dataUrl;
  }

  /**
   * Replace the video affordance for `eventId` with an inline `<video>` player.
   * Called by actions.ts after confirming GStreamer support and downloading the media.
   */
  showInlineVideo(eventId: string, dataUrl: string, mimeType: string): void {
    const msgEl = this.getMessageElementById(eventId);
    if (!msgEl) return;
    const aff = msgEl.querySelector<HTMLElement>(".message__video-affordance");
    if (!aff) return;

    const video = document.createElement("video");
    video.className = "message__video";
    video.controls = true;
    video.autoplay = true;
    video.src = dataUrl;
    if (mimeType) {
      const src = document.createElement("source");
      src.type = mimeType;
      video.appendChild(src);
    }
    aff.replaceWith(video);
  }

  /**
   * Remove a message from the timeline by event ID.
   * Used for optimistic redaction — removes from both the DOM and _messages array.
   * If the message was the only one in its group, the whole group wrapper is removed.
   * Adjusts _selectedIndex if needed.
   */
  removeMessage(eventId: string): void {
    const idx = this._messages.findIndex((m) => m.id === eventId);
    if (idx < 0) return;

    const wasSelected = this._selectedIndex === idx;

    // Adjust selection index accounting for the removal
    if (this._selectedIndex > idx) {
      this._selectedIndex--;
    } else if (this._selectedIndex === idx) {
      this._selectedIndex = -1;
    }

    this._messages.splice(idx, 1);

    const el = this.getMessageElementById(eventId);
    if (!el) return;

    const group = el.closest<HTMLElement>(".message-group");
    const wrapper = el.closest<HTMLElement>(".message-group-wrapper");

    if (wrapper && group) {
      const remaining = group.querySelectorAll<HTMLElement>("[data-message-id]");
      if (remaining.length <= 1) {
        // Last message in group — remove the whole wrapper
        wrapper.remove();
      } else {
        el.remove();
      }
    } else {
      // Ungrouped (system) message
      el.remove();
    }

    // Remove any time separators that now have no messages following them
    for (const sep of Array.from(this._listEl.querySelectorAll<HTMLElement>(".time-separator"))) {
      const next = sep.nextElementSibling;
      if (!next || next.classList.contains("time-separator")) {
        sep.remove();
      }
    }

    // If the deleted message was selected, move cursor to the next valid message
    if (wasSelected && this._messages.length > 0) {
      this._setSelected(Math.min(idx, this._messages.length - 1));
    }
  }

  /**
   * Promote an optimistic message to its real server-assigned event ID.
   * Call this when the send IPC resolves: updates both the DOM element's
   * data-message-id attribute and the internal _messages array so that
   * reactions, edits, and selection all target the real event ID.
   */
  confirmMessage(optimisticId: string, realEventId: string): void {
    const idx = this._messages.findIndex((m) => m.id === optimisticId);
    if (idx >= 0) {
      this._messages[idx] = { ...this._messages[idx], id: realEventId };
    }
    const el = this.getMessageElementById(optimisticId);
    if (el) {
      el.dataset.messageId = realEventId;
    }
  }

  /**
   * Update the reaction bar for a message in-place.
   * If the message has no reaction bar yet, one is created and appended.
   * Passing an empty array removes the bar.
   */
  updateMessageReactions(eventId: string, reactions: ReactionGroup[]): void {
    // Keep internal cache in sync
    const idx = this._messages.findIndex((m) => m.id === eventId);
    if (idx >= 0) {
      this._messages[idx] = { ...this._messages[idx], reactions };
    }

    const el = this.getMessageElementById(eventId);
    if (!el) return;

    const bar = el.querySelector<HTMLElement>(".reaction-bar");
    if (reactions.length === 0) {
      bar?.remove();
      return;
    }
    if (bar) {
      updateReactionBar(bar, reactions);
    } else {
      el.appendChild(createReactionBar(reactions));
    }
  }

  /**
  /**
   * Scroll to a message by event ID and briefly highlight it.
   * No-ops silently if the event ID is not in the rendered timeline.
   */
  scrollToMessage(eventId: string): boolean {
    const el = this.getMessageElementById(eventId);
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("message--highlight"); // reset if re-triggered
    // Force reflow so re-adding the class actually restarts the animation
    void el.offsetWidth;
    el.classList.add("message--highlight");
    el.addEventListener("animationend", () => el.classList.remove("message--highlight"), { once: true });
    return true;
  }

  /**
   * Increment (or create) the thread reply count indicator on a thread root
   * message. Called when a thread reply arrives via sync or optimistic send.
   */
  incrementThreadReplyCount(threadRootEventId: string): void {
    const el = this.getMessageElementById(threadRootEventId);
    if (!el) return;

    let indicator = el.querySelector<HTMLButtonElement>(".message__thread-indicator");
    if (indicator) {
      const match = indicator.textContent?.match(/(\d+)/);
      const count = match ? parseInt(match[1], 10) + 1 : 1;
      indicator.textContent = `⌥ ${count} repl${count === 1 ? "y" : "ies"}`;
    } else {
      // First reply to this message — create the indicator
      indicator = document.createElement("button");
      indicator.className = "message__thread-indicator";
      indicator.setAttribute("tabindex", "0");
      indicator.title = "Open thread (t)";
      indicator.textContent = "⌥ 1 reply";
      indicator.addEventListener("click", (e) => {
        e.stopPropagation();
        el.dispatchEvent(
          new CustomEvent("quark:open-thread", {
            bubbles: true,
            detail: { eventId: threadRootEventId },
          })
        );
      });
      const actionsDiv = el.querySelector<HTMLElement>(".message__actions");
      if (actionsDiv) {
        el.insertBefore(indicator, actionsDiv);
      } else {
        el.appendChild(indicator);
      }
    }
  }

  /** Returns the last message-group-wrapper element, or null. */
  getLastGroupWrapper(): HTMLElement | null {
    const last = this._listEl.lastElementChild;
    return last?.classList.contains("message-group-wrapper") ? (last as HTMLElement) : null;
  }

  /**
   * Returns the element that was most recently appended via appendMessageHidden.
   * For a new group this is the .message-group-wrapper; for a merge it's the
   * .message inside the existing group. Used by the send animation to aim the
   * flying clone at the correct target.
   */
  getLastHiddenEl(): HTMLElement | null {
    return this._lastHiddenEl;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _updateJumpToLatestVisibility(): void {
    const visible = this._inContextView || this._scrolledUp;
    this._jumpToLatestBtn.style.display = visible ? "block" : "none";
  }

  private _setSelected(index: number): void {
    // Remove previous highlight
    if (this._selectedIndex >= 0) {
      const prev = this._getMessageElement(this._selectedIndex);
      if (prev) {
        prev.classList.remove("message--selected");
        const prevGroup = prev.closest<HTMLElement>(".message-group");
        if (prevGroup) prevGroup.classList.remove("message-group--selected");
      }
    }

    this._selectedIndex = index;

    // Apply new highlight
    if (index >= 0) {
      const el = this._getMessageElement(index);
      if (el) {
        el.classList.add("message--selected");
        const group = el.closest<HTMLElement>(".message-group");
        if (group) group.classList.add("message-group--selected");
        this._scrollIntoViewWithScrolloff(el);
      }
    }
  }

  /**
   * Scroll the selected message element into view with a "scrolloff" margin,
   * similar to vim's scrolloff option. Ensures the target element has at least
   * SCROLLOFF_PX of padding on the near edge within the scrollable container,
   * so the selected message is never flush against the viewport edge.
   * If the element is already fully within the scrolloff zone, no scroll occurs.
   */
  private _scrollIntoViewWithScrolloff(el: HTMLElement): void {
    const SCROLLOFF_PX = 80; // ~2-3 message rows of padding
    const containerRect = this._el.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    const topEdge = elRect.top - containerRect.top;
    const bottomEdge = elRect.bottom - containerRect.top;
    const containerHeight = containerRect.height;

    if (topEdge < SCROLLOFF_PX) {
      // Element is too close to (or above) the top — scroll up
      this._el.scrollTop -= SCROLLOFF_PX - topEdge;
    } else if (bottomEdge > containerHeight - SCROLLOFF_PX) {
      // Element is too close to (or below) the bottom — scroll down
      this._el.scrollTop += bottomEdge - (containerHeight - SCROLLOFF_PX);
    }
    // If already within the scrolloff zone, no adjustment needed
  }

  /** Find the DOM element for a message by its index in _messages. */
  private _getMessageElement(index: number): HTMLElement | null {
    if (index < 0 || index >= this._messages.length) return null;
    const id = this._messages[index].id;
    return this._listEl.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
  }

  /**
   * Insert a `── NEW ──` separator in the DOM before the first unread message.
   * Relies on `_unreadCount` and the rendered `[data-message-id]` elements.
   */
  private _insertUnreadSeparator(): void {
    if (this._unreadCount <= 0 || this._messages.length === 0) return;
    // Remove any stale separator from a previous load
    this._listEl.querySelector(".unread-separator")?.remove();

    const firstUnreadIndex = Math.max(0, this._messages.length - this._unreadCount);
    const firstUnreadMsg = this._messages[firstUnreadIndex];
    if (!firstUnreadMsg) return;

    const msgEl = this._listEl.querySelector<HTMLElement>(
      `[data-message-id="${firstUnreadMsg.id}"]`
    );
    if (!msgEl) return;

    // The message element lives inside a .message-group or .message--ungrouped.
    // Insert the separator before whichever top-level node contains the message.
    let insertBefore: HTMLElement = msgEl;
    while (insertBefore.parentElement && insertBefore.parentElement !== this._listEl) {
      insertBefore = insertBefore.parentElement;
    }

    const sep = document.createElement("div");
    sep.className = "unread-separator";
    sep.setAttribute("role", "separator");
    sep.setAttribute("aria-label", "New messages");
    sep.textContent = "── new messages ──";
    this._listEl.insertBefore(sep, insertBefore);
  }

  private _renderAll(): void {
    this._listEl.innerHTML = "";
    const groups = groupMessages(this._messages);
    const fragment = document.createDocumentFragment();
    for (const entry of groups) {
      if (Array.isArray(entry)) {
        fragment.appendChild(buildMessageGroup(entry));
      } else if ("type" in entry && entry.type === "time-separator") {
        fragment.appendChild(buildTimeSeparator(entry.timestamp));
      } else {
        // Ungrouped (system) message
        const el = buildMessageElement(entry as MessageData);
        el.classList.add("message--ungrouped");
        fragment.appendChild(el);
      }
    }
    this._listEl.appendChild(fragment);
  }

  private _scrollToBottom(): void {
    this._el.scrollTop = this._el.scrollHeight;
    this._scrolledUp = false;
    this._updateJumpToLatestVisibility();
  }

  /**
   * Instant scroll to bottom (so layout is accurate for measurements) with a
   * visual counter-animation that hides the jump. The transform is deferred to
   * the next rAF so that callers can still call getBoundingClientRect() on
   * newly appended elements in the same synchronous execution context and get
   * accurate positions.
   */
  private _scrollAnimated(): void {
    const prevScrollTop = this._el.scrollTop;
    this._el.scrollTop = this._el.scrollHeight;
    this._scrolledUp = false;
    const delta = this._el.scrollTop - prevScrollTop;
    if (delta <= 0) return;

    // Defer the visual counter-offset so measurements in the current frame are clean
    requestAnimationFrame(() => {
      this._listEl.style.transition = "none";
      this._listEl.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        this._listEl.style.transition = "transform 260ms cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        this._listEl.style.transform = "translateY(0)";
      });
      if (this._scrollAnimCleanupTimer !== null) clearTimeout(this._scrollAnimCleanupTimer);
      this._scrollAnimCleanupTimer = setTimeout(() => {
        this._scrollAnimCleanupTimer = null;
        this._listEl.style.transition = "";
        this._listEl.style.transform = "";
      }, 300);
    });
  }
}
