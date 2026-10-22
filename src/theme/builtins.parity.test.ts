import { describe, it, expect } from "vitest";
import { BUILTIN_THEME_MAP } from "./builtins.js";

// BUILTIN_THEME_MAP is a hand-copied mirror of themes/*.toml: built-in themes
// never go through IPC, so the TOML a user reads (and copies to start a custom
// theme) and the colours the app paints are two copies of the same data. Its
// type is all-optional, so tsc can't catch a key the copy drops or a hex it
// mistypes — and the 22-key [colors.syntax] table per theme made that drift
// likely. This pins the two together.

// Vite's import.meta.glob, resolved by vitest through the same transform
// pipeline as the `?raw` stylesheet imports in NotificationToast.test.ts. It
// reads the files without node:fs, which would need @types/node — not a
// dependency here, and tsc covers test files too. Declared locally for the one
// call shape used below rather than pulling in vite/client, whose `?raw`
// module declaration would turn those files' @ts-expect-error lines into errors.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
}

const THEME_SOURCES = import.meta.glob("../../themes/*.toml", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * Themes shipped as TOML but deliberately not built in. Pesterchum's
 * `style = "square"` border matches no glyph set the loader knows, so it is
 * loadable only as a custom theme file.
 */
const TOML_ONLY = ["pesterchum"];

/** The `[colors.syntax]` keys, as the theme schema defines them. */
const SYNTAX_KEYS = [
  "background", "foreground", "border",
  "comment", "keyword", "string", "number", "constant", "builtin", "type",
  "function", "variable", "attribute", "tag", "operator", "punctuation",
  "escape", "meta", "regexp", "section", "addition", "deletion",
];

// ── TOML subset ──────────────────────────────────────────────────────────────
//
// Just what theme files use: `[a.b]` headers, `key = "string" | number | bool`,
// and `#` comments. Anything else throws with the line, so a theme reaching for
// more TOML (arrays, inline tables, dotted keys) fails here loudly instead of
// being skipped — dotted keys especially, since `[colors.syntax]` relies on
// flat ones.

type TomlValue = string | number | boolean;
interface TomlTable {
  [key: string]: TomlValue | TomlTable;
}

function parseValue(text: string, where: string): TomlValue {
  let value: TomlValue;
  let rest: string;
  const quoted = /^"((?:[^"\\]|\\.)*)"(.*)$/.exec(text);
  if (quoted) {
    // TOML basic-string escapes match JSON's for everything a theme would use.
    value = JSON.parse(`"${quoted[1]}"`) as string;
    rest = quoted[2];
  } else {
    const bare = /^([^\s#]+)(.*)$/.exec(text);
    if (!bare) throw new Error(`${where}: missing value`);
    const [, token, tail] = bare;
    if (token === "true" || token === "false") value = token === "true";
    else if (/^[+-]?\d+(\.\d+)?$/.test(token)) value = Number(token);
    else throw new Error(`${where}: unsupported value ${token}`);
    rest = tail;
  }
  if (!/^\s*(#.*)?$/.test(rest)) throw new Error(`${where}: trailing content ${rest}`);
  return value;
}

function parseToml(src: string, file: string): TomlTable {
  const root: TomlTable = {};
  let table = root;
  src.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    const where = `${file}:${i + 1}`;
    if (line === "" || line.startsWith("#")) return;

    const header = /^\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\]\s*(#.*)?$/.exec(line);
    if (header) {
      table = root;
      for (const part of header[1].split(".")) {
        const next = (table[part] ??= {});
        if (typeof next !== "object") throw new Error(`${where}: [${header[1]}] shadows a value`);
        table = next;
      }
      return;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`${where}: unsupported TOML: ${line}`);
    const [, key, text] = pair;
    if (key in table) throw new Error(`${where}: duplicate key ${key}`);
    table[key] = parseValue(text, where);
  });
  return root;
}

const TOML_THEMES: Record<string, TomlTable> = Object.fromEntries(
  Object.entries(THEME_SOURCES).map(([path, src]) => [
    path.slice(path.lastIndexOf("/") + 1).replace(/\.toml$/, ""),
    parseToml(src, path),
  ]),
);

const syntaxTable = (theme: TomlTable): TomlValue | TomlTable | undefined => {
  const colors = theme.colors;
  return typeof colors === "object" ? colors.syntax : undefined;
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("built-in themes mirror themes/*.toml", () => {
  // Guards the glob itself: a wrong path yields an empty object, and every
  // test below would then pass vacuously.
  it("finds the theme files", () => {
    expect(Object.keys(TOML_THEMES)).toContain("phosphor");
  });

  it("has a TOML file for every built-in theme", () => {
    const missing = Object.keys(BUILTIN_THEME_MAP).filter((name) => !(name in TOML_THEMES));
    expect(missing).toEqual([]);
  });

  it("builds in every TOML theme except the documented exceptions", () => {
    const notBuiltIn = Object.keys(TOML_THEMES).filter((name) => !(name in BUILTIN_THEME_MAP));
    expect(notBuiltIn.sort()).toEqual([...TOML_ONLY].sort());
  });

  it.each(Object.keys(BUILTIN_THEME_MAP))("%s matches its TOML in every table", (name) => {
    expect(BUILTIN_THEME_MAP[name]).toEqual(TOML_THEMES[name]);
  });
});

describe("[colors.syntax] tables", () => {
  it.each(Object.keys(TOML_THEMES))("%s uses only schema keys with hex colours", (name) => {
    const syntax = syntaxTable(TOML_THEMES[name]);
    if (syntax === undefined) return;
    expect(typeof syntax, `${name}: [colors.syntax] must be a table`).toBe("object");
    for (const [key, value] of Object.entries(syntax as TomlTable)) {
      expect(SYNTAX_KEYS, `${name}: unknown [colors.syntax] key "${key}"`).toContain(key);
      expect(value, `${name}: colors.syntax.${key}`).toMatch(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    }
  });

  // Built-ins are hand-tuned and contrast-checked token by token, so none should
  // lean on a vars.css default by leaving a key out.
  it.each(Object.keys(BUILTIN_THEME_MAP))("%s sets every syntax key", (name) => {
    const syntax = syntaxTable(TOML_THEMES[name] ?? {});
    expect(Object.keys((syntax ?? {}) as TomlTable).sort()).toEqual([...SYNTAX_KEYS].sort());
  });
});

// vars.css is the third copy of Phosphor: the default theme is never applied at
// startup, so its bare :root block is what a fresh install paints. Its syntax
// values must be Phosphor's table; the derived defaults sit in a second block,
// keyed to the attribute applyTheme sets, and must cover every key.
describe("vars.css syntax defaults", () => {
  const varsCss = Object.values(
    import.meta.glob("./vars.css", { query: "?raw", import: "default", eager: true }),
  )[0] ?? "";

  const syntaxVar = (key: string): string =>
    ({ background: "--code-bg", foreground: "--code-fg", border: "--code-border" })[key] ??
    `--syntax-${key}`;

  /** The --code-* / --syntax-* declarations in the rule whose selector is `selector`. */
  const declarations = (selector: string): Record<string, string> => {
    const start = varsCss.indexOf(`\n${selector} {`);
    const body = start < 0 ? "" : varsCss.slice(start, varsCss.indexOf("\n}", start));
    return Object.fromEntries(
      [...body.matchAll(/(--(?:code|syntax)-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
  };

  it("paints Phosphor's [colors.syntax] table on the bare :root", () => {
    const phosphor = syntaxTable(TOML_THEMES.phosphor) as TomlTable;
    const expected = Object.fromEntries(
      Object.entries(phosphor).map(([key, value]) => [syntaxVar(key), value]),
    );
    expect(declarations(":root")).toEqual(expected);
  });

  it("derives every syntax key once a theme is applied", () => {
    expect(Object.keys(declarations(":root[data-theme-applied]")).sort()).toEqual(
      SYNTAX_KEYS.map(syntaxVar).sort(),
    );
  });
});
