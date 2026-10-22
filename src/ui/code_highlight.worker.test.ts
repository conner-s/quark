import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HLJSApi, LanguageFn } from "highlight.js";
import type { GrammarRegistry, HighlightReply, HighlightRequest } from "./code_highlight_grammars.js";

// The handler the highlighting worker runs (and the in-thread fallback with
// it), tested as the plain function it is, then the worker entry that wires it
// to a message port. Fresh modules and an empty highlight.js core per test, so
// "loaded" and "registered" mean only what the test did.
type Grammars = typeof import("./code_highlight_grammars.js");
let grammars: Grammars;
let hljs: HLJSApi;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  hljs = (await import("highlight.js/lib/core")).default;
  for (const name of hljs.listLanguages()) hljs.unregisterLanguage(name);
  grammars = await import("./code_highlight_grammars.js");
});

/** A request as the main thread posts one; `maxHtml` no test runs into unless it says so. */
type Request = Omit<HighlightRequest, "maxHtml"> & Partial<Pick<HighlightRequest, "maxHtml">>;
const request = (r: Request): HighlightRequest => ({ maxHtml: 1_000_000, ...r });

/** Every reply the handler posts for `r`, in order. */
async function handle(r: Request, registry: GrammarRegistry = grammars.createGrammarRegistry()): Promise<HighlightReply[]> {
  const replies: HighlightReply[] = [];
  await grammars.handleHighlightRequest(registry, request(r), (reply) => replies.push(reply));
  return replies;
}

/** The reply that settles a request: the last one posted. */
const final = (replies: HighlightReply[]): HighlightReply | undefined => replies[replies.length - 1];

describe("handleHighlightRequest", () => {
  it("loads the grammar, says it has started, then replies with token HTML", async () => {
    const replies = await handle({ id: 7, grammar: "rust", text: "fn main() {}" });

    expect(replies).toEqual([
      { id: 7, started: true },
      { id: 7, html: expect.stringContaining('<span class="hljs-keyword">fn</span>') },
    ]);
    expect(hljs.listLanguages()).toContain("rust");
  });

  it("loads the grammar's sub-languages with it, transitively", async () => {
    const replies = await handle({ id: 1, grammar: "xml", text: "<script>const a = 1;</script>" });

    expect(final(replies)).toEqual({ id: 1, html: expect.stringContaining('<span class="language-javascript">') });
    expect(hljs.listLanguages()).toEqual(expect.arrayContaining(["xml", "javascript", "css", "graphql"]));
  });

  it("applies the nix attribute fix", async () => {
    const replies = await handle({ id: 1, grammar: "nix", text: "inputs = { };" });

    expect(final(replies)).toEqual({ id: 1, html: expect.stringContaining('<span class="hljs-attr">inputs</span>') });
  });

  // shell-session hands each prompt line to bash and re-opens bash's unclosed
  // `${` scopes on the next line, one more per line: ~70 M characters of HTML
  // at this length without the budget.
  it("gives a block up as a size error once it needs more than MAX_HIGHLIGHT_NODES nodes", async () => {
    const text = "\n%${".repeat(2000);

    const replies = await handle({ id: 3, grammar: "shell", text });

    expect(final(replies)).toEqual({ id: 3, error: "size" });
  });

  // Under MAX_HIGHLIGHT_NODES (~11 000 nodes), but ~19 per character: a
  // message of dozens of these was 435 000 spans and a 0.7 s freeze a render.
  it("gives up a short block that needs more than twice its length in nodes", async () => {
    const text = "\n%${".repeat(145);
    expect(grammars.nodeBudget(text.length)).toBeLessThan(grammars.MAX_HIGHLIGHT_NODES);

    const replies = await handle({ id: 5, grammar: "shell", text });

    expect(final(replies)).toEqual({ id: 5, error: "size" });
  });

  // ~7 100 spans: the densest real code measured, and over half the budget, so
  // a budget counted twice (installed once per registry) would trip on it.
  it("highlights minified JSON at MAX_HIGHLIGHT_CHARS, even with a second registry on the same core", async () => {
    const text = '{"a":1,"b":[1,2,3],"c":null}'.repeat(400).slice(0, 10_000);
    await handle({ id: 1, grammar: "json", text: "{}" });

    const replies = await handle({ id: 2, grammar: "json", text });

    const reply = final(replies);
    expect(reply && "html" in reply ? reply.html.split("<span").length - 1 : 0).toBeGreaterThan(7_000);
  });

  it("fetches and registers each grammar once per registry", async () => {
    const registry = grammars.createGrammarRegistry();
    const register = vi.spyOn(hljs, "registerLanguage");

    await handle({ id: 1, grammar: "rust", text: "fn a() {}" }, registry);
    await handle({ id: 2, grammar: "rust", text: "fn b() {}" }, registry);

    expect(register).toHaveBeenCalledTimes(1);
  });

  it.each(["zig", "__proto__", "constructor", ""])(
    "replies with a grammar error for %j, a grammar Quark doesn't ship, loading nothing",
    async (grammar) => {
      const core = vi.fn(() => import("highlight.js/lib/core"));

      const replies = await handle({ id: 3, grammar, text: "x" }, grammars.createGrammarRegistry(core));

      expect(replies).toEqual([{ id: 3, error: "grammar" }]);
      expect(core).not.toHaveBeenCalled();
    },
  );

  it("replies with a core error when the core won't load, and loads it next time", async () => {
    // A core error is what tells the main thread the worker is no use; the
    // registry still mustn't remember it, for the in-thread fallback's sake.
    let calls = 0;
    const registry = grammars.createGrammarRegistry(() =>
      ++calls === 1 ? Promise.reject(new Error("chunk failed")) : import("highlight.js/lib/core"),
    );

    expect(await handle({ id: 1, grammar: "rust", text: "fn a() {}" }, registry)).toEqual([{ id: 1, error: "core" }]);
    expect(final(await handle({ id: 2, grammar: "rust", text: "fn a() {}" }, registry))).toHaveProperty("html");
    expect(calls).toBe(2);
  });

  it("replies with a grammar error when a chunk won't load, and tries it again next time", async () => {
    const loaders = grammars.GRAMMAR_LOADERS as Map<string, () => Promise<{ default: LanguageFn }>>;
    const load = loaders.get("rust")!;
    let calls = 0;
    loaders.set("rust", () => (++calls === 1 ? Promise.reject(new Error("chunk failed")) : load()));
    const registry = grammars.createGrammarRegistry();

    expect(await handle({ id: 1, grammar: "rust", text: "fn a() {}" }, registry)).toEqual([{ id: 1, error: "grammar" }]);
    expect(final(await handle({ id: 2, grammar: "rust", text: "fn a() {}" }, registry))).toHaveProperty("html");
    expect(calls).toBe(2);
  });

  it("replies with a size error, sending no HTML, when the HTML runs past maxHtml", async () => {
    // Some grammars nest a span per line around the rest of the block: no use
    // copying tens of millions of characters across only to throw them away.
    const text = "fn a() {}";
    const html = final(await handle({ id: 1, grammar: "rust", text }));
    expect(html).toHaveProperty("html");
    const { length } = (html as { html: string }).html;

    expect(await handle({ id: 2, grammar: "rust", text, maxHtml: length - 1 })).toEqual([
      { id: 2, started: true },
      { id: 2, error: "size" },
    ]);
    expect(final(await handle({ id: 3, grammar: "rust", text, maxHtml: length }))).toHaveProperty("html");
  });

  it("waits its turn once everything has loaded, before it starts", async () => {
    // The in-thread fallback's hook for its share of the main thread.
    const replies: HighlightReply[] = [];
    let release!: () => void;
    const waitTurn = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));

    const done = grammars.handleHighlightRequest(
      grammars.createGrammarRegistry(),
      request({ id: 5, grammar: "rust", text: "fn a() {}" }),
      (reply) => replies.push(reply),
      waitTurn,
    );
    await vi.waitFor(() => expect(waitTurn).toHaveBeenCalledTimes(1));
    expect(hljs.listLanguages()).toContain("rust");
    expect(replies).toEqual([]);

    release();
    await done;
    expect(replies).toEqual([{ id: 5, started: true }, { id: 5, html: expect.stringContaining("hljs-keyword") }]);
  });

  it("doesn't wait a turn for a request that fails before highlighting", async () => {
    const waitTurn = vi.fn(() => Promise.resolve());
    const replies: HighlightReply[] = [];

    await grammars.handleHighlightRequest(
      grammars.createGrammarRegistry(),
      request({ id: 6, grammar: "zig", text: "x" }),
      (reply) => replies.push(reply),
      waitTurn,
    );

    expect(replies).toEqual([{ id: 6, error: "grammar" }]);
    expect(waitTurn).not.toHaveBeenCalled();
  });

  it("replies with a highlight error when highlight.js throws", async () => {
    vi.spyOn(hljs, "highlight").mockImplementation(() => {
      throw new Error("grammar blew up");
    });

    expect(await handle({ id: 4, grammar: "rust", text: "fn a() {}" })).toEqual([
      { id: 4, started: true },
      { id: 4, error: "highlight" },
    ]);
  });
});

describe("GrammarRegistry.ready", () => {
  it("holds the core only once the grammar and everything it embeds are registered", async () => {
    const registry = grammars.createGrammarRegistry();
    expect(registry.ready("xml")).toBeUndefined();

    const core = await registry.loadCore();
    expect(registry.ready("xml")).toBeUndefined();

    await registry.loadGrammar(core, "xml");
    expect(registry.ready("xml")).toBe(hljs);
    // javascript was registered as xml's dependency, not asked for itself.
    expect(registry.ready("javascript")).toBeUndefined();
  });
});

describe("the worker entry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    self.onmessage = null;
  });

  it("does nothing outside a worker", async () => {
    // Imported into a window, it must leave the page's own handler alone.
    await import("./code_highlight.worker.js");

    expect(self.onmessage).toBeNull();
  });

  it("answers each request posted to it with the handler's replies", async () => {
    vi.stubGlobal("WorkerGlobalScope", class {});
    const posted: unknown[] = [];
    vi.spyOn(self, "postMessage").mockImplementation(((message: unknown) => {
      posted.push(message);
    }) as typeof self.postMessage);
    await import("./code_highlight.worker.js");

    // Called directly: under vitest the global is Node's, where `onmessage` is
    // a plain property rather than an event handler a dispatch would reach.
    self.onmessage?.call(self, new MessageEvent("message", { data: request({ id: 9, grammar: "rust", text: "fn a() {}" }) }));

    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted).toEqual([
      { id: 9, started: true },
      { id: 9, html: expect.stringContaining('<span class="hljs-keyword">fn</span>') },
    ]);
  });
});
