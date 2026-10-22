// Rendering a message body: the `formatted_body` HTML path, the plain-text
// path, and the MSC2530 media caption that sits beneath an image.
//
// Neither belongs to Timeline or ThreadView — both surfaces render both, and
// while these lived in Timeline the thread panels imported one of them across a
// circular edge and reimplemented the other. Keeping them here is what lets a
// change to escaping, spoilers or emoji resolution land on every surface at once
// rather than on whichever one the author had open.

import { appendLinkifiedText, decorateMessageLinks } from "../app/links.js";
import { plainFences, splitFencedCode } from "../app/markdown.js";
import { highlightCodeBlocks, MAX_BLOCKS_PER_BODY } from "./code_highlight.js";

/** HTML whitespace (not `\s`, which would also take a deliberate U+00A0). */
const WHITESPACE_ONLY = /^[ \t\n\f\r]*$/;

/**
 * Activate Matrix spoilers (MSC2010 / `data-mx-spoiler`) inside a freshly
 * rendered message body. The server-supplied HTML already contains
 * `<span data-mx-spoiler[="reason"]>…</span>`; on its own that renders as plain
 * text. Here we obscure each spoiler (the CSS `.message__spoiler` rule blurs it)
 * and reveal it on click/tap. An optional reason is exposed as a tooltip.
 */
export function setupSpoilers(container: HTMLElement): void {
  for (const span of Array.from(container.querySelectorAll<HTMLElement>("[data-mx-spoiler]"))) {
    if (span.classList.contains("message__spoiler")) continue; // already wired
    span.classList.add("message__spoiler");
    span.setAttribute("role", "button");
    span.setAttribute("tabindex", "0");
    const reason = span.getAttribute("data-mx-spoiler");
    span.title = reason ? `Spoiler: ${reason}` : "Spoiler — click to reveal";
    const reveal = (e: Event): void => {
      if (span.classList.contains("message__spoiler--revealed")) return;
      // Stop the reveal tap from also selecting the message / opening a menu.
      e.preventDefault();
      e.stopPropagation();
      span.classList.add("message__spoiler--revealed");
      span.removeAttribute("role");
      span.removeAttribute("tabindex");
    };
    span.addEventListener("click", reveal);
    span.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") reveal(e);
    });
  }
}

/**
 * Render a message's `formatted_body` HTML into `el`.
 *
 * Three places did this inline and each did a little less than the last — the
 * inline thread panel skipped the mxc:// stash entirely, so a custom emoji there
 * kept an unloadable `mxc://` src and drew a broken-image icon. Captions are a
 * fourth caller (#84), which is what made a fourth copy worth not writing.
 *
 * The stash is the point: a custom-emoji `<img>` arrives with an `mxc://` src no
 * browser can load, so the URL moves to `data-mxc` and the src goes away until
 * `_downloadInlineEmoji` swaps in a `data:` URL. `getPendingInlineEmojiUrls`
 * queries the whole list element, so anything rendered *into it* is covered —
 * but only once something runs the resolver. Every path that renders bodies has
 * to call it: the thread panel renders into the list and still went without,
 * which left its custom emoji blank until an unrelated sync event in the room
 * happened to resolve them.
 *
 * `el` gains the `message-html` class, which is what the stylesheet scopes
 * code-block rules to — every caller passes its own body class, and this keeps
 * that list out of the CSS. Code blocks are syntax-highlighted here too, so
 * every surface gets it: synchronously when the same text was highlighted
 * before, otherwise a moment later, off the main thread (code_highlight.ts).
 *
 * `plainBody`, the event's plain `body`, lets fenced code the HTML shows as
 * text become code blocks (repairTextFences).
 */
export function renderFormattedBody(el: HTMLElement, html: string, plainBody?: string): void {
  // In production this must be sanitized server-side or with DOMPurify; for the
  // UI shell we accept pre-trusted HTML.
  el.innerHTML = html;
  for (const img of el.querySelectorAll<HTMLImageElement>("img[data-mx-emoticon]")) {
    const src = img.getAttribute("src") ?? img.src;
    if (src.startsWith("mxc://")) {
      img.dataset.mxc = src;
      img.removeAttribute("src");
    }
  }
  if (plainBody !== undefined) repairTextFences(el, html, plainBody);
  el.classList.add("message-html");
  // Bodies are `white-space: pre-wrap`, so the newline other clients put
  // between block tags renders as a blank line. Element sends
  // `<p>…</p>\n<pre>…</pre>\n`, which framed every code block in empty lines.
  // Only around <pre>: elsewhere the same whitespace may be all that separates
  // two inline runs (`<b>a</b> <i>b</i>`).
  for (const pre of el.querySelectorAll("pre")) {
    for (const sibling of [pre.previousSibling, pre.nextSibling]) {
      if (sibling?.nodeType === Node.TEXT_NODE && WHITESPACE_ONLY.test(sibling.textContent ?? "")) {
        sibling.remove();
      }
    }
  }
  // Give anchors from formatted_body the same class, rel and tooltip the
  // linkifier gives bare URLs (#51), and strip non-http hrefs so nothing can
  // navigate the WebView. Activation goes through the global link guard in
  // app/links.ts, so no per-anchor listener is attached here.
  decorateMessageLinks(el);
  setupSpoilers(el);
  // Not awaited: the body reads fine as plain text, and a result that arrives
  // later applies itself.
  void highlightCodeBlocks(el);
}

/**
 * Render a message with no `formatted_body`: its text, linkified, with any
 * top-level ``` fences drawn as code blocks.
 *
 * The fences are for messages written as code but sent as plain text — every
 * one Quark sent before it had fence support, and what bots and bridges still
 * send. Nothing else in the text is read as markdown (see splitFencedCode):
 * plain text isn't markdown, but a fence says what it is plainly enough. The
 * blocks are built with the DOM, never HTML, as the same
 * `<pre><code class="language-…">` the composer sends, so they look and
 * highlight the same. A body with more fences than MAX_BLOCKS_PER_BODY is left
 * as text, so one message can't turn into thousands of elements.
 */
export function renderPlainBody(el: HTMLElement, text: string): void {
  el.replaceChildren();
  const pieces = splitFencedCode(text);
  const blocks = pieces.filter((p) => p.kind === "code").length;
  if (blocks === 0 || blocks > MAX_BLOCKS_PER_BODY) {
    el.classList.remove("message-html");
    appendLinkifiedText(el, text);
    return;
  }
  // The code-block styles are scoped to it, as for an HTML body.
  el.classList.add("message-html");
  for (const piece of pieces) {
    if (piece.kind === "text") {
      appendLinkifiedText(el, piece.text);
      continue;
    }
    el.appendChild(codeBlock(piece.lang, piece.text));
  }
  void highlightCodeBlocks(el);
}

/**
 * Render a message body into `el`, replacing what was there: the
 * `formatted_body` when the event has one, else the plain body. Every surface
 * that draws a text message — and an in-place edit — goes through here, so the
 * two paths can't drift apart per caller.
 */
export function renderMessageBody(el: HTMLElement, body: string, htmlBody?: string): void {
  if (htmlBody) renderFormattedBody(el, htmlBody, body);
  else renderPlainBody(el, body);
}

// ── Fences sent as text in HTML ─────────────────────────────────────────────

/**
 * Elements whose edges break a line the way a <br> does. A fence line inside
 * one isn't beside a <br>, but it still starts a line of its own.
 */
const BLOCK_TAGS = new Set([
  "BLOCKQUOTE", "DETAILS", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "HR",
  "LI", "OL", "P", "PRE", "SUMMARY", "TABLE", "TR", "UL",
]);

/**
 * A rendered body's text as one string, with where each character came from:
 * a position in a text node, a <br> or <img> (a "\n" or U+FFFC), or `null` for
 * what no node holds and nothing can delete: the line break at a block
 * element's edge, and the `>` that starts each line of a quote, as it does in
 * the plain body.
 */
interface FlatText {
  text: string;
  at: Array<Spot | null>;
}

/** A character of a FlatText: one in a text node, or a <br> or <img>. */
type Spot = { node: Text; offset: number } | Element;

/**
 * How deep a body's elements may nest for its fences to be repaired. Each
 * block is lifted out level by level, so a crafted body 500 deep with 64
 * fences took most of a second; a reply quoting a list item's bold spoiler is
 * still under ten.
 */
const MAX_REPAIR_DEPTH = 32;

/** `root`'s FlatText, or null when it nests deeper than MAX_REPAIR_DEPTH. */
function flatten(root: Element): FlatText | null {
  const chars: string[] = [];
  const at: FlatText["at"] = [];
  let quotes = 0;
  const push = (ch: string, spot: Spot | null): void => {
    if (quotes > 0 && ch !== "\n" && (chars.length === 0 || chars[chars.length - 1] === "\n")) {
      chars.push(">");
      at.push(null);
    }
    chars.push(ch);
    at.push(spot);
  };
  const walk = (parent: Node, depth: number): boolean => {
    if (depth > MAX_REPAIR_DEPTH) return false;
    for (const child of parent.childNodes) {
      if (child instanceof Text) {
        for (let i = 0; i < child.data.length; i++) push(child.data[i], { node: child, offset: i });
      } else if (child instanceof Element) {
        if (child.tagName === "BR" || child.tagName === "IMG") {
          push(child.tagName === "BR" ? "\n" : "\uFFFC", child);
          continue;
        }
        const block = BLOCK_TAGS.has(child.tagName);
        const quote = child.tagName === "BLOCKQUOTE";
        if (block) push("\n", null);
        if (quote) quotes++;
        if (!walk(child, depth + 1)) return false;
        if (quote) quotes--;
        if (block) push("\n", null);
      }
    }
    return true;
  };
  return walk(root, 0) ? { text: chars.join(""), at } : null;
}

/**
 * Swap the fenced code a body's HTML shows as text for code blocks, taking
 * the code from its plain body.
 *
 * Quark's formatter knew no fences until it did, and ran bold, italics,
 * spoilers and code spans over code lines too, so fenced code holding
 * `__init__`, `*args`, `a || b` or a backtick — most Python and shell — went
 * out as HTML with the ``` lines as text between <br>s and the code
 * underlined, italicised or spoilered. Other clients send fences as text in
 * HTML too, from Element with markdown off to bridges. Their plain body still
 * has the code as typed.
 *
 * Only the fences change. Each one plain text means as code (plainFences) is
 * found twice — in the plain body, and as lines of the HTML's rendered text —
 * and the stretch of the HTML from its opening line to its closing one is
 * replaced with a code block holding the plain body's code. Everything else
 * the sender's HTML says stays as sent: mentions, quotes, formatting from
 * whatever client sent it. Nothing is parsed as markdown, and the work is one
 * walk over the body. If the two don't find the same fences, in order, with
 * the same languages, or the HTML shows one across a block's edge, nothing
 * changes.
 *
 * No Range is used: WebKit keeps each one until it is collected and updates
 * every one on every later removal, anywhere in the document, so a Range per
 * block made a crafted body take minutes and slowed the timeline after it.
 */
function repairTextFences(el: HTMLElement, html: string, body: string): void {
  if (/<pre[\s>]/i.test(html) || !html.includes("```")) return;
  const wanted = plainFences(body);
  if (wanted.length === 0 || wanted.length > MAX_BLOCKS_PER_BODY) return;
  const flat = flatten(el);
  if (!flat) return;
  const found = plainFences(flat.text);
  if (found.length !== wanted.length || found.some((f, k) => f.lang !== wanted[k].lang)) return;

  const lineStarts = [0];
  for (let i = 0; i < flat.text.length; i++) if (flat.text[i] === "\n") lineStarts.push(i + 1);
  // Every stretch is checked before any is changed. `limit` is where the
  // stretch after this one starts: two fences a line apart share the break
  // between them, and only one of them can take it.
  const stretches: Array<[Spot, Spot]> = [];
  let limit = flat.text.length;
  for (let k = found.length - 1; k >= 0; k--) {
    const { open, close } = found[k];
    // [from, to): the fence lines and what's between them, plus the line break
    // each side and one blank line beside it — the block's own edges break the
    // line, as when the composer sends a block.
    let from = lineStarts[open];
    let to = close + 1 < lineStarts.length ? lineStarts[close + 1] - 1 : flat.text.length;
    for (let n = 0; n < 2 && from > 0 && flat.text[from - 1] === "\n" && flat.at[from - 1]; n++) from--;
    for (let n = 0; n < 2 && to < limit && flat.text[to] === "\n" && flat.at[to]; n++) to++;
    limit = from;
    // A fence opened in a quote and closed after it is one the plain body
    // doesn't have, since it reads `>` lines as text, even when the counts
    // agree.
    for (let i = from; i < to; i++) if (!flat.at[i]) return;
    stretches[k] = [flat.at[from]!, flat.at[to - 1]!];
  }
  // Last first, so the positions of the ones before it still hold.
  for (let k = stretches.length - 1; k >= 0; k--) {
    const pre = codeBlock(wanted[k].lang, wanted[k].code);
    replaceStretch(stretches[k][0], stretches[k][1], pre);
    hoist(pre, el);
  }
}

/**
 * Put `block` where the characters from `from` to `to` (inclusive) are,
 * splitting the text nodes they start and end in. The text before a split
 * keeps its node, so positions earlier in the body stay valid.
 */
function replaceStretch(from: Spot, to: Spot, block: Element): void {
  let last: ChildNode = to instanceof Element ? to : to.node;
  if (!(to instanceof Element) && to.offset + 1 < to.node.length) to.node.splitText(to.offset + 1);
  let first: ChildNode = from instanceof Element ? from : from.node;
  if (!(from instanceof Element) && from.offset > 0) {
    first = from.node.splitText(from.offset);
    if (last === from.node) last = first;
  }
  first.before(block);
  removeThrough(first, last);
}

/**
 * Remove `first`, `last` and every node between them in document order. The
 * elements `first` sits in keep what comes before it; those `last` sits in
 * keep what comes after it, and go if that is nothing, so no empty spoiler or
 * link is left behind.
 */
function removeThrough(first: ChildNode, last: ChildNode): void {
  if (first === last) {
    first.remove();
    return;
  }
  const lastPath = new Set<Node>();
  for (let n: Node | null = last; n; n = n.parentNode) lastPath.add(n);
  // Up from each end to the child of their common ancestor, dropping what lies
  // between them at each level.
  let top = first;
  for (; !lastPath.has(top.parentElement!); top = top.parentElement!) {
    while (top.nextSibling) top.nextSibling.remove();
  }
  const common = top.parentElement!;
  let bottom = last;
  for (; bottom.parentElement !== common; bottom = bottom.parentElement!) {
    while (bottom.previousSibling) bottom.previousSibling.remove();
  }
  while (top.nextSibling !== bottom) top.nextSibling!.remove();
  first.remove();
  for (let n = last; ; ) {
    const parent = n.parentElement!;
    n.remove();
    if (n === bottom || parent.hasChildNodes()) break;
    n = parent;
  }
}

/**
 * Lift a code block out of the inline elements it was put inside, splitting
 * each one at it: a spoiler or emphasis the old formatter opened before a
 * fence and closed inside the code would otherwise blur or slant the block.
 */
function hoist(block: Element, root: Element): void {
  // Sibling moves, not a Range: every Range left alive is updated on every
  // later mutation, and one per level made a deeply nested body take minutes.
  for (let parent = block.parentElement; parent && parent !== root && !BLOCK_TAGS.has(parent.tagName); parent = block.parentElement) {
    const copy = parent.cloneNode(false) as Element;
    while (block.nextSibling) copy.appendChild(block.nextSibling);
    parent.after(block);
    if (copy.firstElementChild || copy.textContent) block.after(copy);
    if (!parent.hasChildNodes()) parent.remove();
  }
}

/** A `<pre><code>` holding `code`, built with the DOM, as the composer sends one. */
function codeBlock(lang: string | undefined, code: string): HTMLPreElement {
  const pre = document.createElement("pre");
  const el = document.createElement("code");
  if (lang) el.className = `language-${lang}`;
  el.textContent = code;
  pre.appendChild(el);
  return pre;
}

/**
 * Render a media caption (MSC2530) beneath the media it belongs to.
 *
 * No-op when the event carried no caption — a bare-filename body is not one.
 * `bodyClass` is the caller's own message-body class; the shared
 * `message__image-caption` rides alongside it so every surface matches.
 *
 * A caption with a `formatted_body` renders as HTML, which is where an inline
 * custom emoji actually lives. Before that this set `textContent`, so a caption
 * using a custom emoji showed the literal `:shortcode:` — including captions
 * Quark itself had just sent.
 */
export function appendCaption(
  row: HTMLElement,
  bodyClass: string,
  caption?: string,
  captionHtml?: string,
): void {
  if (!caption) return;
  const el = document.createElement("div");
  el.className = `${bodyClass} message__image-caption`;
  if (captionHtml) {
    renderFormattedBody(el, captionHtml, caption);
  } else {
    el.textContent = caption;
  }
  row.appendChild(el);
}

/**
 * Build the click-to-open affordance for an `m.file` message.
 *
 * Lives here for the same reason the caption does: every surface that renders a
 * message renders files too. It stayed in Timeline while only the main timeline
 * could receive one, and when #78 let a file be sent into a thread both thread
 * renderers fell through to their text branch and drew the filename as an inert
 * line — no icon, no way to open it, before and after a reload.
 *
 * Opening is left to whoever handles the `quark:open-file` event it bubbles
 * (`media.ts` listens on `document`), so this stays free of IPC.
 */
export function buildFileAffordance(
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
