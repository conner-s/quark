// jsdom does not provide the CSS global, but components use CSS.escape() to
// build attribute selectors from user-controlled IDs. Minimal escape for tests:
// backslash-escape everything outside [a-zA-Z0-9_-].
if (typeof (globalThis as { CSS?: unknown }).CSS === "undefined") {
  (globalThis as { CSS?: unknown }).CSS = {};
}
const css = (globalThis as { CSS: { escape?: (v: string) => string } }).CSS;
if (typeof css.escape !== "function") {
  css.escape = (value: string): string =>
    String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
