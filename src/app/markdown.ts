// Lightweight inline markdown → Matrix HTML (org.matrix.custom.html) for the
// compose box (#54). Deliberately small and chat-oriented (Discord-style
// conventions) rather than a full CommonMark implementation:
//
//   **bold**      → <strong>
//   *italic*      → <em>
//   __underline__ → <u>
//   ~~strike~~    → <del>
//   ||spoiler||   → <span data-mx-spoiler> (MSC2010, rendered blur-until-click)
//   `code`        → <code> (content is literal — not parsed or emoji-replaced)
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

// Sentinel that brackets a resolved-emoji placeholder. A NUL byte never appears
// in user text, isn't a regex metacharacter, and is left untouched by the HTML
// escaper — so staged emoji survive inline formatting and escaping intact.
const PH = String.fromCharCode(0);

interface InlineRule {
  re: RegExp;
  render: (inner: string) => string;
  /** Content is literal: escaped but not recursively parsed (inline code). */
  raw?: boolean;
}

const RULES: InlineRule[] = [
  { re: /`([^`\n]+?)`/, render: (s) => `<code>${s}</code>`, raw: true },
  { re: /\|\|([\s\S]+?)\|\|/, render: (s) => `<span data-mx-spoiler>${s}</span>` },
  { re: /\*\*([\s\S]+?)\*\*/, render: (s) => `<strong>${s}</strong>` },
  { re: /__([\s\S]+?)__/, render: (s) => `<u>${s}</u>` },
  { re: /~~([\s\S]+?)~~/, render: (s) => `<del>${s}</del>` },
  { re: /\*([\s\S]+?)\*/, render: (s) => `<em>${s}</em>` },
];

const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Convert compose-box markdown to a Matrix HTML formatted_body, with custom
 * emoji shortcodes resolved to images. Returns `undefined` when the text has
 * no formatting and no custom emoji, signalling a plain-text message.
 */
export function markdownToHtml(text: string, opts: MarkdownOptions = {}): string | undefined {
  // 1. Swap resolvable custom emoji out for placeholders so formatting doesn't
  //    touch them and their shortcode text isn't escaped.
  const emojiHtml: string[] = [];
  const staged = text.replace(SHORTCODE_RE, (full, shortcode: string) => {
    const mxc = opts.resolveEmoji?.(shortcode);
    if (!mxc) return full;
    const idx = emojiHtml.length;
    emojiHtml.push(
      `<img data-mx-emoticon src="${mxc}" alt=":${shortcode}:" title=":${shortcode}:">`,
    );
    return `${PH}${idx}${PH}`;
  });

  // 2. Render inline markdown, tracking whether anything actually matched.
  let formatted = false;
  const html = renderInline(staged, () => {
    formatted = true;
  });

  if (emojiHtml.length === 0 && !formatted) return undefined;

  // 3. Restore emoji placeholders as raw HTML.
  return html.replace(
    new RegExp(`${PH}(\\d+)${PH}`, "g"),
    (_full, i: string) => emojiHtml[Number(i)] ?? "",
  );
}

function renderInline(text: string, onMatch: () => void): string {
  // Pick the earliest match across all rules; on a tie, the longest marker
  // wins so `**` beats `*` and `||` beats a stray `|`.
  let best: { index: number; len: number; rule: InlineRule; inner: string } | null = null;
  for (const rule of RULES) {
    const m = new RegExp(rule.re.source).exec(text);
    if (!m) continue;
    if (
      best === null ||
      m.index < best.index ||
      (m.index === best.index && m[0].length > best.len)
    ) {
      best = { index: m.index, len: m[0].length, rule, inner: m[1] };
    }
  }

  if (!best) return escapeText(text);

  onMatch();
  const before = text.slice(0, best.index);
  const after = text.slice(best.index + best.len);
  const innerHtml = best.rule.raw ? escapeText(best.inner) : renderInline(best.inner, onMatch);
  return escapeText(before) + best.rule.render(innerHtml) + renderInline(after, onMatch);
}
