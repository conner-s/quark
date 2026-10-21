// Syntax highlighting for fenced code blocks in message HTML.
//
// A code block arrives as `<pre><code class="language-nix">…</code></pre>` —
// from Quark's own composer, or from any other client (Element sends the same
// shape). The sanitizer keeps `code[class]` but strips every class from `span`,
// so nothing a remote sender writes can pose as a token span: the colours come
// from here, from the text alone.
//
// Four constraints shape this module:
//
// - Hostile input. A block's text is whatever its sender chose, and several
//   highlight.js grammars take time quadratic in the right text — csharp's
//   worst is cubic. At 10 000 characters, in desktop V8: java takes 757 ms over
//   `$`×n (2979 ms at 20 000) and 411 ms over `a`×n, ini ~390 ms over a run of
//   `-` or `0`, nix 330 ms over newlines, csharp 273 ms over `foo bar\n`
//   repeated (and 12 s over `a<b> ` repeated), properties 193 ms over ` \`
//   repeated, markdown 106 ms over `[`s. Realistic code of the same size takes
//   2–5 ms. A 64 KB event holds ~6 such blocks, and a re-render that missed the
//   cache would pay again: seconds of frozen UI on a desktop from one event,
//   far worse on a phone. So highlighting runs in a worker
//   (code_highlight.worker.ts), one job at a time, each under a deadline — a
//   job past it costs the worker its life and the block its colours, and is
//   never tried again. Where no worker can run, an in-thread fallback takes
//   over, with limits on each block and a budget for each task to bound it
//   instead. Either way the HTML that comes back is checked and applied on the
//   main thread, so its size is capped too.
//
// - Bundle size. highlight.js and its grammars load lazily, in either realm;
//   code_highlight_grammars.ts is the one file that imports them, and the main
//   thread only reaches it through dynamic imports.
//
// - Re-rendering. The timeline tears down and rebuilds bodies constantly (room
//   open renders up to 250, then culls, jumps and UTD reloads rebuild them
//   again), and event ids are unstable keys — an optimistic id is renamed, an
//   edit keeps its id but changes the text. So results are cached by content,
//   and a cached result is applied synchronously, inside the render: a rebuilt
//   body never flashes plain text before its colours.
//
// - No guessing. Only a block that names its language is highlighted, as in
//   Element; highlight.js's auto-detection runs every grammar over the text and
//   still mislabels short snippets, and painting prose as code is worse than
//   leaving code plain.

import {
  createGrammarRegistry,
  GRAMMAR_LOADERS,
  handleHighlightRequest,
  highlightText,
  type HighlightReply,
  type HighlightRequest,
} from "./code_highlight_grammars.js";

/**
 * Longest code text that gets highlighted, in UTF-16 code units.
 *
 * In the worker, time isn't what this bounds — JOB_TIMEOUT_MS does that — so it
 * can sit past Element's 4096: a whole `flake.nix` or `Cargo.toml` pasted into
 * a room, exactly what this feature is for, commonly runs longer. It bounds
 * the text a block can ask the worker to work through, and sets the scale for
 * MAX_HIGHLIGHT_HTML_CHARS.
 */
export const MAX_HIGHLIGHT_CHARS = 10_000;

/**
 * Longest highlighted HTML that is applied, in UTF-16 code units. Checking the
 * HTML and swapping it in runs on the main thread whichever engine produced it,
 * in time that follows its size, so this bounds what one block costs the UI and
 * takes of the cache.
 *
 * Code runs 2–3× its text (10 000 characters of this repo's TypeScript, Rust,
 * CSS or Nix: 1.8–2.5×), markup and diffs 12–15×, and compact JSON up to ~27×:
 * 10 000 characters of it is ~275 000 characters of HTML in ~7 000 spans. This
 * is sized to take that. At this size checking and applying a block took ~45 ms
 * in headless Firefox. A shorter block is held to less (htmlLimit).
 *
 * It isn't what stops HTML that grows faster than the text — a grammar that
 * hands each line to an embedded one and carries its open scopes over
 * (shell-session over `\n%${`) builds tens of millions of characters inside
 * the deadline. nodeBudget stops that where it's built
 * (code_highlight_grammars.ts). This is the main thread's own check on what it
 * is handed: the worker drops HTML past it before posting (a `size` error),
 * and the length is checked again on arrival. A block past it stays plain for
 * the session, like a given-up one, since the same text yields the same HTML.
 */
export const MAX_HIGHLIGHT_HTML_CHARS = 400_000;

/**
 * Longest HTML a block of `text` may come back as: 40× its length (compact
 * JSON, the densest real code, runs ~27×; `1,` repeated, a span a character,
 * ~37×), plus room for a short block's wrappers, up to MAX_HIGHLIGHT_HTML_CHARS.
 * As nodeBudget does for nodes, this holds a message's HTML to its length
 * however the message is cut into blocks, so what one render applies is
 * bounded by what the senders wrote, not by how each block amplifies it.
 */
export function htmlLimit(text: string): number {
  return Math.min(MAX_HIGHLIGHT_HTML_CHARS, 40 * text.length + 2048);
}

/**
 * Most code blocks highlighted in one body; the rest stay plain. A 64 KB event
 * holds ~1 800 tiny blocks, each its own job. No real message has more than a
 * handful, and capping a body keeps one message from filling the queue.
 */
export const MAX_BLOCKS_PER_BODY = 64;

/**
 * Longest code text the in-thread fallback highlights. On the main thread
 * nothing can interrupt highlight.js, so the input has to bound the cost — and
 * only its length bounds inputs nobody has found yet: time quadratic in the
 * length costs 1/16 at 1024 of what it does at 4096, time cubic 1/64.
 *
 * Element's 4096 isn't enough. Within FALLBACK_MAX_RUN, at 4096 characters in
 * desktop V8: csharp takes 828 ms over `a<b> ` repeated (its function rule,
 * `(TYPE_IDENT_RE\s+)+IDENT\s*(<[^=]+>\s*)?\(`, is cubic over text that looks
 * like generics), shell-session 251 ms over `\n%${` (the bash it embeds per
 * prompt carries each unclosed `${` on to the next), markdown 138 ms over
 * ` [::](`, properties 96 ms over `--&\` and a tab. At 1024 the same inputs
 * take 13.5, 18.6, 2.5 and 6.4 ms. So on the fallback a longer block stays
 * plain — and the fallback only runs where the worker can't, where plain text
 * is the safe answer.
 */
export const FALLBACK_MAX_CHARS = 1024;

/**
 * Longest run of whitespace, or of anything but whitespace, a block may hold
 * for the in-thread fallback to highlight it. Floods are where the quadratic
 * grammars do worst — java over `$`×n, ini over `-`s, nix over newlines —
 * and real code doesn't run 256 characters without a space or 256 spaces
 * without a character. Under FALLBACK_MAX_CHARS this is the second line, not
 * the first (java's `$` flood takes 7.6 ms at 1024), but it costs real code
 * nothing.
 *
 * With both limits, the slowest block found takes ~20 ms: csharp over
 * `a<b>\nFoo` repeated, then shell-session over `\n$${` at ~16 ms, and nothing
 * else above ~6 ms. That's from fuzzing every curated grammar with ~19 million
 * random multi-token units at 1024 (grammar keywords among the tokens), after
 * ~4 million at 4096, an exhaustive search of five-symbol units and a
 * 2016-pattern fuzz. It is a search, not a proof — the claim that 4096 and this
 * run limit kept every block near 40 ms came from a smaller one, and was
 * wrong — which is why the length cap, not this, is the limit doing the work.
 */
export const FALLBACK_MAX_RUN = 256;

/**
 * Main-thread time the in-thread fallback spends in highlight.js per task
 * before the next block waits for a later one. The limits above bound a block,
 * not an event: a 64 KB event holds ~30 blocks of FALLBACK_MAX_CHARS (each
 * counted twice, in `body` and `formatted_body`), over half a second back
 * to back at the worst found. (Under the old 4096 limit, 16 such blocks
 * re-run after a worker failure stalled the main thread for 588 ms.) With
 * this, no task spends more than the budget plus one block — ~36 ms at the
 * worst found — and the rest of a render's blocks colour in over the following
 * tasks. That is time in highlight.js; checking and applying each result comes
 * on top, held per block by htmlLimit. One frame at 60 Hz: realistic code at FALLBACK_MAX_CHARS takes well
 * under 1 ms, so an ordinary render's blocks all still highlight within it,
 * during the render.
 */
export const FALLBACK_TASK_BUDGET_MS = 16;

/**
 * How long the worker gets to highlight one block, counted from when its
 * grammar has loaded. Realistic code at MAX_HIGHLIGHT_CHARS takes 2–5 ms in
 * desktop V8, so a phone ten times slower is still a factor of thirty inside
 * this, while the hostile inputs above run from ~100 ms to seconds. Past it the
 * worker is terminated — nothing else interrupts highlight.js — and the block
 * is given up. On a desktop the inputs above mostly finish inside it (java's
 * `$` flood took 827 ms in headless Firefox's worker), costing worker time but
 * no UI time; it is on a phone, or on a worse input, that the deadline bites.
 *
 * What it protects is the queue rather than the UI (the worker already spares
 * that), and only so far. With one job at a time, every block behind a hostile
 * one waits on it, and the waits add up: six such blocks in one event can hold
 * the queue for six deadlines, ~9 s, plus a fresh worker's start after each.
 * JobQueue decides who pays. Blocks in the document go before blocks in bodies
 * that were thrown away (a room left behind), and once a body has had a block
 * time out, its other blocks wait behind everyone else's. A hostile sender can
 * keep the worker busy, then, but can't keep the rest of the room plain for
 * long. The job in flight is never pre-empted: the code on screen can wait up
 * to one deadline on a block that is no longer there.
 */
export const JOB_TIMEOUT_MS = 1500;

/**
 * How long a job may wait for the core and its grammar to load in the worker
 * before that worker counts as broken and the in-thread fallback takes over.
 * The chunks are local files, so a working worker never gets near this; it is
 * generous because a cold start comes in the middle of the render burst that
 * opened the room, and can wait on a busy main thread.
 */
export const LOAD_TIMEOUT_MS = 10_000;

/**
 * A deadline timer that fires more than LATE_TIMER_MS late ran behind a long
 * main-thread task — and the worker's reply may be queued behind it in turn. So
 * instead of judging, it looks again TIMER_GRACE_MS later, once queued tasks
 * have run. Without this, a two-second render burst that began just after a
 * job started would time out a block that took 5 ms.
 */
const LATE_TIMER_MS = 250;
const TIMER_GRACE_MS = 100;

/**
 * Size budget for the result cache, in characters of key plus value (~4 MB as
 * UTF-16). Highlighted code runs 2–3× the length of its text, so this holds
 * thousands of ordinary snippets — comfortably every block in the 250 bodies
 * the timeline keeps rendered — and four results at MAX_HIGHLIGHT_HTML_CHARS.
 */
const CACHE_CHAR_BUDGET = 2_000_000;

/**
 * Size budget for the given-up keys, in characters (~2 MB at most). Only jobs
 * that ran past JOB_TIMEOUT_MS or came back too big (htmlLimit, nodeBudget) land
 * there, so only hostile (or huge) blocks fill it; an evicted one costs the
 * worker another try, not the UI.
 */
const GIVEN_UP_CHAR_BUDGET = 1_000_000;

/**
 * What a `language-*` class may name. Shared with the composer (which writes
 * the class) and the Rust sanitizer (which keeps only classes of this shape),
 * so a token that passes one passes all three.
 */
const LANGUAGE_CLASS = /^language-([A-Za-z0-9_+#.-]+)$/;

/**
 * Every name a fence can use, per grammar. highlight.js only learns a
 * grammar's aliases once that grammar is registered — too late to pick which
 * chunk to load, and in another realm besides — so the table lives here. It
 * carries each grammar's own declared aliases (the tests hold it to that) plus
 * a few common fence names highlight.js lacks.
 *
 * `shell` is the one override: highlight.js names its *shell-session* grammar
 * `shell`, which colours only lines after a `$ ` prompt. On GitHub, whose fence
 * names chat users copy, ```shell means a script, and most such blocks have no
 * prompt at all — so `shell` goes to bash, and the session grammar keeps its
 * `console` / `shellsession` aliases.
 */
const GRAMMAR_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["armasm", ["arm"]],
  ["bash", ["sh", "zsh", "shell"]],
  ["c", ["h"]],
  ["clojure", ["clj", "edn"]],
  ["cmake", ["cmake.in"]],
  ["cpp", ["cc", "c++", "h++", "hpp", "hh", "hxx", "cxx"]],
  ["csharp", ["cs", "c#"]],
  ["diff", ["patch"]],
  ["dockerfile", ["docker", "containerfile"]],
  ["dos", ["bat", "batch", "cmd"]],
  ["elixir", ["ex", "exs"]],
  ["erlang", ["erl"]],
  ["fsharp", ["fs", "f#"]],
  ["go", ["golang"]],
  ["graphql", ["gql"]],
  ["groovy", ["gradle"]],
  ["haskell", ["hs"]],
  ["ini", ["toml"]],
  ["java", ["jsp"]],
  ["javascript", ["js", "jsx", "mjs", "cjs"]],
  ["json", ["jsonc", "json5"]],
  ["kotlin", ["kt", "kts", "ktm", "ktx"]],
  ["latex", ["tex"]],
  ["llvm", ["ll"]],
  ["lua", ["pluto"]],
  ["makefile", ["mk", "mak", "make"]],
  ["markdown", ["md", "mkdown", "mkd"]],
  ["nginx", ["nginxconf"]],
  ["nix", ["nixos"]],
  ["objectivec", ["mm", "objc", "obj-c", "obj-c++", "objective-c", "objective-c++"]],
  ["ocaml", ["ml"]],
  ["perl", ["pl", "pm"]],
  ["plaintext", ["text", "txt"]],
  ["powershell", ["pwsh", "ps", "ps1"]],
  ["protobuf", ["proto"]],
  ["python", ["py", "gyp", "ipython"]],
  ["python-repl", ["pycon"]],
  ["ruby", ["rb", "gemspec", "podspec", "thor", "irb"]],
  ["rust", ["rs"]],
  ["scheme", ["scm"]],
  ["shell", ["console", "shellsession"]],
  ["typescript", ["ts", "tsx", "mts", "cts"]],
  ["verilog", ["v", "sv", "svh"]],
  ["vim", ["viml", "vimscript"]],
  ["wasm", ["wat"]],
  ["x86asm", ["asm"]],
  ["xml", ["html", "xhtml", "rss", "atom", "xjb", "xsd", "xsl", "plist", "wsf", "svg"]],
  ["yaml", ["yml"]],
];

// A Map, not an object: fence names are sender-controlled, and a plain-object
// lookup of `constructor` or `__proto__` would find Object.prototype members.
const ALIASES: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  // Names first, so an alias that reuses a grammar's name (`shell`) overrides it.
  for (const name of GRAMMAR_LOADERS.keys()) map.set(name, name);
  for (const [grammar, aliases] of GRAMMAR_ALIASES) {
    for (const alias of aliases) map.set(alias, grammar);
  }
  return map;
})();

/**
 * The grammar a fence's language token selects, or `undefined` when Quark has
 * none for it. Case-insensitive, as fence names are in practice (`Rust`, `C#`).
 */
export function resolveGrammar(token: string): string | undefined {
  return ALIASES.get(token.toLowerCase());
}

// ── Result cache and given-up keys ──────────────────────────────────────────

/** Highlighted HTML by CodeBlock key; Map order is recency order. */
const cache = new Map<string, string>();
let cacheChars = 0;

function cacheGet(key: string): string | undefined {
  const html = cache.get(key);
  if (html !== undefined) {
    // Refresh recency.
    cache.delete(key);
    cache.set(key, html);
  }
  return html;
}

function cachePut(key: string, html: string): void {
  const old = cache.get(key);
  if (old !== undefined) {
    cache.delete(key);
    cacheChars -= key.length + old.length;
  }
  cache.set(key, html);
  cacheChars += key.length + html.length;
  for (const [k, v] of cache) {
    if (cacheChars <= CACHE_CHAR_BUDGET) break;
    cache.delete(k);
    cacheChars -= k.length + v.length;
  }
}

/**
 * Blocks that stay plain for the session: their job ran past JOB_TIMEOUT_MS,
 * or their HTML came back past htmlLimit or would have needed more nodes than
 * nodeBudget allows (code_highlight_grammars.ts). A retry would only
 * cost the worker the same again, and a timed-out one would hold the queue for
 * another deadline. Insertion order is age order.
 */
const givenUp = new Set<string>();
let givenUpChars = 0;

function giveUp(key: string): void {
  if (givenUp.has(key)) return;
  givenUp.add(key);
  givenUpChars += key.length;
  for (const k of givenUp) {
    if (givenUpChars <= GIVEN_UP_CHAR_BUDGET) break;
    givenUp.delete(k);
    givenUpChars -= k.length;
  }
}

// ── Jobs and the queue ──────────────────────────────────────────────────────

interface CodeBlock {
  grammar: string;
  text: string;
  /** `grammar + "\0" + text`: what the cache, the given-up set and dedup go by. */
  key: string;
}

/** A `<code>` element waiting on a job, and the root it was found under. */
interface Waiter {
  code: HTMLElement;
  root: ParentNode;
}

/** A block on its way through an engine. `done` is called exactly once. */
interface Job extends CodeBlock {
  /** Every element waiting on this job — more than one when dedup shares it. */
  readonly waiters: Waiter[];
  /** The HTML highlight.js produced, unchecked, or `undefined` for none. */
  done(html: string | undefined): void;
}

/** Text-select mode: the body is editable and holds a caret in its text nodes. */
const EDITABLE = "[contenteditable]:not([contenteditable='false'])";

/**
 * Whether `code` still holds the block `key` names: its text unchanged, its
 * grammar the same, not yet highlighted. That is what makes a job's result of
 * use to it — now, or, inside a contenteditable body (text-select mode, which
 * leaves without re-rendering), from the cache on its next render.
 */
function stillHolds(code: HTMLElement, key: string): boolean {
  return codeBlockOf(code)?.key === key;
}

/** Whether the result for `key` may be applied to `code` now: the async apply's re-check. */
function canApply(code: HTMLElement, key: string): boolean {
  return stillHolds(code, key) && !code.closest(EDITABLE);
}

/**
 * Roots (message bodies) one of whose jobs ran past JOB_TIMEOUT_MS. A sender
 * who wrote one block that hangs a grammar most likely wrote its siblings the
 * same way, so their jobs wait behind everyone else's rather than taking the
 * queue for a deadline each.
 */
const suspectRoots = new WeakSet<ParentNode>();

/**
 * Jobs waiting for an engine, served best first rather than in arrival order.
 *
 * First comes the oldest job a block in the document is waiting on, outside a
 * suspect root; then the oldest of the rest — a body that hasn't been inserted
 * yet, or one that was thrown away, or a suspect one. Never in the document
 * isn't the same as unwanted: the timeline keeps an inline thread panel
 * detached while its root is out of the window and puts it back later without
 * re-rendering it, so such jobs still run, just later. A job that no block
 * wants any more — every waiter re-rendered, edited, or highlighted from the
 * cache — is dropped instead, done with nothing, and nothing remembers it.
 */
/** How many live jobs JobQueue.take looks through for one in the document. */
const TAKE_LOOKAHEAD = 64;

class JobQueue {
  private readonly jobs: Job[] = [];

  push(job: Job): void {
    this.jobs.push(job);
  }

  /**
   * The job to run next, removed from the queue; `undefined` when none is left.
   *
   * Looks at most TAKE_LOOKAHEAD live jobs deep for one in the document, then
   * settles for the oldest. Searching the whole queue made every take cost the
   * whole backlog: leave a room with thousands of blocks queued (a 64 KB event
   * holds ~1 800 tiny ones) and each worker reply rescanned all of them on the
   * main thread, saturating it until the backlog drained. Dead jobs dropped on
   * the way don't count against the bound; each is dropped once.
   */
  take(): Job | undefined {
    let pick = -1;
    for (let i = 0, seen = 0; i < this.jobs.length && seen < TAKE_LOOKAHEAD; ) {
      const job = this.jobs[i];
      const live = job.waiters.filter((w) => stillHolds(w.code, job.key));
      if (live.length === 0) {
        this.jobs.splice(i, 1);
        job.done(undefined);
        continue;
      }
      if (live.some((w) => w.code.isConnected && !suspectRoots.has(w.root))) {
        pick = i;
        break;
      }
      if (pick < 0) pick = i;
      i++;
      seen++;
    }
    return pick < 0 ? undefined : this.jobs.splice(pick, 1)[0];
  }

  /** Every job left, in arrival order, leaving the queue empty. */
  drain(): Job[] {
    return this.jobs.splice(0);
  }
}

// ── Engines ─────────────────────────────────────────────────────────────────

/** Whether the in-thread fallback may run highlight.js over `text`. */
function withinFallbackLimits(text: string): boolean {
  if (text.length > FALLBACK_MAX_CHARS) return false;
  for (const [run] of text.matchAll(/\s+|\S+/g)) {
    if (run.length > FALLBACK_MAX_RUN) return false;
  }
  return true;
}

/**
 * highlight.js in a worker, one job at a time.
 *
 * One at a time is what gives the deadline meaning: a job's clock runs while
 * the worker is doing nothing else, so running past it says the job is the
 * problem, and terminating the worker loses no other work. JobQueue picks
 * which job goes next.
 */
class WorkerEngine {
  private worker: Worker | undefined;
  private readonly queue = new JobQueue();
  /** The job the worker has, and whether it is still loading or highlighting. */
  private current: { job: Job; id: number; phase: "load" | "highlight" } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastId = 0;

  /** `unusable` takes the jobs this engine had when it found it can't go on. */
  constructor(private readonly unusable: (orphans: Job[]) => void) {}

  run(job: Job): void {
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    if (this.current) return;
    const job = this.queue.take();
    if (!job) return;
    const id = ++this.lastId;
    this.current = { job, id, phase: "load" };
    try {
      // Created on first need, and again after a timeout terminated the last.
      this.worker ??= this.spawn();
      this.worker.postMessage(requestFor(job, id) satisfies HighlightRequest);
    } catch {
      this.fail();
      return;
    }
    this.arm(LOAD_TIMEOUT_MS);
  }

  private spawn(): Worker {
    // A same-origin file, which the CSP's `script-src 'self'` allows; it must
    // never be inlined (`?worker&inline` makes a blob: URL, which it doesn't).
    const worker = new Worker(new URL("./code_highlight.worker.ts", import.meta.url), { type: "module" });
    // A terminated worker can still have an event queued: only the current one's count.
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (worker === this.worker) this.receive(event.data);
    };
    // A script that won't load, an uncaught error, or a reply that can't be
    // deserialised: whatever it is, this worker can't be relied on.
    worker.onerror = () => {
      if (worker === this.worker) this.fail();
    };
    worker.onmessageerror = () => {
      if (worker === this.worker) this.fail();
    };
    return worker;
  }

  private receive(data: unknown): void {
    const current = this.current;
    if (!current || !isReply(data) || data.id !== current.id) return;
    if ("started" in data) {
      current.phase = "highlight";
      this.arm(JOB_TIMEOUT_MS);
    } else if ("error" in data && data.error === "core") {
      this.fail(); // no highlight.js in that realm, so nothing will ever come back
    } else {
      if ("error" in data && data.error === "size") giveUp(current.job.key);
      this.finish("html" in data ? data.html : undefined);
    }
  }

  /** Start the current job's clock over: `ms` from now. */
  private arm(ms: number): void {
    clearTimeout(this.timer);
    const deadline = performance.now() + ms;
    this.timer = setTimeout(() => this.expire(deadline), ms);
  }

  private expire(deadline: number): void {
    const current = this.current;
    if (!current) return;
    if (performance.now() - deadline > LATE_TIMER_MS) {
      this.arm(TIMER_GRACE_MS);
      return;
    }
    if (current.phase === "load") {
      // Ten seconds without loading local chunks isn't a slow job; it's a
      // worker that doesn't work.
      this.fail();
      return;
    }
    giveUp(current.job.key);
    for (const { root } of current.job.waiters) suspectRoots.add(root);
    this.kill();
    this.finish(undefined); // the next job gets a fresh worker
  }

  private finish(html: string | undefined): void {
    const job = this.current?.job;
    clearTimeout(this.timer);
    this.current = undefined;
    this.pump();
    job?.done(html);
  }

  /** Give up on workers altogether, handing every job still here to `unusable`. */
  private fail(): void {
    this.kill();
    const orphans = this.current ? [this.current.job] : [];
    orphans.push(...this.queue.drain());
    this.current = undefined;
    this.unusable(orphans);
  }

  private kill(): void {
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = undefined;
  }
}

function requestFor({ grammar, text }: CodeBlock, id: number): HighlightRequest {
  return { id, grammar, text, maxHtml: htmlLimit(text) };
}

function isReply(data: unknown): data is HighlightReply {
  if (typeof data !== "object" || data === null) return false;
  const reply = data as Partial<Record<"id" | "started" | "html" | "error", unknown>>;
  return (
    typeof reply.id === "number" &&
    (reply.started === true || typeof reply.html === "string" || typeof reply.error === "string")
  );
}

/**
 * The in-thread engine's share of the main thread: how long it has spent in
 * highlight.js during the current task, against FALLBACK_TASK_BUDGET_MS.
 * Spending schedules a timer that zeroes the count, and a timer can only run
 * once the task is over — so "used up" lasts exactly until a later task.
 */
class TaskBudget {
  private used = 0;
  private nextTask: Promise<void> | undefined;

  /** Whether this task has time for another block. A fresh one always does. */
  hasTime(): boolean {
    return this.used < FALLBACK_TASK_BUDGET_MS;
  }

  spend(ms: number): void {
    this.used += ms;
    void this.taskOver();
  }

  /** Resolves when there's time for another block: at once, or in a later task. */
  async turn(): Promise<void> {
    while (!this.hasTime()) await this.taskOver();
  }

  private taskOver(): Promise<void> {
    this.nextTask ??= new Promise((resolve) => {
      setTimeout(() => {
        this.used = 0;
        this.nextTask = undefined;
        resolve();
      }, 0);
    });
    return this.nextTask;
  }
}

/**
 * highlight.js on the main thread, for when no worker can run: where there's
 * no `Worker` at all (jsdom), where `new Worker` throws, or where the worker
 * fails, on its way up or later — the jobs it had are then re-run here.
 *
 * Nothing here can be interrupted, so each block is held to FALLBACK_MAX_CHARS
 * and FALLBACK_MAX_RUN, and each task to FALLBACK_TASK_BUDGET_MS: jobs run one
 * at a time from a JobQueue, and a job that finds the task's budget spent
 * waits for a later task before it highlights.
 *
 * It can do what the worker can't: highlight new text synchronously, during
 * the render, once the block's grammar is loaded — while the budget lasts.
 */
class InThreadEngine {
  private readonly registry = createGrammarRegistry();
  private readonly queue = new JobQueue();
  private readonly budget = new TaskBudget();
  private draining = false;

  /** Whether a block of `grammar` can be highlighted now, inside the render. */
  canHighlightNow(grammar: string): boolean {
    return this.registry.ready(grammar) !== undefined && this.budget.hasTime();
  }

  /** The synchronous path; `undefined` when the block isn't to be highlighted. */
  highlightNow(block: CodeBlock): string | undefined {
    const hljs = this.registry.ready(block.grammar);
    if (!hljs || !withinFallbackLimits(block.text)) return undefined;
    const start = performance.now();
    try {
      const html = highlightText(hljs, block.grammar, block.text);
      // Past the node budget: the same text would run out again.
      if (html === undefined) giveUp(block.key);
      return html;
    } catch {
      return undefined;
    } finally {
      this.budget.spend(performance.now() - start);
    }
  }

  run(job: Job): void {
    if (!withinFallbackLimits(job.text)) {
      job.done(undefined);
      return;
    }
    this.queue.push(job);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let job = this.queue.take(); job; job = this.queue.take()) await this.runOne(job);
    } finally {
      this.draining = false;
    }
  }

  private async runOne(job: Job): Promise<void> {
    let html: string | undefined;
    let start: number | undefined;
    // The worker's own handler, so the fallback can't drift from it; `started`
    // and the reply after it bracket the synchronous highlight call.
    await handleHighlightRequest(
      this.registry,
      requestFor(job, 0),
      (reply) => {
        if ("started" in reply) {
          start = performance.now();
          return;
        }
        if (start !== undefined) this.budget.spend(performance.now() - start);
        if ("html" in reply) html = reply.html;
        else if (reply.error === "size") giveUp(job.key);
      },
      () => this.budget.turn(),
    );
    job.done(html);
  }
}

/** Picked on first need; replaced by the in-thread engine for good if the worker fails. */
let engine: WorkerEngine | InThreadEngine | undefined;

function currentEngine(): WorkerEngine | InThreadEngine {
  engine ??= typeof Worker === "undefined" ? new InThreadEngine() : new WorkerEngine(fallBack);
  return engine;
}

function fallBack(orphans: Job[]): void {
  const inThread = new InThreadEngine();
  engine = inThread;
  for (const job of orphans) inThread.run(job);
}

/** Jobs not yet done, by key, so a block that appears twice is highlighted once. */
const inflight = new Map<string, { job: Job; promise: Promise<string | undefined> }>();

/** The block's checked HTML, from whichever engine is current; never rejects. */
function highlightLater(block: CodeBlock, waiter: Waiter): Promise<string | undefined> {
  const shared = inflight.get(block.key);
  if (shared) {
    shared.job.waiters.push(waiter);
    return shared.promise;
  }
  let resolve!: (html: string | undefined) => void;
  const promise = new Promise<string | undefined>((r) => (resolve = r));
  let settled = false;
  const job: Job = {
    ...block,
    waiters: [waiter],
    done: (html) => {
      if (settled) return;
      settled = true;
      if (inflight.get(block.key)?.job === job) inflight.delete(block.key);
      resolve(settle(block, html));
    },
  };
  // In the map before `run`, which may call `done` before it returns.
  inflight.set(block.key, { job, promise });
  currentEngine().run(job);
  return promise;
}

// ── Checking and applying ───────────────────────────────────────────────────

/**
 * A class highlight.js's renderer writes: `hljs-<scope>`, a `<tier>_` for each
 * further tier of a dotted scope (`hljs-title function_`), and
 * `language-<name>` around a stretch handed to an embedded grammar.
 */
const TOKEN_CLASS = /^(?:hljs-[\w-]+|language-[\w-]+|[A-Za-z][\w-]*_)$/;

/**
 * Whether `html` is token spans over exactly `text`. highlight.js escapes the
 * text and emits only `<span class="…">`, so this should always pass; holding
 * the result to it makes that a property of Quark rather than of a dependency
 * on the far side of a thread boundary — a code block can't grow an element,
 * an attribute or a class that styles it as anything else, and copying it out
 * (or walking it in text-select mode) still yields exactly what was sent.
 */
function isTokenSpans(html: string, text: string): boolean {
  const parsed = parse(html);
  if (parsed.textContent !== text) return false;
  for (const el of parsed.querySelectorAll("*")) {
    if (el.localName !== "span") return false;
    for (const attr of el.attributes) if (attr.name !== "class") return false;
    for (const name of el.classList) if (!TOKEN_CLASS.test(name)) return false;
  }
  return true;
}

/** Check an engine's result, and cache it if it passes. */
function settle({ key, text }: CodeBlock, html: string | undefined): string | undefined {
  if (html === undefined) return undefined;
  // Before the parse, which is the cost this cap is there to bound.
  if (html.length > htmlLimit(text)) {
    giveUp(key);
    return undefined;
  }
  if (!isTokenSpans(html, text)) return undefined;
  cachePut(key, html);
  return html;
}

/** Parse into an inert fragment: nothing in a `<template>` loads or runs. */
function parse(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function apply(code: HTMLElement, html: string): void {
  code.replaceChildren(parse(html));
  code.classList.add("hljs");
}

/**
 * The grammar and text of a `<pre><code>` worth highlighting, or `undefined`.
 *
 * Text-only children, because the code can't be recoloured without rebuilding
 * it, and rebuilding would drop whatever else is in there: other clients put
 * links, custom-emoji `<img>`s and `data-mx-color` spans inside code, and those
 * outrank token colours.
 */
function codeBlockOf(code: HTMLElement): CodeBlock | undefined {
  if (code.classList.contains("hljs")) return undefined; // already highlighted
  for (const node of code.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) return undefined;
  }
  // The first `language-*` class decides, as in Element; a malformed one means
  // no language rather than a search for a later one.
  const token = Array.from(code.classList).find((c) => c.startsWith("language-"));
  const match = token ? LANGUAGE_CLASS.exec(token) : null;
  const grammar = match ? resolveGrammar(match[1]) : undefined;
  if (!grammar) return undefined;
  const text = code.textContent ?? "";
  if (!text || text.length > MAX_HIGHLIGHT_CHARS) return undefined;
  return { grammar, text, key: `${grammar}\0${text}` };
}

/**
 * Highlight every `<pre><code class="language-…">` under `root`.
 *
 * A block whose exact text was highlighted before is done before this returns,
 * from the cache, so a re-rendered body comes back coloured with no plain-text
 * flash — as is new text on the in-thread fallback once its grammar is loaded,
 * while the task's budget lasts. The rest are done when the worker replies (or
 * the fallback gets to them); the returned promise settles then, and never
 * rejects. A block that can't be highlighted — no grammar, past a limit, given
 * up, or a result that fails the check — stays plain text, which is still
 * correct.
 *
 * `root` needn't be attached: bodies are often rendered detached and inserted
 * later, so the async path re-checks the block itself instead of
 * `isConnected`. It skips a block that was re-rendered, edited, or highlighted
 * in the meantime, and one inside a contenteditable body (text-select mode),
 * where swapping the text nodes would throw away the caret.
 *
 * Inline `<code>` (not directly inside `<pre>`) is never highlighted.
 */
export async function highlightCodeBlocks(root: ParentNode): Promise<void> {
  const pending: Promise<void>[] = [];
  const codes = Array.from(root.querySelectorAll<HTMLElement>("pre > code")).slice(0, MAX_BLOCKS_PER_BODY);
  for (const code of codes) {
    const block = codeBlockOf(code);
    if (!block) continue;
    const cached = cacheGet(block.key);
    if (cached !== undefined) {
      apply(code, cached);
      continue;
    }
    if (givenUp.has(block.key)) continue;
    const current = currentEngine();
    if (current instanceof InThreadEngine && current.canHighlightNow(block.grammar)) {
      const html = settle(block, current.highlightNow(block));
      if (html !== undefined) apply(code, html);
      continue;
    }
    const waiter: Waiter = { code, root };
    pending.push(
      highlightLater(block, waiter).then((html) => {
        if (html !== undefined && canApply(code, block.key)) apply(code, html);
      }),
    );
  }
  await Promise.all(pending);
}
