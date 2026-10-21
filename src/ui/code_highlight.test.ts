import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HighlightOptions, HighlightResult, HLJSApi, LanguageFn } from "highlight.js";

// jsdom has no Worker, so everything here runs on the in-thread fallback
// engine — which runs the worker's own request handler, so what these tests
// say about highlighting holds for both. The worker engine's queue, deadline
// and hand-over are in code_highlight.engine.test.ts.
//
// Every test gets a fresh module (empty cache, no grammar loaded) and a
// highlight.js core with nothing registered, so "loaded" and "cached" only ever
// mean what the test itself did — the synchronous paths are the point of
// several tests below, and a grammar left over from an earlier one would pass
// them for the wrong reason.
type Highlighter = typeof import("./code_highlight.js");
type Grammars = typeof import("./code_highlight_grammars.js");
let hl: Highlighter;
let grammars: Grammars;
let hljs: HLJSApi;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  hljs = (await import("highlight.js/lib/core")).default;
  for (const name of hljs.listLanguages()) hljs.unregisterLanguage(name);
  hl = await import("./code_highlight.js");
  grammars = await import("./code_highlight_grammars.js");
});

/**
 * `length` characters of ordinary code: short lines, no run of anything
 * longer than a word, so only the length can stand in the fallback's way.
 */
function codeOfLength(length: number): string {
  return "let a = 1;\n".repeat(Math.ceil(length / 11)).slice(0, length);
}

/** A detached `<div><pre><code>` holding `text`, as a rendered body would. */
function codeBlock(text: string, className?: string): { root: HTMLElement; code: HTMLElement } {
  const root = document.createElement("div");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  if (className !== undefined) code.setAttribute("class", className);
  code.textContent = text;
  pre.appendChild(code);
  root.appendChild(pre);
  return { root, code };
}

/** Let every promise continuation already queued run — no task ends meanwhile. */
async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function fromHtml(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const NIX = `inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # a comment
  };`;

describe("highlightCodeBlocks", () => {
  it("highlights a nix block into token spans without changing its text", async () => {
    const { root, code } = codeBlock(NIX, "language-nix");

    await hl.highlightCodeBlocks(root);

    expect(code.classList.contains("hljs")).toBe(true);
    expect([...code.querySelectorAll(".hljs-attr")].map((n) => n.textContent)).toEqual(["inputs", "nixpkgs.url"]);
    expect(code.querySelector(".hljs-comment")?.textContent).toBe("# a comment");
    expect(code.querySelector(".hljs-string")?.textContent).toBe('"github:NixOS/nixpkgs/nixos-unstable"');
    expect(code.textContent).toBe(NIX);
    // Nothing but spans: the stylesheet colours classes, and nothing else may
    // appear inside a block.
    expect(code.querySelectorAll(":not(span)")).toHaveLength(0);
  });

  it("colours a nix attribute name whole at the start of a line", async () => {
    // highlight.js 11.12.0's own rule split these as a plain `i` + `nputs`
    // (see fixNixAttrs): the first line, a line after a comment, and one
    // inside `${…}`, which shares the rule. `==` is not a binding.
    const text = 'inputs = { };\n# c\noutputs = { self }: "${ { b = 2; }.b }";\na == b;';
    const { root, code } = codeBlock(text, "language-nix");

    await hl.highlightCodeBlocks(root);

    expect([...code.querySelectorAll(".hljs-attr")].map((n) => n.textContent)).toEqual(["inputs", "outputs", "b"]);
    expect(code.textContent).toBe(text);
  });

  it("keeps the trailing newline Element puts before </code>", async () => {
    const { root, code } = codeBlock(`${NIX}\n`, "language-nix");

    await hl.highlightCodeBlocks(root);

    expect(code.classList.contains("hljs")).toBe(true);
    expect(code.textContent).toBe(`${NIX}\n`);
  });

  it("highlights a body that was never attached to the document", async () => {
    // renderFormattedBody often runs on a detached element that is inserted
    // later; requiring isConnected would leave those plain forever.
    const { root, code } = codeBlock("let x = 1;", "language-js");
    expect(root.isConnected).toBe(false);

    await hl.highlightCodeBlocks(root);

    expect(code.classList.contains("hljs")).toBe(true);
  });

  it("highlights a block named by an alias with the grammar behind it", async () => {
    const { root, code } = codeBlock('if [ -z "$X" ]; then echo hi; fi', "language-sh");

    await hl.highlightCodeBlocks(root);

    expect(code.querySelector(".hljs-keyword")?.textContent).toBe("if");
    expect(code.querySelector(".hljs-built_in")?.textContent).toBe("echo");
  });

  it("highlights every block in the body", async () => {
    const root = fromHtml(
      '<pre><code class="language-js">let a = 1;</code></pre><p>and</p><pre><code class="language-js">let b = 2;</code></pre>',
    );

    await hl.highlightCodeBlocks(root);

    expect(root.querySelectorAll("code.hljs")).toHaveLength(2);
  });

  it("lets the first language class decide", async () => {
    const { root, code } = codeBlock("let x = 1;", "language-js language-zig");

    await hl.highlightCodeBlocks(root);

    expect(code.classList.contains("hljs")).toBe(true);
  });

  describe("leaves the block untouched", () => {
    // Serialised HTML covers it all: no token spans, no added `hljs` class.
    async function expectUntouched(root: HTMLElement): Promise<void> {
      const before = root.innerHTML;
      await expect(hl.highlightCodeBlocks(root)).resolves.toBeUndefined();
      expect(root.innerHTML).toBe(before);
    }

    it("for a language Quark ships no grammar for", async () => {
      await expectUntouched(codeBlock('const std = @import("std");', "language-zig").root);
    });

    it("for a block with no language class (no auto-detection)", async () => {
      await expectUntouched(codeBlock("let x = 1;").root);
      await expectUntouched(codeBlock("let x = 1;", "some-other-class").root);
    });

    it.each([
      ["an empty name", "language-"],
      ["a quote", 'language-js"onload'],
      ["angle brackets", "language-<b>"],
      ["a slash", "language-js/x"],
      ["a semicolon", "language-js;"],
      ["a prefix that isn't language-", "xlanguage-js"],
      ["a malformed first language class", "language-<b> language-js"],
    ])("for a class with %s", async (_label, className) => {
      await expectUntouched(codeBlock("let x = 1;", className).root);
    });

    it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "prototype"])(
      "for the prototype key %s, without throwing",
      async (key) => {
        expect(hl.resolveGrammar(key)).toBeUndefined();
        await expectUntouched(codeBlock("x", `language-${key}`).root);
      },
    );

    it("when the code holds a link, an emoji or a coloured span", async () => {
      // Other clients put these inside code; recolouring would mean rebuilding
      // the block from its text and dropping them.
      await expectUntouched(fromHtml(
        '<pre><code class="language-js">open(<a href="https://example.org">url</a>)</code></pre>',
      ));
      await expectUntouched(fromHtml(
        '<pre><code class="language-js">let x = <img data-mx-emoticon="" data-mxc="mxc://a/b" alt=":x:">;</code></pre>',
      ));
      await expectUntouched(fromHtml(
        '<pre><code class="language-js">let <span data-mx-color="#ff0000">x</span> = 1;</code></pre>',
      ));
    });

    it("for inline code, and code that isn't a direct child of <pre>", async () => {
      await expectUntouched(fromHtml('<p>run <code class="language-js">let x = 1</code> first</p>'));
      await expectUntouched(fromHtml('<pre><span><code class="language-js">let x = 1</code></span></pre>'));
    });

    it("for a block that is already highlighted", async () => {
      await expectUntouched(codeBlock("let x = 1;", "language-js hljs").root);
    });

    it("for an empty block", async () => {
      await expectUntouched(codeBlock("", "language-js").root);
    });

    it("for a block over MAX_HIGHLIGHT_CHARS", async () => {
      await expectUntouched(codeBlock(codeOfLength(hl.MAX_HIGHLIGHT_CHARS + 1), "language-js").root);
    });

    it("for a block over FALLBACK_MAX_CHARS, on the in-thread engine", async () => {
      // Nothing interrupts highlight.js on the main thread, so the fallback
      // keeps to a quarter of Element's limit; the worker's is MAX_HIGHLIGHT_CHARS.
      const highlight = vi.spyOn(hljs, "highlight");
      await expectUntouched(codeBlock(codeOfLength(hl.FALLBACK_MAX_CHARS + 1), "language-js").root);
      expect(highlight).not.toHaveBeenCalled();
    });

    it.each([
      // The floods the run limit is for (java over `$`s: 122 ms at 4096).
      ["non-whitespace", (max: number) => "$".repeat(max + 1)],
      ["spaces", (max: number) => `a${" ".repeat(max + 1)}b`],
      ["newlines", (max: number) => `a${"\n".repeat(max + 1)}b`],
      ["mixed whitespace", (max: number) => `a${" \t\n".repeat(max)}b`],
    ])("for a run of %s longer than FALLBACK_MAX_RUN, on the in-thread engine", async (_label, text) => {
      const highlight = vi.spyOn(hljs, "highlight");
      await expectUntouched(codeBlock(text(hl.FALLBACK_MAX_RUN), "language-java").root);
      expect(highlight).not.toHaveBeenCalled();
    });

    it.each([
      // Worse than quadratic within the run limit, so Element's 4096 would
      // let them through: 828, 251 and 138 ms on the main thread at that size.
      ["csharp", "language-cs", "a<b> "],
      ["shell-session", "language-console", "\n%${"],
      ["markdown", "language-md", " [::]("],
    ])("for %s text built to be slow, at Element's 4096, on the in-thread engine", async (_label, className, unit) => {
      const text = unit.repeat(Math.ceil(4096 / unit.length)).slice(0, 4096);
      const highlight = vi.spyOn(hljs, "highlight");
      await expectUntouched(codeBlock(text, className).root);
      expect(highlight).not.toHaveBeenCalled();
    });

    it("for a run longer than FALLBACK_MAX_RUN once the grammar is loaded, too", async () => {
      // The synchronous path is held to the same limits as the async one.
      await hl.highlightCodeBlocks(codeBlock("int x;", "language-java").root);
      const highlight = vi.spyOn(hljs, "highlight");
      await expectUntouched(codeBlock("$".repeat(hl.FALLBACK_MAX_RUN + 1), "language-java").root);
      expect(highlight).not.toHaveBeenCalled();
    });

    it("when highlight.js throws", async () => {
      vi.spyOn(hljs, "highlight").mockImplementation(() => {
        throw new Error("grammar blew up");
      });
      await expectUntouched(codeBlock("let x = 1;", "language-js").root);
    });

    it("when highlight.js returns anything but spans over the same text", async () => {
      // highlight.js escapes its input, so this can't happen today; the check
      // is what keeps a block from ever growing an element if that changes.
      const result = (value: string) => ({ value, relevance: 0, illegal: false }) as HighlightResult;
      const spy = vi.spyOn(hljs, "highlight");
      spy.mockReturnValueOnce(result('<img src="x">let x = 1;'));
      await expectUntouched(codeBlock("let x = 1;", "language-js").root);
      spy.mockReturnValueOnce(result('<span class="hljs-keyword">let</span> y = 2;'));
      await expectUntouched(codeBlock("let x = 1;", "language-js").root);
    });

    it.each([
      ["an event handler", '<span class="hljs-keyword" onclick="alert(1)">let</span> x = 1;'],
      ["a style", '<span style="color: red">let</span> x = 1;'],
      ["a Matrix attribute", '<span data-mx-spoiler="">let</span> x = 1;'],
      ["a class that isn't a token's", '<span class="message__spoiler">let</span> x = 1;'],
      ["a token class beside one that isn't", '<span class="hljs-keyword message__link">let</span> x = 1;'],
    ])("when highlight.js returns a span with %s", async (_label, value) => {
      // Spans alone aren't enough: one that carries anything but token classes
      // could restyle or re-role a stretch of the sender's text.
      vi.spyOn(hljs, "highlight").mockReturnValue({ value, relevance: 0, illegal: false } as HighlightResult);
      await expectUntouched(codeBlock("let x = 1;", "language-js").root);
    });

    it("when the HTML runs past MAX_HIGHLIGHT_HTML_CHARS, and doesn't ask again", async () => {
      // Valid token spans, just too many of them to check and apply on the
      // main thread; the same text would only come back the same size.
      const text = "x";
      const value = `<span class="hljs-keyword">${text}</span>${"<span></span>".repeat(hl.MAX_HIGHLIGHT_HTML_CHARS / 13)}`;
      expect(value.length).toBeGreaterThan(hl.MAX_HIGHLIGHT_HTML_CHARS);
      const highlight = vi.spyOn(hljs, "highlight").mockReturnValue({ value, relevance: 0, illegal: false } as HighlightResult);

      await expectUntouched(codeBlock(text, "language-js").root);
      await expectUntouched(codeBlock(text, "language-js").root);

      expect(highlight).toHaveBeenCalledTimes(1);
    });
  });

  it("highlights a block of exactly FALLBACK_MAX_CHARS, on the in-thread engine", async () => {
    const { root, code } = codeBlock(codeOfLength(hl.FALLBACK_MAX_CHARS), "language-js");

    await hl.highlightCodeBlocks(root);

    expect(code.classList.contains("hljs")).toBe(true);
  });

  it("highlights runs of exactly FALLBACK_MAX_RUN, on the in-thread engine", async () => {
    const text = `${"x".repeat(hl.FALLBACK_MAX_RUN)}${" ".repeat(hl.FALLBACK_MAX_RUN)}y`;
    const { root, code } = codeBlock(text, "language-js");

    await hl.highlightCodeBlocks(root);

    expect(code.classList.contains("hljs")).toBe(true);
    expect(code.textContent).toBe(text);
  });

  it("accepts every class highlight.js writes: tiered scopes and embedded grammars", async () => {
    // `hljs-title function_` and `language-javascript`, which the check has to
    // let through or a JS function or an HTML <script> would stay plain.
    const { root, code } = codeBlock("<script>function f() {}</script>", "language-html");

    await hl.highlightCodeBlocks(root);

    expect(code.querySelector(".hljs-title.function_")?.textContent).toBe("f");
    expect(code.querySelector(".language-javascript")).not.toBeNull();
  });

  it.each([
    ["html", "language-html"],
    ["javascript", "language-js"],
  ])("keeps a hostile payload inert text (%s)", async (_label, className) => {
    const payload = "</code><img src=x onerror=alert(1)><script>alert(2)</script>";
    const { root, code } = codeBlock(payload, className);

    await hl.highlightCodeBlocks(root);

    expect(code.classList.contains("hljs")).toBe(true);
    expect(root.querySelector("img, script")).toBeNull();
    expect(code.querySelectorAll(":not(span)")).toHaveLength(0);
    expect(code.textContent).toBe(payload);
  });

  it("loads a grammar's sub-languages with it", async () => {
    // xml hands <script> to javascript and <style> to css; without them those
    // stretches would come out as plain text.
    const { root, code } = codeBlock(
      "<p>x</p><script>const a = 1;</script><style>p { color: red }</style>",
      "language-html",
    );

    await hl.highlightCodeBlocks(root);

    expect(code.querySelector(".language-javascript .hljs-keyword")?.textContent).toBe("const");
    expect(code.querySelector(".language-css .hljs-attribute")?.textContent).toBe("color");
    // javascript's own sub-languages come too, transitively.
    expect(hljs.listLanguages()).toEqual(expect.arrayContaining(["xml", "javascript", "css", "graphql"]));
  });

  it("tries a grammar chunk again after it failed to load", async () => {
    // A failed fetch (offline, a stale chunk after an update) must not be
    // remembered, or that language would stay plain until a restart. The swap
    // needs no undo: beforeEach imports a fresh module, and with it a fresh Map.
    const loaders = grammars.GRAMMAR_LOADERS as Map<string, () => Promise<{ default: LanguageFn }>>;
    const load = loaders.get("rust")!;
    let calls = 0;
    loaders.set("rust", () => (++calls === 1 ? Promise.reject(new Error("chunk failed")) : load()));

    const first = codeBlock("fn main() {}", "language-rust");
    await expect(hl.highlightCodeBlocks(first.root)).resolves.toBeUndefined();
    expect(first.code.classList.contains("hljs")).toBe(false);

    const second = codeBlock("fn main() {}", "language-rust");
    await hl.highlightCodeBlocks(second.root);
    expect(second.code.classList.contains("hljs")).toBe(true);
    expect(calls).toBe(2);
  });

  describe("synchronous paths", () => {
    it("is asynchronous the first time a grammar is needed", async () => {
      const { root, code } = codeBlock("let x = 1;", "language-js");

      const done = hl.highlightCodeBlocks(root);
      expect(code.classList.contains("hljs")).toBe(false);
      await done;
      expect(code.classList.contains("hljs")).toBe(true);
    });

    it("applies a cached result before returning, without re-highlighting", async () => {
      await hl.highlightCodeBlocks(codeBlock(NIX, "language-nix").root);
      const highlight = vi.spyOn(hljs, "highlight");

      // A rebuilt body: same content, brand-new element.
      const { root, code } = codeBlock(NIX, "language-nix");
      void hl.highlightCodeBlocks(root);

      expect(code.classList.contains("hljs")).toBe(true);
      expect(code.querySelector(".hljs-comment")?.textContent).toBe("# a comment");
      expect(highlight).not.toHaveBeenCalled();
    });

    it("highlights new text before returning once the grammar is loaded (in-thread only)", async () => {
      // The worker engine has no such path: only a cache hit is synchronous there.
      await hl.highlightCodeBlocks(codeBlock(NIX, "language-nix").root);
      const highlight = vi.spyOn(hljs, "highlight");

      const { root, code } = codeBlock("{ x = 1; }", "language-nixos");
      void hl.highlightCodeBlocks(root);

      expect(code.classList.contains("hljs")).toBe(true);
      expect(highlight).toHaveBeenCalledTimes(1);
    });
  });

  describe("the in-thread engine's budget per task", () => {
    /**
     * Make every highlight.js call take `ms` of main-thread time, as far as the
     * engine can tell — performance.now is a clock only highlight moves — and
     * count the calls made in each task. A task's group opens on its first
     * call and closes on a timer set right then, which runs before any timer
     * the engine sets after the call, so calls in different tasks never share
     * a group.
     */
    function eachHighlightTakes(ms: number): number[] {
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
        clock += ms;
        return highlight(code, options);
      }) as HLJSApi["highlight"]);
      return perTask;
    }

    /** A body of `count` distinct js blocks, as one event might carry. */
    function body(count: number): { root: HTMLElement; codes: HTMLElement[] } {
      const root = fromHtml(
        Array.from({ length: count }, (_, i) => `<pre><code class="language-js">let v${i} = ${i};</code></pre>`).join(""),
      );
      return { root, codes: [...root.querySelectorAll<HTMLElement>("code")] };
    }

    const lit = (codes: HTMLElement[]): number => codes.filter((c) => c.classList.contains("hljs")).length;

    async function loadJs(): Promise<void> {
      await hl.highlightCodeBlocks(codeBlock("let x = 1;", "language-js").root);
      await new Promise((resolve) => setTimeout(resolve, 0)); // and let its task end
    }

    it("stops highlighting during the render once the task has spent FALLBACK_TASK_BUDGET_MS", async () => {
      await loadJs();
      // Under the budget after one block, at it after two: the third waits.
      const perTask = eachHighlightTakes(hl.FALLBACK_TASK_BUDGET_MS / 2);
      const { root, codes } = body(4);

      const done = hl.highlightCodeBlocks(root);
      expect(lit(codes)).toBe(2);
      // Not merely deferred to a microtask: to a later task.
      await settleMicrotasks();
      expect(lit(codes)).toBe(2);

      await done;
      expect(lit(codes)).toBe(4);
      expect(perTask).toEqual([2, 2]);
    });

    it("highlights one block per task when each one takes the whole budget", async () => {
      // Sixteen blocks inside every per-block limit, each as slow as the
      // budget: back to back they would hold the main thread for all sixteen.
      await loadJs();
      const perTask = eachHighlightTakes(hl.FALLBACK_TASK_BUDGET_MS);
      const { root, codes } = body(16);

      const done = hl.highlightCodeBlocks(root);
      expect(lit(codes)).toBe(1); // a fresh budget always has room for one

      await done;
      expect(lit(codes)).toBe(16);
      expect(perTask).toEqual(Array(16).fill(1));
    });

    it("holds the blocks waiting on a grammar's first load to it too", async () => {
      // Nothing is synchronous before the chunk arrives, so every block
      // queues — and they mustn't all run in the task it arrives in.
      const perTask = eachHighlightTakes(hl.FALLBACK_TASK_BUDGET_MS);
      const { root, codes } = body(3);

      await hl.highlightCodeBlocks(root);

      expect(lit(codes)).toBe(3);
      expect(perTask).toEqual([1, 1, 1]);
    });
  });

  describe("when the block changes before its grammar loads", () => {
    it("doesn't overwrite text that changed", async () => {
      const { root, code } = codeBlock("let x = 1;", "language-js");

      const done = hl.highlightCodeBlocks(root);
      code.textContent = "let y = 2;";
      await done;

      expect(code.classList.contains("hljs")).toBe(false);
      expect(code.textContent).toBe("let y = 2;");
    });

    it("doesn't overwrite a block whose language changed", async () => {
      const { root, code } = codeBlock("let x = 1;", "language-js");

      const done = hl.highlightCodeBlocks(root);
      code.className = "language-zig";
      await done;

      expect(code.classList.contains("hljs")).toBe(false);
    });

    it("doesn't touch a body that entered text-select mode", async () => {
      // Text-select makes the body contenteditable and parks a caret in its
      // text nodes; swapping them out would throw the caret away.
      const { root, code } = codeBlock("let x = 1;", "language-js");

      const done = hl.highlightCodeBlocks(root);
      root.setAttribute("contenteditable", "true");
      await done;

      expect(code.classList.contains("hljs")).toBe(false);
      expect(code.childNodes).toHaveLength(1);
    });
  });
});

describe("resolveGrammar", () => {
  it.each([
    ["sh", "bash"],
    ["zsh", "bash"],
    ["js", "javascript"],
    ["ts", "typescript"],
    ["toml", "ini"],
    ["nixos", "nix"],
    ["yml", "yaml"],
    ["html", "xml"],
    ["svg", "xml"],
    ["rs", "rust"],
    ["py", "python"],
    // Case-insensitive, and the charset's punctuation is reachable.
    ["Rust", "rust"],
    ["NIX", "nix"],
    ["C#", "csharp"],
    ["c++", "cpp"],
    ["objective-c", "objectivec"],
    ["Objective-C", "objectivec"],
    ["F#", "fsharp"],
    ["cmake.in", "cmake"],
    // GitHub's meaning of ```shell (a script), not highlight.js's (a session).
    ["shell", "bash"],
    ["console", "shell"],
    // Fence names highlight.js doesn't declare.
    ["gradle", "groovy"],
    ["containerfile", "dockerfile"],
    ["asm", "x86asm"],
    ["vimscript", "vim"],
    ["wat", "wasm"],
  ])("%s → %s", (token, grammar) => {
    expect(hl.resolveGrammar(token)).toBe(grammar);
  });

  it("knows nothing outside the curated set", () => {
    expect(hl.resolveGrammar("zig")).toBeUndefined();
    expect(hl.resolveGrammar("brainfuck")).toBeUndefined();
    expect(hl.resolveGrammar("")).toBeUndefined();
  });
});

describe("grammar tables", () => {
  /**
   * Grammar names the alias table deliberately sends elsewhere: `shell` is
   * highlight.js's shell-*session* grammar, but a ```shell fence means a script.
   */
  const REMAPPED_NAMES = new Map([["shell", "bash"]]);

  /**
   * Sub-languages a grammar embeds that deliberately don't load with it — see
   * GRAMMAR_DEPENDENCIES for why.
   */
  const OMITTED_DEPENDENCIES = new Map([
    ["nix", ["markdown"]],
    ["perl", ["mojolicious"]],
  ]);

  /** Every `subLanguage` named anywhere in a raw grammar definition. */
  function subLanguagesOf(definition: unknown): string[] {
    const found = new Set<string>();
    const seen = new Set<object>();
    const visit = (node: unknown): void => {
      if (typeof node !== "object" || node === null || node instanceof RegExp || seen.has(node)) return;
      seen.add(node);
      const sub = (node as { subLanguage?: unknown }).subLanguage;
      for (const name of [sub].flat()) if (typeof name === "string") found.add(name);
      for (const value of Object.values(node)) visit(value);
    };
    visit(definition);
    return [...found].sort();
  }

  it("loads a grammar for every key, and carries every alias it declares", async () => {
    for (const [name, load] of grammars.GRAMMAR_LOADERS) {
      const language = (await load()).default;
      expect(typeof language, name).toBe("function");
      const definition = language(hljs);
      expect(hl.resolveGrammar(name), name).toBe(REMAPPED_NAMES.get(name) ?? name);
      for (const alias of definition.aliases ?? []) {
        expect(hl.resolveGrammar(alias), `${name} alias ${alias}`).toBe(name);
      }
    }
  });

  it("declares exactly the sub-languages each grammar embeds", async () => {
    for (const [name, load] of grammars.GRAMMAR_LOADERS) {
      const omitted = OMITTED_DEPENDENCIES.get(name) ?? [];
      const embedded = subLanguagesOf((await load()).default(hljs)).filter((s) => !omitted.includes(s));
      expect([...(grammars.GRAMMAR_DEPENDENCIES.get(name) ?? [])].sort(), name).toEqual(embedded);
    }
  });

  it("only depends on grammars it can load", () => {
    for (const [name, deps] of grammars.GRAMMAR_DEPENDENCIES) {
      expect(grammars.GRAMMAR_LOADERS.has(name), name).toBe(true);
      for (const dep of deps) expect(grammars.GRAMMAR_LOADERS.has(dep), `${name} → ${dep}`).toBe(true);
    }
  });
});
