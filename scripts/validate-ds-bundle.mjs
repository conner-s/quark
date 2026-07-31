#!/usr/bin/env node
// Validate the design/ bundle before it is uploaded to claude.ai/design.
//
// The failure mode this guards against: a card that names a class or token which
// does not exist renders unstyled, and every design the agent later builds from
// that card inherits the mistake. So the checks are:
//
//   1. styles.css's @import closure resolves (that closure is ALL a rendered
//      design receives — a card linking a slice directly proves nothing).
//   2. Every class a card uses is defined either in the closure or in the card's
//      own <style> block.
//   3. Every var(--x) a card or slice references is declared by a token file.
//   4. Every card's first line is a well-formed @dsCard marker.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "design");
let errors = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); errors++; };

// ── 1. Walk the @import closure ────────────────────────────────────────────
const closure = [];
const seen = new Set();
function walk(file) {
  const abs = resolve(file);
  if (seen.has(abs)) return;
  seen.add(abs);
  if (!existsSync(abs)) { fail(`@import target missing: ${relative(ROOT, abs)}`); return; }
  const css = readFileSync(abs, "utf8");
  closure.push({ file: abs, css });
  for (const m of css.matchAll(/@import\s+["']([^"']+)["']/g)) walk(join(dirname(abs), m[1]));
}
walk(join(ROOT, "styles.css"));
console.log(`closure: ${closure.length} stylesheets`);

const closureCss = closure.map((c) => c.css).join("\n");

// ── 2. Collect declared classes and tokens from the closure ────────────────
const declaredClasses = new Set();
for (const m of closureCss.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) declaredClasses.add(m[1]);

const declaredTokens = new Set();
for (const m of closureCss.matchAll(/(--[\w-]+)\s*:/g)) declaredTokens.add(m[1]);
console.log(`declared: ${declaredClasses.size} classes, ${declaredTokens.size} tokens`);

// ── 3. Check every var() reference in the closure resolves ─────────────────
// A reference with a fallback — var(--presence-online, #4caf50) — is safe even
// when nothing declares the token: those are optional theme hooks, some of them
// set at runtime rather than by a stylesheet. Only bare var(--x) can render
// broken, so only bare references are checked.
const BARE_VAR = /var\(\s*(--[\w-]+)\s*\)/g;

for (const { file, css } of closure) {
  for (const m of css.matchAll(BARE_VAR)) {
    if (!declaredTokens.has(m[1])) fail(`${relative(ROOT, file)}: undeclared token ${m[1]}`);
  }
}

// ── 4. Check every card ────────────────────────────────────────────────────
const cards = [];
(function find(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) find(p);
    else if (e === "index.html") cards.push(p);
  }
})(join(ROOT, "components"));

for (const card of cards) {
  const rel = relative(ROOT, card);
  const html = readFileSync(card, "utf8");

  const first = html.split("\n")[0];
  if (!/^<!--\s*@dsCard\s+group="[^"]+"\s*-->$/.test(first)) {
    fail(`${rel}: malformed @dsCard first line: ${JSON.stringify(first.slice(0, 60))}`);
  }

  // Classes defined locally in the card's own <style> block are legitimate.
  const local = new Set();
  for (const s of html.matchAll(/<style>([\s\S]*?)<\/style>/g))
    for (const m of s[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) local.add(m[1]);

  // Ignore commented-out markup: comments document structure, they aren't rendered.
  const live = html.replace(/<!--[\s\S]*?-->/g, "");

  for (const m of live.matchAll(/class="([^"]+)"/g)) {
    for (const cls of m[1].trim().split(/\s+/)) {
      if (!declaredClasses.has(cls) && !local.has(cls))
        fail(`${rel}: class .${cls} is not defined in the closure or the card`);
    }
  }
  for (const m of live.matchAll(BARE_VAR)) {
    if (!declaredTokens.has(m[1])) fail(`${rel}: undeclared token ${m[1]}`);
  }
}

console.log(`cards: ${cards.length}`);
if (errors) { console.error(`\n${errors} problem(s)`); process.exit(1); }
console.log("\nOK — bundle is internally consistent");
