import { describe, it, expect } from "vitest";
import { BUILTIN_THEME_MAP } from "./builtins.js";
import { THEME_FIELDS } from "./share.js";

// share.test.ts holds builtins.ts to themes/*.toml. vars.css is the third copy
// of Phosphor: the default theme is never applied at startup, so its bare
// :root block is what a fresh install paints. Its syntax values must be
// Phosphor's table; the derived defaults sit in a second block, keyed to the
// attribute applyTheme sets, and must cover every key.

const varsCss =
  Object.values(import.meta.glob<string>("./vars.css", { query: "?raw", import: "default", eager: true }))[0] ?? "";

const SYNTAX_KEYS = THEME_FIELDS.filter((f) => f.section.path === "colors.syntax").map((f) => f.field.key);

const syntaxVar = (key: string): string =>
  ({ background: "--code-bg", foreground: "--code-fg", border: "--code-border" })[key] ?? `--syntax-${key}`;

/** The --code-* / --syntax-* declarations in the rule whose selector is `selector`. */
function declarations(selector: string): Record<string, string> {
  const start = varsCss.indexOf(`\n${selector} {`);
  const body = start < 0 ? "" : varsCss.slice(start, varsCss.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--(?:code|syntax)-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

describe("vars.css syntax defaults", () => {
  it("finds the schema's syntax keys", () => {
    expect(SYNTAX_KEYS.length).toBe(22);
  });

  it("paints Phosphor's [colors.syntax] table on the bare :root", () => {
    const phosphor = BUILTIN_THEME_MAP.phosphor.colors!.syntax!;
    const expected = Object.fromEntries(Object.entries(phosphor).map(([key, value]) => [syntaxVar(key), value]));
    expect(declarations(":root")).toEqual(expected);
  });

  it("derives every syntax key once a theme is applied", () => {
    expect(Object.keys(declarations(":root[data-theme-applied]")).sort()).toEqual(SYNTAX_KEYS.map(syntaxVar).sort());
  });
});
