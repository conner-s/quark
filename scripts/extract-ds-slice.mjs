#!/usr/bin/env node
// Extract the CSS rules belonging to a component from src/style/base.css.
//
// base.css is one monolith, but its class names are BEM-namespaced per
// component, so a component's slice is exactly the set of top-level rules whose
// selector list mentions one of its prefixes. Rules inside @media are kept with
// their wrapper so responsive behaviour survives the lift.
//
// Usage: node scripts/extract-ds-slice.mjs <prefix> [prefix...]

import { readFileSync } from "node:fs";

const prefixes = process.argv.slice(2);
if (!prefixes.length) {
  console.error("usage: extract-ds-slice.mjs <prefix> [prefix...]");
  process.exit(1);
}

const css = readFileSync(new URL("../src/style/base.css", import.meta.url), "utf8");

// Prefix match, not exact: `.message` must pull in `.message__body` and
// `.message--selected` too. BEM continuations are indistinguishable from a
// sibling component that happens to share a stem, so the prefixes passed in are
// the contract — keep them specific enough to not over-collect.
const matches = (sel) =>
  prefixes.some((p) => new RegExp(`\\.${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(sel));

// Walk the stylesheet tracking brace depth so nested at-rules stay intact.
const out = [];
let i = 0;
while (i < css.length) {
  const open = css.indexOf("{", i);
  if (open === -1) break;

  const selector = css.slice(i, open).trim();

  // Find the matching close brace for this block.
  let depth = 1;
  let j = open + 1;
  while (j < css.length && depth > 0) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}") depth--;
    j++;
  }
  const body = css.slice(open + 1, j - 1);

  if (selector.startsWith("@")) {
    // At-rule: recurse into it, keep the wrapper only if something inside hits.
    const inner = [];
    let k = 0;
    while (k < body.length) {
      const o = body.indexOf("{", k);
      if (o === -1) break;
      const sel = body.slice(k, o).trim();
      let d = 1;
      let m = o + 1;
      while (m < body.length && d > 0) {
        if (body[m] === "{") d++;
        else if (body[m] === "}") d--;
        m++;
      }
      if (matches(sel)) inner.push(`  ${sel} {${body.slice(o + 1, m - 1)}}`);
      k = m;
    }
    if (inner.length) out.push(`${selector} {\n${inner.join("\n")}\n}`);
  } else if (matches(selector)) {
    out.push(`${selector} {${body}}`);
  }

  i = j;
}

if (!out.length) {
  console.error(`no rules matched: ${prefixes.join(", ")}`);
  process.exit(2);
}
process.stdout.write(out.join("\n\n") + "\n");
