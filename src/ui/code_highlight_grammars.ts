// Everything that runs highlight.js: the curated grammar table, the fixes
// applied to it, loading and registration, and the request handler that turns
// a (grammar, text) pair into token HTML.
//
// Two realms import this file. The highlighting worker (code_highlight.worker.ts)
// is where it normally runs; the main thread imports it too, for the in-thread
// fallback that takes over when no worker can be had (see code_highlight.ts).
// Both run the same handler over their own registry, so the fallback can't
// drift from what the worker does.
//
// Bundle size is why the loading is shaped the way it is. highlight.js with
// every grammar is ~1 MB, and most rooms never see a code block, so the core
// and each grammar load lazily, as their own chunks. Vite only splits a
// dynamic import whose specifier is a string literal, hence one literal
// `import()` per grammar in GRAMMAR_LOADERS — and a static import of a
// highlight.js module anywhere in the app would pull it into the chunk that
// imports it (the main one, for the main thread), so every highlight.js import
// lives in this file and stays dynamic. Type-only imports are erased and don't
// count.

import type { Emitter, HLJSApi, Language, LanguageFn } from "highlight.js";

type GrammarModule = { default: LanguageFn };

/**
 * The grammars Quark can highlight, by highlight.js name: a curated set of
 * what turns up in chat, not all ~190. Each grammar is its own lazy chunk, so
 * the list costs nothing until a block uses one; it is bounded because every
 * entry is a chunk in the build and a row in the alias table (code_highlight.ts).
 */
export const GRAMMAR_LOADERS: ReadonlyMap<string, () => Promise<GrammarModule>> = new Map<
  string,
  () => Promise<GrammarModule>
>([
  ["armasm", () => import("highlight.js/lib/languages/armasm")],
  ["bash", () => import("highlight.js/lib/languages/bash")],
  ["c", () => import("highlight.js/lib/languages/c")],
  ["clojure", () => import("highlight.js/lib/languages/clojure")],
  ["cmake", () => import("highlight.js/lib/languages/cmake")],
  ["cpp", () => import("highlight.js/lib/languages/cpp")],
  ["csharp", () => import("highlight.js/lib/languages/csharp")],
  ["css", () => import("highlight.js/lib/languages/css")],
  ["dart", () => import("highlight.js/lib/languages/dart")],
  ["diff", () => import("highlight.js/lib/languages/diff")],
  ["dockerfile", () => import("highlight.js/lib/languages/dockerfile")],
  ["dos", () => import("highlight.js/lib/languages/dos")],
  ["elixir", () => import("highlight.js/lib/languages/elixir")],
  ["elm", () => import("highlight.js/lib/languages/elm")],
  ["erlang", () => import("highlight.js/lib/languages/erlang")],
  ["fsharp", () => import("highlight.js/lib/languages/fsharp")],
  ["go", () => import("highlight.js/lib/languages/go")],
  ["graphql", () => import("highlight.js/lib/languages/graphql")],
  ["groovy", () => import("highlight.js/lib/languages/groovy")],
  ["haskell", () => import("highlight.js/lib/languages/haskell")],
  ["ini", () => import("highlight.js/lib/languages/ini")],
  ["java", () => import("highlight.js/lib/languages/java")],
  ["javascript", () => import("highlight.js/lib/languages/javascript")],
  ["json", () => import("highlight.js/lib/languages/json")],
  ["julia", () => import("highlight.js/lib/languages/julia")],
  ["kotlin", () => import("highlight.js/lib/languages/kotlin")],
  ["latex", () => import("highlight.js/lib/languages/latex")],
  ["less", () => import("highlight.js/lib/languages/less")],
  ["lisp", () => import("highlight.js/lib/languages/lisp")],
  ["llvm", () => import("highlight.js/lib/languages/llvm")],
  ["lua", () => import("highlight.js/lib/languages/lua")],
  ["makefile", () => import("highlight.js/lib/languages/makefile")],
  ["markdown", () => import("highlight.js/lib/languages/markdown")],
  ["nginx", () => import("highlight.js/lib/languages/nginx")],
  ["nix", () => import("highlight.js/lib/languages/nix").then(withFixedNixAttrs)],
  ["objectivec", () => import("highlight.js/lib/languages/objectivec")],
  ["ocaml", () => import("highlight.js/lib/languages/ocaml")],
  ["perl", () => import("highlight.js/lib/languages/perl")],
  ["php", () => import("highlight.js/lib/languages/php")],
  ["plaintext", () => import("highlight.js/lib/languages/plaintext")],
  ["powershell", () => import("highlight.js/lib/languages/powershell")],
  ["properties", () => import("highlight.js/lib/languages/properties")],
  ["protobuf", () => import("highlight.js/lib/languages/protobuf")],
  ["python", () => import("highlight.js/lib/languages/python")],
  ["python-repl", () => import("highlight.js/lib/languages/python-repl")],
  ["r", () => import("highlight.js/lib/languages/r")],
  ["ruby", () => import("highlight.js/lib/languages/ruby")],
  ["rust", () => import("highlight.js/lib/languages/rust")],
  ["scala", () => import("highlight.js/lib/languages/scala")],
  ["scheme", () => import("highlight.js/lib/languages/scheme")],
  ["scss", () => import("highlight.js/lib/languages/scss")],
  ["shell", () => import("highlight.js/lib/languages/shell")],
  ["sql", () => import("highlight.js/lib/languages/sql")],
  ["swift", () => import("highlight.js/lib/languages/swift")],
  ["typescript", () => import("highlight.js/lib/languages/typescript")],
  ["verilog", () => import("highlight.js/lib/languages/verilog")],
  ["vim", () => import("highlight.js/lib/languages/vim")],
  ["wasm", () => import("highlight.js/lib/languages/wasm")],
  ["x86asm", () => import("highlight.js/lib/languages/x86asm")],
  ["xml", () => import("highlight.js/lib/languages/xml")],
  ["yaml", () => import("highlight.js/lib/languages/yaml")],
]);

/**
 * Grammars that embed another grammar (highlight.js `subLanguage`), and which
 * one. highlight.js resolves a sub-language at highlight time and quietly
 * renders that stretch as plain text when it isn't registered — an HTML
 * `<script>` is javascript, a Dockerfile `RUN` line is bash — so each dependency
 * loads with the grammar that needs it, transitively.
 *
 * Two are deliberately absent. Perl's `mojolicious` (templates after
 * `__END__`) isn't in the curated set, so that stretch stays plain. Nix
 * declares markdown for `/** … *\/` doc comments, but in 11.12.0 its plain
 * block-comment rule comes first and always wins, so markdown never runs —
 * and loading it would pull in xml, css, javascript and graphql behind it, five
 * chunks for every nix block, for no change in output. Revisit on an upgrade.
 */
export const GRAMMAR_DEPENDENCIES: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  ["dart", ["markdown"]], // doc comments
  ["dockerfile", ["bash"]], // RUN lines
  ["javascript", ["css", "graphql", "xml"]], // css`` gql`` html`` templates
  ["markdown", ["xml"]], // inline HTML
  ["python-repl", ["python"]], // `>>>` lines
  ["shell", ["bash"]], // the command after a prompt
  ["typescript", ["css", "graphql", "xml"]], // as javascript
  ["xml", ["css", "javascript"]], // <style> and <script>
  ["yaml", ["ruby"]], // ERB `<%= %>` in templated YAML
]);

// ── Grammar fixes ───────────────────────────────────────────────────────────

/** The nix grammar's own identifier pattern (its IDENTIFIER_REGEX). */
const NIX_IDENT = "[A-Za-z_][A-Za-z0-9_'-]*";

/** The attribute rule's prefix, exactly as highlight.js 11.12.0 writes it. */
const NIX_ATTR_PREFIX = String.raw`(^|\{|;)\s*`;

/**
 * highlight.js 11.12.0's nix grammar finds an attribute name (`inputs = …`)
 * through a `beforeMatch` prefix, `(^|\{|;)\s*`, that has to match before the
 * name does. At the start of a line nothing precedes the name, so the prefix
 * matches zero characters — and highlight.js's guard against a rule stuck on an
 * empty match writes the next character out as plain text. `inputs` came out as
 * a plain `i` and an attribute-coloured `nputs`, on every attribute at column 0:
 * the first line of most pasted flake and NixOS snippets, and any line after a
 * comment or a closing `}`. (An indented line was fine; its indent is the
 * prefix.)
 *
 * The replacement is the same rule with the prefix as a lookbehind, which never
 * has to match anything itself. The mode is rewritten in place because the
 * grammar shares it: its `${…}` interpolation holds the same object in a list
 * of its own. The fix applies only while the grammar still carries that exact
 * prefix, so an upgrade that fixes or reshapes the rule makes it a no-op rather
 * than a second bug. Drop it once upstream's grammar is fixed.
 */
function withFixedNixAttrs(mod: GrammarModule): GrammarModule {
  return { default: (hljs) => fixNixAttrs(mod.default(hljs)) };
}

function fixNixAttrs(language: Language): Language {
  for (const mode of language.contains) {
    const prefix: unknown = Reflect.get(mode, "beforeMatch");
    const name = mode.contains?.[0];
    if (!(prefix instanceof RegExp) || prefix.source !== NIX_ATTR_PREFIX) continue;
    if (typeof name !== "object" || name.scope !== "attr") continue;
    for (const key of Object.keys(mode)) Reflect.deleteProperty(mode, key);
    Object.assign(mode, {
      scope: "attr",
      relevance: 0.2,
      // `==` is comparison, not a binding, as in the original rule.
      match: new RegExp(String.raw`(?<=(?:^|[{;])\s*)${NIX_IDENT}(?:\.${NIX_IDENT})*(?=\s*=(?!=))`),
    });
  }
  return language;
}

// ── Loading ─────────────────────────────────────────────────────────────────

/**
 * One realm's highlight.js: its core, and which grammars are registered in it.
 * The worker holds one and the in-thread fallback holds another; each realm
 * has its own copy of the core, so neither can see the other's registrations.
 */
export interface GrammarRegistry {
  /**
   * The core, when it is loaded and `grammar` is registered in it with all of
   * its sub-languages — what the in-thread fallback's synchronous path needs.
   */
  ready(grammar: string): HLJSApi | undefined;
  /** Import the core. A failure isn't remembered: the next call tries again. */
  loadCore(): Promise<HLJSApi>;
  /**
   * Import and register `grammar` and everything it embeds. Rejects when a
   * chunk fails to load, and that isn't remembered either.
   */
  loadGrammar(hljs: HLJSApi, grammar: string): Promise<void>;
}

const importCore = (): Promise<{ default: HLJSApi }> => import("highlight.js/lib/core");

/**
 * `grammar` plus everything it embeds, transitively. Worked out up front rather
 * than by having each grammar's load await its dependencies' loads: xml and
 * javascript embed each other, and that would leave each awaiting the other.
 */
function withDependencies(grammar: string): string[] {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of GRAMMAR_DEPENDENCIES.get(name) ?? []) visit(dep);
  };
  visit(grammar);
  return [...seen];
}

/** `core` is a seam for the tests, which need a core that fails to load. */
export function createGrammarRegistry(core: () => Promise<{ default: HLJSApi }> = importCore): GrammarRegistry {
  let corePromise: Promise<HLJSApi> | undefined;
  /** The loaded core, once `corePromise` has settled — read by `ready`. */
  let loadedCore: HLJSApi | undefined;
  /** Per-grammar import + registration, so each chunk is fetched once. */
  const registrations = new Map<string, Promise<void>>();
  /** Grammars registered together with all of their sub-language dependencies. */
  const readyGrammars = new Set<string>();

  const register = (hljs: HLJSApi, name: string): Promise<void> => {
    let registration = registrations.get(name);
    const loader = GRAMMAR_LOADERS.get(name);
    if (!registration && loader) {
      registration = loader().then(
        (mod) => hljs.registerLanguage(name, mod.default),
        (err: unknown) => {
          registrations.delete(name);
          throw err;
        },
      );
      registrations.set(name, registration);
    }
    return registration ?? Promise.resolve();
  };

  return {
    ready: (grammar) => (readyGrammars.has(grammar) ? loadedCore : undefined),
    loadCore() {
      corePromise ??= core().then(
        (mod) => {
          installNodeBudget(mod.default);
          return (loadedCore = mod.default);
        },
        (err: unknown) => {
          // Don't cache the failure: a chunk that failed once can load next time.
          corePromise = undefined;
          throw err;
        },
      );
      return corePromise;
    },
    async loadGrammar(hljs, grammar) {
      // Registered in any order: a sub-language is looked up when it's reached
      // during highlighting, not when the grammar embedding it is registered.
      await Promise.all(withDependencies(grammar).map((name) => register(hljs, name)));
      readyGrammars.add(grammar);
    },
  };
}

// ── Node budget ─────────────────────────────────────────────────────────────

/**
 * Most token nodes one highlight call may build, sub-languages included.
 *
 * A deadline bounds a call's time, not its memory, and some grammars build
 * output quadratic in their input: one that embeds another (shell-session's
 * commands are bash, python-repl's are python, a Dockerfile's RUN lines are
 * bash, HTML's <script>s are javascript) carries the embedded grammar's open
 * scopes from one region into the next and re-opens every one of them there.
 * A line of `%${` repeated nests one more unclosed `${` per line, and at 8 000
 * characters that is ~70 M characters of HTML and ~1 GB of memory inside the
 * deadline — enough to take a phone's WebView down, again on every launch
 * while the message is in view. Ordinary code makes a node every few
 * characters: at MAX_HIGHLIGHT_CHARS (10 000), TypeScript ~1 800, diffs and CSS
 * ~3 000, and minified JSON, the densest found, ~7 100. Past this a block stays
 * plain; the runaway cases above hit it within ~20 ms.
 *
 * A short block gets less: see nodeBudget.
 */
export const MAX_HIGHLIGHT_NODES = 12_000;

/**
 * Nodes a block of `length` characters may build: two per character (the
 * densest real code is under one — `1,` repeated, a span a character, is the
 * most found) plus a little for a block's fixed wrappers, up to
 * MAX_HIGHLIGHT_NODES. A flat cap alone left the amplification in short
 * blocks: 580 characters of `\n%${` comes to ~11 000 nodes, under the cap, and
 * a message holds dozens of such blocks — 40 of them were 435 000 spans and a
 * 0.7 s freeze on every render. Held to the text's length, a message's tokens
 * can't outnumber twice its characters.
 */
export function nodeBudget(length: number): number {
  return Math.min(MAX_HIGHLIGHT_NODES, 2 * length + 64);
}

/** What highlight.js's emitter is underneath its public `Emitter` type. */
type TreeEmitter = Emitter & { openNode(scope: unknown): void };
type TreeEmitterClass = new (options: unknown) => TreeEmitter;

/** Nodes the highlight call in progress may still open; there is one per realm. */
let nodesLeft = Infinity;

const budgetedCores = new WeakSet<HLJSApi>();

/**
 * Make `hljs` count the nodes it opens and give up past MAX_HIGHLIGHT_NODES.
 *
 * highlight.js builds output through an emitter class it doesn't export but
 * lets a caller replace (the `__emitter` option), so the class comes off a
 * result and a subclass that counts goes back in. Every node — a scope opened
 * by a rule, by an embedded grammar, or re-opened for a continuation — goes
 * through `openNode`. Throwing there lands in highlight.js's own error
 * handling, which returns the text escaped and unhighlighted; an embedded
 * region's error stops at its own call, but the next node the outer grammar
 * opens throws again, so the whole call comes apart within a node or two.
 *
 * The probe runs on a throwaway instance, which shares the class but not the
 * registered grammars. If anything about it fails, or the class doesn't have
 * that shape (a future highlight.js), nothing is installed: the deadline and
 * the HTML cap still bound the damage.
 */
function installNodeBudget(hljs: HLJSApi): void {
  if (budgetedCores.has(hljs)) return;
  budgetedCores.add(hljs);
  let base: unknown;
  try {
    const scratch = hljs.newInstance();
    scratch.registerLanguage("probe", () => ({ name: "probe", contains: [] }));
    base = scratch.highlight("", { language: "probe" })._emitter?.constructor;
  } catch {
    return;
  }
  if (typeof base !== "function" || typeof base.prototype?.openNode !== "function") return;
  const Emitter = base as TreeEmitterClass;
  class BudgetedEmitter extends Emitter {
    openNode(scope: unknown): void {
      if (--nodesLeft < 0) throw new Error("highlight node budget exhausted");
      super.openNode(scope);
    }
  }
  hljs.configure({ __emitter: BudgetedEmitter });
}

// ── Highlighting ────────────────────────────────────────────────────────────

/**
 * Run `grammar` over `text`, or `undefined` when the result would need more
 * nodes than nodeBudget allows it. Throws whatever else highlight.js throws.
 * The HTML is the caller's to check — code_highlight.ts holds it to "token
 * spans over the same text" before it goes anywhere near the DOM.
 */
export function highlightText(hljs: HLJSApi, grammar: string, text: string): string | undefined {
  nodesLeft = nodeBudget(text.length);
  try {
    const result = hljs.highlight(text, { language: grammar, ignoreIllegals: true });
    // highlight.js has already swallowed the budget's error by now (it returns
    // the text unhighlighted), so the counter is what says it ran out.
    if (nodesLeft < 0) return undefined;
    if (result.errorRaised) throw result.errorRaised;
    return result.value;
  } finally {
    nodesLeft = Infinity;
  }
}

/**
 * A job for the worker. `id` pairs it with its replies. `maxHtml` is the
 * longest HTML the main thread will take (code_highlight.ts's
 * MAX_HIGHLIGHT_HTML_CHARS): a longer result is dropped here, in the realm that
 * made it, rather than copied across to be thrown away. Some grammars nest a
 * span per line around the rest of the block, and in the worker's deadline
 * that reaches tens of millions of characters.
 */
export interface HighlightRequest {
  id: number;
  grammar: string;
  text: string;
  maxHtml: number;
}

/**
 * Why a job produced no HTML:
 *
 * - `core`: the highlight.js core wouldn't load. Nothing can be highlighted in
 *   this realm, so the main thread stops using the worker.
 * - `grammar`: not a grammar Quark ships, or its chunk (or a sub-language's)
 *   failed to load. Only this job is lost, and nothing remembers it.
 * - `highlight`: highlight.js threw on this text.
 * - `size`: the HTML ran past the request's `maxHtml`. The same text would
 *   come back the same size, so the main thread gives the block up.
 */
export type HighlightError = "core" | "grammar" | "highlight" | "size";

/**
 * What the handler posts back. `started` comes first, once the grammar is
 * loaded and just before the synchronous highlight call: it's what starts the
 * main thread's per-job deadline, so the time spent loading chunks — which on a
 * cold start waits on whatever else is happening — never counts against a
 * block's text. Then exactly one of `html` or `error`.
 */
export type HighlightReply =
  | { id: number; started: true }
  | { id: number; html: string }
  | { id: number; error: HighlightError };

/**
 * Handle one request: load what it needs into `registry`, highlight, and post
 * the result. Every path ends in exactly one `html` or `error` reply, so the
 * returned promise has nothing to reject with.
 *
 * `waitTurn` is awaited once everything has loaded, just before `started` and
 * the synchronous highlight call. The worker has its thread to itself and
 * passes nothing; the in-thread fallback waits there for its share of the main
 * thread, so it must not reject either.
 */
export async function handleHighlightRequest(
  registry: GrammarRegistry,
  { id, grammar, text, maxHtml }: HighlightRequest,
  post: (reply: HighlightReply) => void,
  waitTurn?: () => Promise<void>,
): Promise<void> {
  // A Map lookup, so a sender's `__proto__` can't find anything.
  if (!GRAMMAR_LOADERS.has(grammar)) return post({ id, error: "grammar" });
  let hljs: HLJSApi;
  try {
    hljs = await registry.loadCore();
  } catch {
    return post({ id, error: "core" });
  }
  try {
    await registry.loadGrammar(hljs, grammar);
  } catch {
    return post({ id, error: "grammar" });
  }
  if (waitTurn) await waitTurn();
  post({ id, started: true });
  let html: string | undefined;
  try {
    html = highlightText(hljs, grammar, text);
  } catch {
    return post({ id, error: "highlight" });
  }
  if (html === undefined || html.length > maxHtml) return post({ id, error: "size" });
  post({ id, html });
}
