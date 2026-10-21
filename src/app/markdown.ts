// Lightweight markdown → Matrix HTML (org.matrix.custom.html) for the compose
// box (#54). Deliberately small and chat-oriented (Discord-style conventions)
// rather than a full CommonMark implementation:
//
//   **bold**      → <strong>
//   *italic*      → <em>
//   __underline__ → <u>
//   ~~strike~~    → <del>
//   ||spoiler||   → <span data-mx-spoiler> (MSC2010, rendered blur-until-click)
//   `code`        → <code>
//   [text](url)   → <a href="url"> (http/https/mailto/matrix only; the label is
//                   parsed, the URL is literal)
//
// Block quotes: consecutive lines starting with `>` (optionally `> `) become one
// <blockquote> (#118). What is inside is parsed like a message of its own, so a
// fence can sit in a quote and `> > a` nests (32 levels at most; see
// MAX_QUOTE_DEPTH).
//
// Fenced code blocks: a line of three or more backticks or tildes opens one, and
// a line of at least as many of the same character closes it, as in CommonMark.
// The first word of the info string, when it is a plausible language name,
// becomes `class="language-<word>"` — the Matrix spec's syntax-highlighting
// hint. The block goes out as <pre><code> with its newlines kept literal. An
// unclosed fence runs to the end of its container (the message, or the quote it
// sits in) — except one with nothing after it, which stays text, so a lone ```
// sent with Ctrl+Enter isn't an empty box.
//
// The newline touching a quote or code block (and one blank line after/before
// it) is dropped, so no stray <br> sits around the block. Newlines elsewhere
// become <br>: other clients render formatted_body as ordinary HTML, where a
// bare newline collapses to a space.
//
// Code — fenced blocks and inline spans alike — is literal: no markdown, no
// emoji of either kind. A code span binds tighter than every other marker, as
// in CommonMark. `mapProse` exposes the same prose/code split, so the plain
// body's Unicode-shortcode pass skips exactly the code this file leaves alone
// (a Nix lambda `a:b:a+b` must not become `a🅱️a+b`), and the two bodies agree.
//
// We use `*` (not `_`) for italic and require double underscores for underline,
// so snake_case identifiers aren't mangled. Custom emoji shortcodes are
// resolved to <img data-mx-emoticon> (MSC2545) and pass through formatting
// untouched.

export interface MarkdownOptions {
  /** Resolve a custom-emoji shortcode to an mxc URL, or undefined if not custom. */
  resolveEmoji?: (shortcode: string) => string | undefined;
}

const SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;

// Sentinel that brackets a stashed fragment (a resolved custom emoji, a code
// span). A NUL byte never appears in user text, isn't a regex metacharacter,
// and is left untouched by the HTML escaper — so stashed HTML survives inline
// formatting and escaping intact.
const PH = String.fromCharCode(0);

interface InlineRule {
  /** Capture group 1 is the inner content; later groups go to `render`. */
  re: RegExp;
  render: (inner: string, match: RegExpExecArray) => string;
}

/**
 * `[label](url)`. The scheme is part of the pattern rather than checked after a
 * match, so a link with any other scheme (`javascript:`, a relative path) never
 * matches and stays literal text — there is no half-rendered state. One level
 * of balanced parentheses is allowed in the URL, for the Wikipedia-style
 * `…/Foo_(bar)`; whitespace ends it, as in CommonMark. The NUL of a stashed
 * placeholder ends it too, so a `:shortcode:` that happens to sit in a URL can
 * never splice an `<img>` into an `href`.
 */
const LINK_RE =
  /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|matrix:)(?:[^()\s\x00]|\([^()\s\x00]*\))+)\)/;

// Code spans are not here: they are cut out before these run (see renderProse).
const RULES: InlineRule[] = [
  { re: LINK_RE, render: (s, m) => `<a href="${escapeAttr(m[2])}">${s}</a>` },
  { re: /\|\|([\s\S]+?)\|\|/, render: (s) => `<span data-mx-spoiler>${s}</span>` },
  { re: /\*\*([\s\S]+?)\*\*/, render: (s) => `<strong>${s}</strong>` },
  { re: /__([\s\S]+?)__/, render: (s) => `<u>${s}</u>` },
  { re: /~~([\s\S]+?)~~/, render: (s) => `<del>${s}</del>` },
  { re: /\*([\s\S]+?)\*/, render: (s) => `<em>${s}</em>` },
];

/** A code span. One line at most, so splitting per line or per block agrees. */
const CODE_SPAN_RE = /(`[^`\n]+?`)/;

const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, "&quot;");

/**
 * Convert compose-box markdown to a Matrix HTML formatted_body, with custom
 * emoji shortcodes resolved to images. Returns `undefined` when the text has
 * no formatting and no custom emoji, signalling a plain-text message.
 */
export function markdownToHtml(text: string, opts: MarkdownOptions = {}): string | undefined {
  const st: RenderState = { resolveEmoji: opts.resolveEmoji, stash: [], markup: false };
  const html = renderBlocks(parseBlocks(sourceLines(text)), st);
  if (!st.markup) return undefined;

  // Restore stashed fragments as raw HTML. Newlines were already turned into
  // <br> (or kept literal inside <pre>) — the plain body keeps its line breaks,
  // and the formatted one has to say the same thing to a client that doesn't
  // render it pre-wrapped.
  return html.replace(
    new RegExp(`${PH}(\\d+)${PH}`, "g"),
    (_full, i: string) => st.stash[Number(i)] ?? "",
  );
}

/**
 * Apply `fn` to the prose of compose-box text — everything outside fenced code
 * blocks and code spans — and return the text otherwise byte-for-byte as it was
 * (line endings, quote markers and code included). `fn` sees the prose a piece
 * at a time, never across a line break or a code span. "Code" here is exactly
 * what {@link markdownToHtml} renders as code.
 */
export function mapProse(text: string, fn: (prose: string) => string): string {
  return segments(text).map((s) => (s.kind === "prose" ? fn(s.text) : s.text)).join("");
}

/**
 * The text with its code (fenced blocks and code spans) blanked to a space, so
 * the prose either side doesn't fuse. For finding things meant as prose — the
 * URL a message's preview card is for, not one in a pasted config.
 */
export function withoutCode(text: string): string {
  // Code needs a backtick (a span, a ``` fence) or a ~~~ fence. Most bodies
  // have neither, and this runs on every message the timeline renders.
  if (!/`|~~~/.test(text)) return text;
  return segments(text).map((s) => (s.kind === "code" ? " " : s.text)).join("");
}

/**
 * Whether `caret` sits inside a fenced code block that is still open there —
 * opened on an earlier line (or this one), not yet closed. Enter inserts a
 * newline there instead of sending (see send_behavior.ts). Only top-level
 * fences count; one inside a `>` quote is too rare in a compose box to give
 * Enter a second meaning for.
 */
export function insideCodeFence(text: string, caret: number = text.length): boolean {
  let fence: Fence | null = null;
  for (const line of text.slice(0, caret).split(/\r?\n/)) {
    if (!fence) fence = openFence(line);
    else if (closesFence(line, fence)) fence = null;
  }
  return fence !== null;
}

// ── Fences ───────────────────────────────────────────────────────────────────

/**
 * What a fence may name as its language. The backend's HTML sanitizer keeps a
 * `language-*` class only when the name matches this, so anything else —
 * pandoc's `{.python}`, an attribute-breaking `"><img` — goes out unlabelled.
 */
const LANG_RE = /^[\w+#.-]+$/;

const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

interface Fence {
  /** The run that opened it; only the same character, at least as many, closes it. */
  marker: string;
  /** Spaces before the opener; up to this many are stripped from each content line. */
  indent: number;
  lang: string | undefined;
}

/** The fence a line opens, or null if it opens none. */
function openFence(line: string): Fence | null {
  const m = FENCE_OPEN_RE.exec(line);
  if (!m) return null;
  const [, indent, marker, info] = m;
  // A backtick fence's info string can't hold a backtick (CommonMark), which
  // keeps a one-line ```like this``` from opening a block that swallows the
  // rest of the message.
  if (marker[0] === "`" && info.includes("`")) return null;
  const word = info.trim().split(/\s+/)[0];
  return { marker, indent: indent.length, lang: LANG_RE.test(word) ? word : undefined };
}

/** Whether a line closes `fence`. A would-be closer with an info string is content. */
function closesFence(line: string, fence: Fence): boolean {
  const m = FENCE_CLOSE_RE.exec(line);
  return m !== null && m[1][0] === fence.marker[0] && m[1].length >= fence.marker.length;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

/**
 * A source line, or what is left of one once a quote marker or a fence's
 * indent is stripped — always a suffix of the source line. `n` is the source
 * line's index, so {@link segments} can put each line's pieces back in place.
 */
interface Line {
  n: number;
  text: string;
}

type Block =
  | { kind: "text"; lines: Line[] }
  | { kind: "quote"; blocks: Block[] }
  // `fences` are the opening line and, unless it ran unclosed, the closing one.
  | { kind: "code"; lang: string | undefined; lines: Line[]; fences: Line[] };

const QUOTE_RE = /^ {0,3}>[ ]?(.*)$/;

/**
 * How deep `>` quotes nest before the rest of the `>`s stay literal text. Each
 * level is a recursion (here, in renderBlocks, in segments), and withoutCode
 * runs on every incoming message body the timeline renders: a body of a few
 * thousand `>`s from any room member would otherwise overflow the stack and
 * leave the whole room blank, every time it is opened. No real reply chain
 * gets near this.
 */
const MAX_QUOTE_DEPTH = 32;

const sourceLines = (text: string): Line[] =>
  text.split(/\r?\n/).map((line, n) => ({ n, text: line }));

const joinLines = (lines: Line[]): string => lines.map((l) => l.text).join("\n");

/**
 * Group lines into text, `>` quote and fenced code blocks. `depth` is how many
 * quotes these lines already sit in; at {@link MAX_QUOTE_DEPTH} a `>` line is
 * plain text.
 */
function parseBlocks(lines: Line[], depth = 0): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const code = fencedBlock(lines, i);
    if (code) {
      blocks.push(code.block);
      i = code.next;
      continue;
    }
    if (depth < MAX_QUOTE_DEPTH && QUOTE_RE.test(lines[i].text)) {
      const quoted: Line[] = [];
      for (; i < lines.length; i++) {
        const q = QUOTE_RE.exec(lines[i].text);
        if (!q) break;
        quoted.push({ n: lines[i].n, text: q[1] });
      }
      blocks.push({ kind: "quote", blocks: parseBlocks(quoted, depth + 1) });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last?.kind === "text") last.lines.push(lines[i]);
    else blocks.push({ kind: "text", lines: [lines[i]] });
    i++;
  }

  // Drop the one blank line separating a text run from an adjacent quote or
  // code block: the block's own edges already break the line.
  const isBlock = (b: Block | undefined): boolean => b !== undefined && b.kind !== "text";
  blocks.forEach((b, j) => {
    if (b.kind !== "text") return;
    if (isBlock(blocks[j - 1]) && b.lines[0]?.text === "") b.lines.shift();
    if (isBlock(blocks[j + 1]) && b.lines[b.lines.length - 1]?.text === "") b.lines.pop();
  });
  return blocks;
}

/** The fenced code block opening at `lines[i]` and the index just past it, or null. */
function fencedBlock(lines: Line[], i: number): { block: Block; next: number } | null {
  const fence = openFence(lines[i].text);
  if (!fence) return null;
  let end = i + 1;
  while (end < lines.length && !closesFence(lines[end].text, fence)) end++;
  const closed = end < lines.length;
  const content = lines.slice(i + 1, end);
  if (!closed) {
    // Unclosed, the block runs to the end of its container (CommonMark), less
    // the blank lines that only separate it from whatever ends the container…
    while (content.length > 0 && content[content.length - 1].text.trim() === "") content.pop();
    // …and with nothing in it there is no block: a lone ```nix reads as typed.
    if (content.length === 0) return null;
  }
  return {
    block: {
      kind: "code",
      lang: fence.lang,
      lines: content.map((l) => ({ n: l.n, text: l.text.replace(/^ */, (s) => s.slice(fence.indent)) })),
      fences: closed ? [lines[i], lines[end]] : [lines[i]],
    },
    next: closed ? end + 1 : lines.length,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

interface RenderState {
  resolveEmoji: MarkdownOptions["resolveEmoji"];
  /** HTML held behind placeholders until the end: emoji <img>s and code spans. */
  stash: string[];
  /** Whether the output says anything plain text can't (else it's not sent). */
  markup: boolean;
}

function renderBlocks(blocks: Block[], st: RenderState): string {
  // Joined with "": bodies render pre-wrapped, so a "\n" between blocks would
  // show as a blank line.
  return blocks
    .map((b): string => {
      switch (b.kind) {
        case "code": {
          st.markup = true;
          const cls = b.lang ? ` class="language-${escapeAttr(b.lang)}"` : "";
          return `<pre><code${cls}>${escapeText(joinLines(b.lines))}</code></pre>`;
        }
        case "quote":
          st.markup = true;
          return `<blockquote>${renderBlocks(b.blocks, st)}</blockquote>`;
        case "text":
          return renderProse(joinLines(b.lines), st);
      }
    })
    .join("");
}

/**
 * Render a run of prose lines. Code spans and resolvable custom emoji are
 * stashed first, so the inline rules can't reach into either — which is also
 * what keeps a `:shortcode:` inside a code span literal.
 */
function renderProse(text: string, st: RenderState): string {
  const staged = splitCodeSpans(text)
    .map((s) =>
      s.kind === "code"
        ? stash(st, `<code>${escapeText(s.text.slice(1, -1))}</code>`)
        : stageEmoji(s.text, st),
    )
    .join("");
  return renderInline(staged, () => {
    st.markup = true;
  }).replace(/\n/g, "<br>");
}

/** Swap resolvable custom emoji for placeholders; unknown shortcodes stay text. */
function stageEmoji(text: string, st: RenderState): string {
  return text.replace(SHORTCODE_RE, (full, shortcode: string) => {
    const mxc = st.resolveEmoji?.(shortcode);
    if (!mxc) return full;
    // Escaped: the URL comes from an emoji pack, room state any member with
    // the power level can write, and this HTML is the unsanitized local echo.
    return stash(st, `<img data-mx-emoticon src="${escapeAttr(mxc)}" alt=":${shortcode}:" title=":${shortcode}:">`);
  });
}

/** Hold `html` back behind a placeholder the inline rules and escaper pass over. */
function stash(st: RenderState, html: string): string {
  st.markup = true;
  st.stash.push(html);
  return `${PH}${st.stash.length - 1}${PH}`;
}

function renderInline(text: string, onMatch: () => void): string {
  // Pick the earliest match across all rules; on a tie, the longest marker
  // wins so `**` beats `*` and `||` beats a stray `|`.
  let best: { index: number; len: number; rule: InlineRule; match: RegExpExecArray } | null = null;
  for (const rule of RULES) {
    const m = new RegExp(rule.re.source).exec(text);
    if (!m) continue;
    if (
      best === null ||
      m.index < best.index ||
      (m.index === best.index && m[0].length > best.len)
    ) {
      best = { index: m.index, len: m[0].length, rule, match: m };
    }
  }

  if (!best) return escapeText(text);

  onMatch();
  const before = text.slice(0, best.index);
  const after = text.slice(best.index + best.len);
  const innerHtml = renderInline(best.match[1], onMatch);
  return escapeText(before) + best.rule.render(innerHtml, best.match) + renderInline(after, onMatch);
}

// ── Prose / code segmentation ────────────────────────────────────────────────

/** A piece of source text: prose, code, or markup (quote markers, fence indent, line breaks). */
interface Segment {
  kind: "prose" | "code" | "markup";
  text: string;
}

/** Split prose into prose and code-span segments, losslessly. */
function splitCodeSpans(text: string): Segment[] {
  // split() with a capturing group puts each match at an odd index.
  return text.split(CODE_SPAN_RE).map((s, i) => ({ kind: i % 2 ? "code" : "prose", text: s }));
}

/**
 * Cut `text` into segments that concatenate back to exactly `text`. Built from
 * the same parse markdownToHtml renders, so the two never disagree on what is
 * code.
 */
function segments(text: string): Segment[] {
  const lines = sourceLines(text);
  const breaks = text.match(/\r?\n/g) ?? [];
  const byLine = new Map<number, Segment[]>();
  const visit = (blocks: Block[]): void => {
    for (const b of blocks) {
      if (b.kind === "quote") {
        visit(b.blocks);
        continue;
      }
      for (const line of b.kind === "code" ? [...b.fences, ...b.lines] : b.lines) {
        const src = lines[line.n].text;
        byLine.set(line.n, [
          { kind: "markup", text: src.slice(0, src.length - line.text.length) },
          ...(b.kind === "code" ? [{ kind: "code" as const, text: line.text }] : splitCodeSpans(line.text)),
        ]);
      }
    }
  };
  visit(parseBlocks(lines));

  // A line no block claims (a blank one dropped beside a block, one trailing an
  // unclosed fence) is blank: keep it as it was.
  return lines
    .flatMap((line, n): Segment[] => [
      ...(byLine.get(n) ?? [{ kind: "markup", text: line.text }]),
      { kind: "markup", text: breaks[n] ?? "" },
    ])
    .filter((s) => s.text !== "");
}
