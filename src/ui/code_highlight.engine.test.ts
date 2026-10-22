import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HighlightOptions, HLJSApi } from "highlight.js";
import type { HighlightReply, HighlightRequest } from "./code_highlight_grammars.js";

// The worker engine: the queue, the per-job deadline, the given-up keys, and
// the hand-over to the in-thread fallback. jsdom has no Worker, so each test
// installs FakeWorker in its place; the fallback, when a test reaches it, is
// the real one, running real highlight.js.
//
// Fake timers throughout, so a deadline passes when a test says it does — and
// a job a test leaves in flight leaves no real timer behind it.
type Highlighter = typeof import("./code_highlight.js");
type Grammars = typeof import("./code_highlight_grammars.js");
let hl: Highlighter;
let grammars: Grammars;
let hljs: HLJSApi;

/** Every FakeWorker constructed this test, in order. */
let workers: FakeWorker[];

/**
 * Stands in for the highlighting worker. It records what it's posted and
 * answers only when the test says: by hand (`reply`, `fail`), or by running the
 * real handler over its last request (`answer`), which is all the real worker
 * does.
 */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: HighlightRequest[] = [];
  terminated = false;
  private readonly registry = grammars.createGrammarRegistry();

  constructor(
    readonly url: string | URL,
    readonly options?: WorkerOptions,
  ) {
    workers.push(this);
  }

  postMessage(request: HighlightRequest): void {
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  get last(): HighlightRequest {
    return this.posted[this.posted.length - 1];
  }

  reply(data: HighlightReply | unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  /** Run the real handler over the last request, as the worker would. */
  async answer(): Promise<void> {
    await grammars.handleHighlightRequest(this.registry, this.last, (reply) => this.reply(reply));
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.useFakeTimers();
  workers = [];
  vi.stubGlobal("Worker", FakeWorker);
  hljs = (await import("highlight.js/lib/core")).default;
  for (const name of hljs.listLanguages()) hljs.unregisterLanguage(name);
  hl = await import("./code_highlight.js");
  grammars = await import("./code_highlight_grammars.js");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A detached `<div><pre><code>` holding `text`, as a rendered body would. */
function codeBlock(text: string, className: string): { root: HTMLElement; code: HTMLElement } {
  const root = document.createElement("div");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.setAttribute("class", className);
  code.textContent = text;
  pre.appendChild(code);
  root.appendChild(pre);
  return { root, code };
}

const highlighted = (code: HTMLElement): boolean => code.classList.contains("hljs");

/** Let every promise continuation already queued run — the late apply among them. */
async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("the worker engine", () => {
  it("makes its worker on first need, as a module worker from code_highlight.worker.ts", () => {
    void hl.highlightCodeBlocks(codeBlock("let x = 1;", "language-zig").root);
    expect(workers).toHaveLength(0); // nothing to highlight, so no worker yet

    void hl.highlightCodeBlocks(codeBlock("let x = 1;", "language-js").root);

    expect(workers).toHaveLength(1);
    expect(String(workers[0].url)).toContain("code_highlight.worker");
    expect(workers[0].options).toEqual({ type: "module" });
    expect(workers[0].posted).toEqual([
      { id: expect.any(Number), grammar: "javascript", text: "let x = 1;", maxHtml: hl.htmlLimit("let x = 1;") },
    ]);
  });

  it("highlights through the worker", async () => {
    const { root, code } = codeBlock("let x = 1;", "language-js");

    const done = hl.highlightCodeBlocks(root);
    await workers[0].answer();
    await done;

    expect(code.querySelector(".hljs-keyword")?.textContent).toBe("let");
    expect(code.textContent).toBe("let x = 1;");
  });

  it("applies only cached results synchronously", async () => {
    // No grammar is ever loaded on the main thread, so there's no in-thread
    // path for new text — but a rebuilt body still mustn't flash.
    const first = codeBlock("let x = 1;", "language-js");
    const done = hl.highlightCodeBlocks(first.root);
    await workers[0].answer();
    await done;

    const fresh = codeBlock("let y = 2;", "language-js");
    void hl.highlightCodeBlocks(fresh.root);
    expect(highlighted(fresh.code)).toBe(false);
    expect(workers[0].posted).toHaveLength(2);

    const rebuilt = codeBlock("let x = 1;", "language-js");
    void hl.highlightCodeBlocks(rebuilt.root);
    expect(highlighted(rebuilt.code)).toBe(true);
    expect(workers[0].posted).toHaveLength(2);
  });

  it("keeps one job in flight, posting the next when the last one replies", async () => {
    const blocks = ["let a;", "let b;", "let c;"].map((text) => codeBlock(text, "language-js"));
    const done = Promise.all(blocks.map((b) => hl.highlightCodeBlocks(b.root)));
    const [worker] = workers;

    expect(worker.posted.map((r) => r.text)).toEqual(["let a;"]);
    await worker.answer();
    expect(worker.posted.map((r) => r.text)).toEqual(["let a;", "let b;"]);
    await worker.answer();
    await worker.answer();
    await done;

    expect(blocks.map((b) => highlighted(b.code))).toEqual([true, true, true]);
    expect(workers).toHaveLength(1);
  });

  it("shares one job between identical blocks", async () => {
    // Two in one body, and a re-render of that body while the job is out.
    const body = '<pre><code class="language-js">let x = 1;</code></pre>'.repeat(2);
    const first = document.createElement("div");
    first.innerHTML = body;
    const again = document.createElement("div");
    again.innerHTML = body;

    const done = Promise.all([hl.highlightCodeBlocks(first), hl.highlightCodeBlocks(again)]);
    expect(workers[0].posted).toHaveLength(1);
    await workers[0].answer();
    await done;

    expect([...first.querySelectorAll("code"), ...again.querySelectorAll("code")].map(highlighted)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("takes up to MAX_HIGHLIGHT_CHARS, with no run limit — the deadline bounds it", () => {
    // Exactly the java flood that takes ~750 ms: fine off the main thread.
    void hl.highlightCodeBlocks(codeBlock("$".repeat(hl.MAX_HIGHLIGHT_CHARS), "language-java").root);
    void hl.highlightCodeBlocks(codeBlock("$".repeat(hl.MAX_HIGHLIGHT_CHARS + 1), "language-java").root);

    expect(workers[0].posted.map((r) => r.text.length)).toEqual([hl.MAX_HIGHLIGHT_CHARS]);
  });

  describe("checks what the worker sends back", () => {
    it.each([
      ["an element", '<img src="x" onerror="alert(1)">let x = 1;'],
      ["a span with an attribute", '<span class="hljs-keyword" onclick="alert(1)">let</span> x = 1;'],
      ["a span with a class no token has", '<span class="message__spoiler">let</span> x = 1;'],
      ["different text", '<span class="hljs-keyword">let</span> y = 2;'],
    ])("leaving the block plain, uncached, when the HTML holds %s", async (_label, html) => {
      const { root, code } = codeBlock("let x = 1;", "language-js");
      const before = root.innerHTML;

      const done = hl.highlightCodeBlocks(root);
      workers[0].reply({ id: workers[0].last.id, html });
      await expect(done).resolves.toBeUndefined();

      expect(root.innerHTML).toBe(before);
      // Not cached: the next render asks again.
      void hl.highlightCodeBlocks(codeBlock("let x = 1;", "language-js").root);
      expect(workers[0].posted).toHaveLength(2);
    });

    it("ignoring a reply that isn't for the job in flight", async () => {
      const { root, code } = codeBlock("let x = 1;", "language-js");
      const queued = codeBlock("let y = 2;", "language-js");
      const done = Promise.all([hl.highlightCodeBlocks(root), hl.highlightCodeBlocks(queued.root)]);
      const [worker] = workers;
      const { id } = worker.last;

      // Each of these would pass the HTML check, were it taken as the answer.
      worker.reply({ id: id + 1, html: '<span class="hljs-string">let x = 1;</span>' });
      worker.reply({ id: id - 1, error: "highlight" });
      worker.reply('<span class="hljs-string">let x = 1;</span>');
      worker.reply({ id, html: 42 });
      worker.reply({ id, started: "yes" });
      worker.reply(null);
      await settleMicrotasks();

      expect(highlighted(code)).toBe(false);
      expect(worker.posted).toHaveLength(1); // the job is still the one in flight
      await worker.answer();
      await worker.answer();
      await done;
      expect(code.querySelector(".hljs-keyword")?.textContent).toBe("let");
    });
  });

  it("leaves a block plain that the worker reports too big, and doesn't ask again", async () => {
    // shell-session re-opens one more unclosed bash `${` per line: past
    // MAX_HIGHLIGHT_NODES long before the text is, so the worker says `size`.
    const text = "\n%${".repeat(2000);
    const { root, code } = codeBlock(text, "language-console");
    const done = hl.highlightCodeBlocks(root);
    await workers[0].answer();
    await done;
    expect(highlighted(code)).toBe(false);

    void hl.highlightCodeBlocks(codeBlock(text, "language-console").root);
    expect(workers[0].posted).toHaveLength(1);

    // A dense block that stays within the limits is highlighted as usual: `1,`
    // is a span a character, ~110 000 characters of HTML here.
    const fits = codeBlock("1,".repeat(1500), "language-json");
    const fitsDone = hl.highlightCodeBlocks(fits.root);
    await workers[0].answer();
    await fitsDone;
    expect(highlighted(fits.code)).toBe(true);
  });

  // 40× the text: a short block that comes back far larger than its length is
  // amplification, whatever the absolute size.
  it("holds a short block's HTML to htmlLimit, well under MAX_HIGHLIGHT_HTML_CHARS", async () => {
    const text = "let x = 1;";
    const { root, code } = codeBlock(text, "language-js");
    const html = `<span class="hljs-keyword">let</span>${"<span></span>".repeat(1000)} x = 1;`;
    expect(html.length).toBeGreaterThan(hl.htmlLimit(text));
    expect(html.length).toBeLessThan(hl.MAX_HIGHLIGHT_HTML_CHARS);
    const done = hl.highlightCodeBlocks(root);
    workers[0].reply({ id: workers[0].last.id, html });
    await done;
    expect(highlighted(code)).toBe(false);
  });

  it("holds the worker's HTML to MAX_HIGHLIGHT_HTML_CHARS itself, whatever the worker says", async () => {
    // The worker drops an oversized result itself (a size error); this is the
    // main thread's own check, for HTML that came across anyway.
    const { root, code } = codeBlock("x", "language-js");
    const html = `<span class="hljs-keyword">x</span>${"<span></span>".repeat(hl.MAX_HIGHLIGHT_HTML_CHARS / 13)}`;
    expect(html.length).toBeGreaterThan(hl.MAX_HIGHLIGHT_HTML_CHARS);
    const done = hl.highlightCodeBlocks(root);
    workers[0].reply({ id: workers[0].last.id, html });
    await done;
    expect(highlighted(code)).toBe(false);

    void hl.highlightCodeBlocks(codeBlock("x", "language-js").root);
    expect(workers[0].posted).toHaveLength(1); // given up, like a size error
  });

  it.each([
    ["a grammar chunk failed", "grammar"],
    ["highlight.js threw", "highlight"],
  ] as const)("loses only that job when %s, and asks again next render", async (_label, error) => {
    const { root, code } = codeBlock("let x = 1;", "language-js");
    const done = hl.highlightCodeBlocks(root);
    const [worker] = workers;

    worker.reply({ id: worker.last.id, error });
    await done;
    expect(highlighted(code)).toBe(false);

    const again = codeBlock("let x = 1;", "language-js");
    const retried = hl.highlightCodeBlocks(again.root);
    expect(worker.posted).toHaveLength(2);
    await worker.answer();
    await retried;
    expect(highlighted(again.code)).toBe(true);
    expect(workers).toHaveLength(1);
  });

  describe("past the deadline", () => {
    it("terminates the worker, gives the block up, and goes on in a fresh one", async () => {
      const hostile = codeBlock("$".repeat(5000), "language-java");
      const next = codeBlock("int x;", "language-java");
      const done = Promise.all([hl.highlightCodeBlocks(hostile.root), hl.highlightCodeBlocks(next.root)]);
      const [first] = workers;
      const { id } = first.last;

      first.reply({ id, started: true });
      vi.advanceTimersByTime(hl.JOB_TIMEOUT_MS - 1);
      expect(first.terminated).toBe(false);
      vi.advanceTimersByTime(1);
      expect(first.terminated).toBe(true);

      // The rest of the queue goes to a new worker.
      expect(workers).toHaveLength(2);
      const [, second] = workers;
      expect(second.posted.map((r) => r.text)).toEqual(["int x;"]);
      // Anything the old one still had queued is ignored — an error included,
      // which would otherwise give up on workers altogether.
      first.reply({ id, html: "$".repeat(5000) });
      first.fail();
      expect(second.terminated).toBe(false);
      await second.answer();
      await done;
      expect(highlighted(hostile.code)).toBe(false);
      expect(highlighted(next.code)).toBe(true);

      // Never tried again, even in a brand-new element.
      const again = codeBlock("$".repeat(5000), "language-java");
      await hl.highlightCodeBlocks(again.root);
      expect(highlighted(again.code)).toBe(false);
      expect(second.posted).toHaveLength(1);
      expect(workers).toHaveLength(2);
    });

    it("doesn't count the grammar's loading against the job", async () => {
      // The clock starts at `started`: a cold start can wait on a busy main
      // thread, and that says nothing about the block's text.
      const { root, code } = codeBlock("let x = 1;", "language-js");
      const done = hl.highlightCodeBlocks(root);

      vi.advanceTimersByTime(hl.JOB_TIMEOUT_MS * 3);
      expect(workers[0].terminated).toBe(false);

      await workers[0].answer();
      await done;
      expect(highlighted(code)).toBe(true);
    });

    it("looks again before judging a timer that fired late", async () => {
      // As it would after a long render: the reply may be queued behind it.
      const { root, code } = codeBlock("let x = 1;", "language-js");
      const done = hl.highlightCodeBlocks(root);
      const [worker] = workers;
      const { id } = worker.last;
      worker.reply({ id, started: true });

      vi.spyOn(performance, "now").mockReturnValueOnce(performance.now() + hl.JOB_TIMEOUT_MS + 60_000);
      vi.advanceTimersByTime(hl.JOB_TIMEOUT_MS);
      expect(worker.terminated).toBe(false);

      worker.reply({ id, html: '<span class="hljs-keyword">let</span> x = 1;' });
      await done;
      expect(highlighted(code)).toBe(true);
    });

    it("still gives up after looking again, if nothing came", async () => {
      const { root, code } = codeBlock("let x = 1;", "language-js");
      const done = hl.highlightCodeBlocks(root);
      const [worker] = workers;
      worker.reply({ id: worker.last.id, started: true });

      vi.spyOn(performance, "now").mockReturnValueOnce(performance.now() + hl.JOB_TIMEOUT_MS + 60_000);
      vi.advanceTimersByTime(hl.JOB_TIMEOUT_MS);
      vi.advanceTimersByTime(hl.JOB_TIMEOUT_MS);

      expect(worker.terminated).toBe(true);
      await done;
      expect(highlighted(code)).toBe(false);
    });
  });
});

describe("which job the worker gets next", () => {
  afterEach(() => document.body.replaceChildren());

  /** `codeBlock`, inserted into the document as a rendered body is. */
  function attached(text: string, className = "language-js"): { root: HTMLElement; code: HTMLElement } {
    const block = codeBlock(text, className);
    document.body.appendChild(block.root);
    return block;
  }

  /** A body holding one `<pre><code>` per text, in the document. */
  function attachedBody(texts: string[], className: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = texts.map((t) => `<pre><code class="${className}">${t}</code></pre>`).join("");
    document.body.appendChild(root);
    return root;
  }

  it("serves blocks in the document before those in a body thrown away", async () => {
    // Room A's body is rendered, then the user moves to room B.
    const roomA = attachedBody(["let a1;", "let a2;"], "language-js");
    const doneA = hl.highlightCodeBlocks(roomA);
    const [worker] = workers;
    roomA.remove();
    const b = attached("let b1;");
    const doneB = hl.highlightCodeBlocks(b.root);

    await worker.answer();
    expect(worker.last.text).toBe("let b1;");
    await worker.answer();
    await doneB;
    expect(highlighted(b.code)).toBe(true);

    // Out of the document isn't unwanted — the timeline keeps an inline
    // thread panel detached and puts it back as it was — so it still runs,
    // once nothing in the document is waiting.
    expect(worker.last.text).toBe("let a2;");
    await worker.answer();
    await doneA;
    expect([...roomA.querySelectorAll("code")].map(highlighted)).toEqual([true, true]);
  });

  // The search for a block in the document is bounded, so a backlog left
  // behind in another room costs each take a fixed amount, not the backlog.
  it("looks only so far past a backlog for a block in the document", async () => {
    const backlog = attachedBody(Array.from({ length: 70 }, (_, i) => `let a${i};`), "language-js");
    void hl.highlightCodeBlocks(backlog.firstElementChild as HTMLElement); // one in flight
    for (const pre of Array.from(backlog.children).slice(1)) void hl.highlightCodeBlocks(pre);
    const [worker] = workers;
    backlog.remove();
    const near = attached("let b;");
    void hl.highlightCodeBlocks(near.root);

    await worker.answer();
    // 69 thrown-away jobs ahead is more than the queue looks through: the
    // oldest goes next, not the block in the document.
    expect(worker.last.text).toBe("let a1;");
  });

  it("highlights at most MAX_BLOCKS_PER_BODY blocks in one body", async () => {
    const texts = Array.from({ length: hl.MAX_BLOCKS_PER_BODY + 6 }, (_, i) => `let x${i};`);
    const body = attachedBody(texts, "language-js");
    const done = hl.highlightCodeBlocks(body);
    const [worker] = workers;
    for (let i = 0; i < hl.MAX_BLOCKS_PER_BODY; i++) await worker.answer();
    await done;

    expect(worker.posted).toHaveLength(hl.MAX_BLOCKS_PER_BODY);
    const flags = [...body.querySelectorAll("code")].map(highlighted);
    expect(flags.slice(0, hl.MAX_BLOCKS_PER_BODY).every(Boolean)).toBe(true);
    expect(flags.slice(hl.MAX_BLOCKS_PER_BODY).some(Boolean)).toBe(false);
  });

  it("drops a queued job no block wants any more, without remembering it", async () => {
    const first = attached("let x;");
    const edited = attached("let y;");
    const done = Promise.all([hl.highlightCodeBlocks(first.root), hl.highlightCodeBlocks(edited.root)]);
    const [worker] = workers;

    edited.code.textContent = "let z;"; // edited before its turn came
    await worker.answer();
    await done;
    expect(worker.posted.map((r) => r.text)).toEqual(["let x;"]);

    // A block that wants the old text again gets it asked for.
    void hl.highlightCodeBlocks(attached("let y;").root);
    expect(worker.last.text).toBe("let y;");
  });

  it("still runs a block whose body went into text-select mode, for the cache", async () => {
    // Text-select leaves without re-rendering, so the block stays plain until
    // the next render — which should find the result waiting.
    const first = attached("let x;");
    const selecting = attached("let y;");
    const done = Promise.all([hl.highlightCodeBlocks(first.root), hl.highlightCodeBlocks(selecting.root)]);
    const [worker] = workers;

    selecting.root.setAttribute("contenteditable", "true");
    await worker.answer();
    expect(worker.last.text).toBe("let y;");
    await worker.answer();
    await done;
    expect(highlighted(selecting.code)).toBe(false);

    const rerendered = attached("let y;");
    void hl.highlightCodeBlocks(rerendered.root);
    expect(highlighted(rerendered.code)).toBe(true);
  });

  it("puts a body's other blocks behind everyone else's once one of them times out", async () => {
    // One event, three hostile blocks: without this, a block rendered after
    // them would wait out all three deadlines.
    const hostile = attachedBody(["$".repeat(5000), "$".repeat(5001), "$".repeat(5002)], "language-java");
    void hl.highlightCodeBlocks(hostile);
    const other = attached("int ok = 1;", "language-java");
    const done = hl.highlightCodeBlocks(other.root);
    const [first] = workers;

    first.reply({ id: first.last.id, started: true });
    vi.advanceTimersByTime(hl.JOB_TIMEOUT_MS);

    const [, second] = workers;
    expect(second.posted.map((r) => r.text)).toEqual(["int ok = 1;"]);
    await second.answer();
    await done;
    expect(highlighted(other.code)).toBe(true);
    // The hostile body's next block comes after.
    expect(second.last.text).toBe("$".repeat(5001));
  });
});

describe("falling back to the in-thread engine", () => {
  /** Ways a worker turns out to be unusable, each given the first worker. */
  const failures: [string, (worker: FakeWorker) => void][] = [
    ["fires error", (w) => w.fail()],
    ["fires messageerror", (w) => w.onmessageerror?.(new MessageEvent("messageerror"))],
    ["can't load the highlight.js core", (w) => w.reply({ id: w.last.id, error: "core" })],
    ["doesn't load its grammar within LOAD_TIMEOUT_MS", () => vi.advanceTimersByTime(hl.LOAD_TIMEOUT_MS)],
  ];

  it.each(failures)("when the worker %s, re-running the jobs it had", async (_label, breakIt) => {
    const inFlight = codeBlock("let a = 1;", "language-js");
    const queued = codeBlock("let b = 2;", "language-js");
    const done = Promise.all([hl.highlightCodeBlocks(inFlight.root), hl.highlightCodeBlocks(queued.root)]);
    const [worker] = workers;

    breakIt(worker);
    expect(worker.terminated).toBe(true);
    await done;

    expect(highlighted(inFlight.code)).toBe(true);
    expect(highlighted(queued.code)).toBe(true);

    // For the rest of the session: no new worker, and the in-thread engine's
    // synchronous path once its grammar is loaded.
    const later = codeBlock("let c = 3;", "language-js");
    void hl.highlightCodeBlocks(later.root);
    expect(highlighted(later.code)).toBe(true);
    expect(workers).toHaveLength(1);
  });

  it.each([
    [
      "`new Worker` throws",
      class {
        constructor() {
          throw new Error("no workers here");
        }
      },
    ],
    [
      "posting to the worker throws",
      class extends FakeWorker {
        override postMessage(): void {
          throw new Error("can't post");
        }
      },
    ],
  ])("when %s", async (_label, BrokenWorker) => {
    vi.stubGlobal("Worker", BrokenWorker);
    const { root, code } = codeBlock("let x = 1;", "language-js");

    await hl.highlightCodeBlocks(root);

    expect(highlighted(code)).toBe(true);
  });

  it("re-running the jobs it had one budget per task, not all at once", async () => {
    // Real timers: what's under test is which task each block lands in.
    vi.useRealTimers();
    // Each highlight takes the whole budget, as far as the engine can tell;
    // calls are grouped by the task they ran in (see code_highlight.test.ts).
    const perTask: number[] = [];
    let open = false;
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const highlight = hljs.highlight.bind(hljs);
    vi.spyOn(hljs, "highlight").mockImplementation(((code: string, options: HighlightOptions) => {
      if (!open) {
        open = true;
        perTask.push(0);
        setTimeout(() => (open = false), 0);
      }
      perTask[perTask.length - 1]++;
      clock += hl.FALLBACK_TASK_BUDGET_MS;
      return highlight(code, options);
    }) as HLJSApi["highlight"]);
    const root = document.createElement("div");
    root.innerHTML = Array.from({ length: 6 }, (_, i) => `<pre><code class="language-js">let v${i};</code></pre>`).join("");
    const done = hl.highlightCodeBlocks(root);

    workers[0].fail();
    await done;

    expect([...root.querySelectorAll("code")].every(highlighted)).toBe(true);
    expect(perTask).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("holding the jobs it re-runs to the fallback's limits", async () => {
    // Past FALLBACK_MAX_CHARS: fine for the worker, too long for the main thread.
    const long = "let a = 1;\n".repeat(500);
    expect(long.length).toBeGreaterThan(hl.FALLBACK_MAX_CHARS);
    const { root, code } = codeBlock(long, "language-js");
    const done = hl.highlightCodeBlocks(root);
    const highlight = vi.spyOn(hljs, "highlight");

    workers[0].fail();
    await done;

    expect(highlighted(code)).toBe(false);
    expect(highlight).not.toHaveBeenCalled();
  });
});
