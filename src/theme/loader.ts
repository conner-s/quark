// Theme loader — applies theme data from the Tauri backend as CSS custom properties

export interface ThemeMeta {
  name: string;
  author?: string;
  version?: string;
}

export interface ThemeAccent {
  primary?: string;
  secondary?: string;
  error?: string;
  warning?: string;
  success?: string;
  link?: string;
}

export interface ThemeMessages {
  own?: string;
  other?: string;
  system?: string;
  timestamp?: string;
  mention_bg?: string;
  mention_fg?: string;
  reply_border?: string;
  thread_indicator?: string;
}

export interface ThemeRoomlist {
  active_bg?: string;
  active_fg?: string;
  unread?: string;
  mention_badge?: string;
  muted?: string;
}

export interface ThemeReactions {
  background?: string;
  border?: string;
  own_bg?: string;
  count?: string;
}

export interface ThemeTypography {
  font_family?: string;
  font_size?: number;
  line_height?: number;
  message_spacing?: number;
}

/** Every `borders.style` quark draws. FRAME_STYLES must give each one a look. */
export const BORDER_STYLES = ["single", "double", "rounded", "ascii", "none"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export interface ThemeBorders {
  style?: BorderStyle;
  room_list_width?: string;
}

export interface ThemeEmoji {
  size?: number;
  sticker_max_size?: number;
  reaction_size?: number;
}

export interface ThemePrompt {
  normal_indicator?: string;
  insert_indicator?: string;
  command_indicator?: string;
  visual_indicator?: string;
}

/**
 * `[colors.syntax]` — code block surface and highlight.js token colours. Keys
 * are flat on purpose: a dotted TOML key (`title.function = …`) would parse as a
 * nested table this mapping never reads. `background`, `foreground` and
 * `border` style the block itself; every other key colours one token class
 * (base.css maps highlight.js's classes onto them).
 */
export interface ThemeSyntax {
  background?: string;
  foreground?: string;
  border?: string;
  comment?: string;
  keyword?: string;
  string?: string;
  number?: string;
  constant?: string;
  builtin?: string;
  type?: string;
  function?: string;
  variable?: string;
  attribute?: string;
  tag?: string;
  operator?: string;
  punctuation?: string;
  escape?: string;
  meta?: string;
  regexp?: string;
  section?: string;
  addition?: string;
  deletion?: string;
}

export interface ThemeColors {
  background?: string;
  foreground?: string;
  cursor?: string;
  selection_bg?: string;
  selection_fg?: string;
  border?: string;
  accent?: ThemeAccent;
  messages?: ThemeMessages;
  roomlist?: ThemeRoomlist;
  reactions?: ThemeReactions;
  syntax?: ThemeSyntax;
}

/** Matches the TOML structure from the Tauri backend */
export interface Theme {
  meta?: ThemeMeta;
  colors?: ThemeColors;
  typography?: ThemeTypography;
  borders?: ThemeBorders;
  emoji?: ThemeEmoji;
  prompt?: ThemePrompt;
}

// ── Border styles ────────────────────────────────────────────────────────────

/**
 * How `borders.style` draws the UI's frames — the message boxes, the compose
 * box and the lines between panes. The names come from box-drawing sets, but
 * the frames are CSS borders, so each maps to a line style, width and corner
 * radius (`--frame-*` in vars.css). `double` needs 3px for both lines to show.
 */
export const FRAME_STYLES: Record<BorderStyle, { line: string; width: string; radius: string }> = {
  single: { line: "solid", width: "2px", radius: "0px" },
  double: { line: "double", width: "3px", radius: "0px" },
  rounded: { line: "solid", width: "2px", radius: "8px" },
  ascii: { line: "dashed", width: "2px", radius: "0px" },
  none: { line: "none", width: "0px", radius: "0px" },
};

// ── Colour tables ────────────────────────────────────────────────────────────
//
// Every colour key maps 1:1 onto a custom property with no transform, so the
// mapping is data rather than an `if` per key — there are 51 of them now that
// [colors.syntax] exists. Typing each table as a Record over the section's keys
// makes tsc reject a key added to an interface without a property to write it
// to, and resetTheme derives its list from the same tables, so the two can no
// longer drift apart the way the hand-kept lists could. The non-colour sections
// stay hand-mapped below: each of those transforms its value (px units, quoted
// strings, frame styles).

/** The keys of `T` whose values are strings — `ThemeColors` minus its sub-tables. */
type StringKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string ? K : never;
}[keyof T];

const COLOR_VARS: Record<StringKeys<ThemeColors>, string> = {
  background: "--bg",
  foreground: "--fg",
  cursor: "--cursor",
  selection_bg: "--selection-bg",
  selection_fg: "--selection-fg",
  border: "--border-color",
};

const ACCENT_VARS: Record<keyof ThemeAccent, string> = {
  primary: "--accent-primary",
  secondary: "--accent-secondary",
  error: "--accent-error",
  warning: "--accent-warning",
  success: "--accent-success",
  link: "--accent-link",
};

const MESSAGE_VARS: Record<keyof ThemeMessages, string> = {
  own: "--msg-own",
  other: "--msg-other",
  system: "--msg-system",
  timestamp: "--msg-timestamp",
  mention_bg: "--msg-mention-bg",
  mention_fg: "--msg-mention-fg",
  reply_border: "--msg-reply-border",
  thread_indicator: "--msg-thread-indicator",
};

const ROOMLIST_VARS: Record<keyof ThemeRoomlist, string> = {
  active_bg: "--roomlist-active-bg",
  active_fg: "--roomlist-active-fg",
  unread: "--roomlist-unread",
  mention_badge: "--roomlist-mention-badge",
  muted: "--roomlist-muted",
};

const REACTION_VARS: Record<keyof ThemeReactions, string> = {
  background: "--reaction-bg",
  border: "--reaction-border",
  own_bg: "--reaction-own-bg",
  count: "--reaction-count",
};

/** The block's own surface keeps a `--code-` prefix; each token is `--syntax-<key>`. */
const SYNTAX_VARS: Record<keyof ThemeSyntax, string> = {
  background: "--code-bg",
  foreground: "--code-fg",
  border: "--code-border",
  comment: "--syntax-comment",
  keyword: "--syntax-keyword",
  string: "--syntax-string",
  number: "--syntax-number",
  constant: "--syntax-constant",
  builtin: "--syntax-builtin",
  type: "--syntax-type",
  function: "--syntax-function",
  variable: "--syntax-variable",
  attribute: "--syntax-attribute",
  tag: "--syntax-tag",
  operator: "--syntax-operator",
  punctuation: "--syntax-punctuation",
  escape: "--syntax-escape",
  meta: "--syntax-meta",
  regexp: "--syntax-regexp",
  section: "--syntax-section",
  addition: "--syntax-addition",
  deletion: "--syntax-deletion",
};

/**
 * Set on the root by applyTheme. vars.css keys its palette-derived syntax
 * defaults to it; without it the root carries Phosphor's own table, which is
 * what the default theme paints, since it is never applied (actions/theme.ts).
 */
export const THEME_APPLIED_ATTR = "data-theme-applied";

const COLOR_TABLES: readonly Record<string, string>[] = [
  COLOR_VARS, ACCENT_VARS, MESSAGE_VARS, ROOMLIST_VARS, REACTION_VARS, SYNTAX_VARS,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Copy each colour `values` sets onto the property `table` maps its key to.
 * A key the theme leaves out produces no entry, like every other field.
 */
function colorVars<K extends string>(
  out: Record<string, string>,
  values: Partial<Record<K, string>> | undefined,
  table: Record<K, string>,
): void {
  for (const key of Object.keys(table) as K[]) {
    const value = values?.[key];
    if (value) out[table[key]] = value;
  }
}

function px(n: number): string {
  return `${n}px`;
}

/**
 * A CSS string literal for `content:` — quotes, backslashes and newlines
 * escaped. Takes anything: custom themes reach applyTheme as raw TOML (see
 * `load_theme`), so `normal_indicator = 3` arrives as a number. That shows as
 * "3", as it did before indicators were escaped, rather than throwing and
 * losing the whole theme.
 */
function cssString(value: unknown): string {
  return `"${String(value).replace(/[\\"]/g, "\\$&").replace(/\r?\n|\r/g, "\\a ")}"`;
}

// ── Cross-fade ───────────────────────────────────────────────────────────────

/** Duration of the theme colour tween. Kept in sync with the
 *  `.theme-tweening` transition in base.css. */
const THEME_TWEEN_MS = 450;

let tweenTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Briefly enable colour transitions so a theme change eases to its new palette
 * instead of snapping. The `.theme-tweening` class on the documentElement turns
 * the transitions on (see base.css); we strip it once the tween has elapsed so
 * it can't bleed into ordinary interaction. Honours prefers-reduced-motion.
 */
function beginThemeTween(root: HTMLElement): void {
  const html = root.ownerDocument?.documentElement;
  if (!html) return;
  if (typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  html.classList.add("theme-tweening");
  if (tweenTimer !== undefined) clearTimeout(tweenTimer);
  tweenTimer = setTimeout(() => {
    html.classList.remove("theme-tweening");
    tweenTimer = undefined;
  }, THEME_TWEEN_MS + 50);
}

// ── Apply ────────────────────────────────────────────────────────────────────

/**
 * Map a theme object to the CSS custom properties it sets. Pure — the single
 * source of truth for how theme fields become CSS, shared by {@link applyTheme}
 * and the quark.tel theme editor's live preview. Only fields explicitly present
 * in the theme produce an entry; the rest fall back to the defaults in vars.css.
 */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  const set = (prop: string, value: string): void => {
    vars[prop] = value;
  };

  const c = theme.colors;
  colorVars(vars, c, COLOR_VARS);
  colorVars(vars, c?.accent, ACCENT_VARS);
  colorVars(vars, c?.messages, MESSAGE_VARS);
  colorVars(vars, c?.roomlist, ROOMLIST_VARS);
  colorVars(vars, c?.reactions, REACTION_VARS);
  colorVars(vars, c?.syntax, SYNTAX_VARS);

  const t = theme.typography;
  if (t) {
    if (t.font_family) set("--font-family", t.font_family);
    if (t.font_size != null) set("--font-size", px(t.font_size));
    if (t.line_height != null) set("--line-height", String(t.line_height));
    if (t.message_spacing != null) set("--message-spacing", px(t.message_spacing));
  }

  const b = theme.borders;
  if (b) {
    if (b.room_list_width) set("--room-list-width", b.room_list_width);
    const frame = b.style ? FRAME_STYLES[b.style] : undefined;
    if (frame) {
      set("--frame-line", frame.line);
      set("--frame-width", frame.width);
      set("--frame-radius", frame.radius);
    }
  }

  const e = theme.emoji;
  if (e) {
    if (e.size != null) set("--emoji-size", px(e.size));
    if (e.sticker_max_size != null) set("--sticker-max-size", px(e.sticker_max_size));
    if (e.reaction_size != null) set("--reaction-size", px(e.reaction_size));
  }

  const p = theme.prompt;
  if (p) {
    if (p.normal_indicator != null) set("--mode-normal", cssString(p.normal_indicator));
    if (p.insert_indicator != null) set("--mode-insert", cssString(p.insert_indicator));
    if (p.command_indicator != null) set("--mode-command", cssString(p.command_indicator));
    if (p.visual_indicator != null) set("--mode-visual", cssString(p.visual_indicator));
  }

  return vars;
}

/**
 * Apply a theme object (from the Tauri backend) as CSS custom properties on
 * the :root element.  Only properties that are explicitly present in the theme
 * object are written — the rest fall back to the defaults in vars.css. The
 * exception is `[colors.syntax]`, whose absent keys are actively cleared (see
 * below).
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  // Ease the colour change rather than snapping. Must run before the custom
  // properties are rewritten so the transition is armed when values change.
  beginThemeTween(root);
  // Switches the syntax defaults from Phosphor's own table to ones derived
  // from the palette (vars.css), since the theme now painting may not be
  // Phosphor.
  root.setAttribute(THEME_APPLIED_ATTR, "");

  const vars = themeToCssVars(theme);
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value);
  }

  // Syntax keys a theme leaves out are removed, not kept the way the palette's
  // are. Keeping them is harmless for the palette because every bundled theme
  // sets every key, so a switch overwrites the lot. A syntax table is the
  // opposite case: most custom themes have none, and one that has it may set a
  // handful of tokens. Kept values would paint the previous theme's hand-tuned
  // tokens onto this theme's background; cleared, the vars.css defaults derive
  // them from this theme's palette instead.
  for (const prop of Object.values(SYNTAX_VARS)) {
    if (!(prop in vars)) root.style.removeProperty(prop);
  }
}

/**
 * Reset all theme custom properties to empty strings, allowing the defaults
 * in vars.css to take effect again.
 */
export function resetTheme(root: HTMLElement = document.documentElement): void {
  beginThemeTween(root);
  root.removeAttribute(THEME_APPLIED_ATTR);
  const props = [
    ...COLOR_TABLES.flatMap((table) => Object.values(table)),
    "--font-family", "--font-size", "--line-height", "--message-spacing",
    "--room-list-width", "--frame-line", "--frame-width", "--frame-radius",
    "--emoji-size", "--sticker-max-size", "--reaction-size",
    "--mode-normal", "--mode-insert", "--mode-command", "--mode-visual",
  ];
  for (const prop of props) {
    root.style.removeProperty(prop);
  }
}
