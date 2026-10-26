import { describe, it, expect, vi } from "vitest";
import { renderFormattedBody, renderMessageBody, renderPlainBody } from "./message_body.js";
import { MAX_BLOCKS_PER_BODY } from "./code_highlight.js";

// renderFormattedBody is the one path every surface renders formatted_body
// through — main timeline, threads, captions, edits, local echo — so what it
// does to a body here is what every surface shows.

function render(html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "message__body";
  renderFormattedBody(el, html);
  return el;
}

/** Wait for a block's grammar chunk to load and the late result to land. */
async function highlighted(code: Element | null): Promise<Element> {
  await vi.waitFor(() => expect(code?.classList.contains("hljs")).toBe(true));
  return code as Element;
}

describe("renderFormattedBody", () => {
  it("marks the element as rendered message HTML, keeping the caller's class", () => {
    const el = render("<b>hi</b>");

    expect(el.classList.contains("message-html")).toBe(true);
    expect(el.classList.contains("message__body")).toBe(true);
  });

  describe("whitespace around <pre>", () => {
    it("drops the newlines Element puts between a code block and its neighbours", () => {
      // Under `white-space: pre-wrap` each of these was a blank line.
      const el = render('<p>before</p>\n<pre><code class="language-zig">x</code></pre>\n<p>after</p>');

      const pre = el.querySelector("pre")!;
      expect(pre.previousSibling).toBe(el.querySelector("p"));
      expect(pre.nextSibling).toBe(el.querySelectorAll("p")[1]);
    });

    it("drops trailing whitespace after a final block", () => {
      const el = render('<pre><code>x</code></pre>\n');

      expect(el.lastChild?.nodeName).toBe("PRE");
    });

    it("keeps whitespace that isn't next to a <pre>", () => {
      const el = render("<p>a</p>\n<p>b</p><b>c</b> <i>d</i>");

      expect(el.textContent).toBe("a\nbc d");
    });

    it("keeps text next to a <pre> that isn't only whitespace", () => {
      const el = render("look:\n<pre><code>x</code></pre>  ");

      expect(el.firstChild?.textContent).toBe("look:\n");
      // A no-break space is content, not formatting whitespace.
      expect(el.lastChild?.textContent).toBe("  ");
    });

    it("leaves the code's own text alone, trailing newline included", () => {
      const el = render("<pre><code>  indented\n\n</code></pre>");

      expect(el.querySelector("code")?.textContent).toBe("  indented\n\n");
    });
  });

  it("highlights the code block in Element-shaped HTML", async () => {
    const el = render(
      '<p>pinning nixpkgs in the flake:</p>\n<pre><code class="language-nix">inputs = {\n' +
        "    nixpkgs.url = &quot;github:NixOS/nixpkgs/nixos-unstable&quot;;\n" +
        "    # a comment\n  };\n</code></pre>\n",
    );

    const code = await highlighted(el.querySelector("pre > code"));

    expect(code.querySelector(".hljs-comment")?.textContent).toBe("# a comment");
    expect(code.textContent).toBe(
      'inputs = {\n    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";\n    # a comment\n  };\n',
    );
  });

  it("highlights a re-render of the same block before returning", async () => {
    const html = '<pre><code class="language-rust">fn main() {}</code></pre>';
    await highlighted(render(html).querySelector("code"));

    // A rebuilt body (room re-open, cull, jump) must not flash plain text.
    expect(render(html).querySelector("code")?.classList.contains("hljs")).toBe(true);
  });

  it("never highlights inline code", async () => {
    const el = render('run <code class="language-js">let x = 1</code>, then <pre><code class="language-js">let y</code></pre>');

    await highlighted(el.querySelector("pre > code"));

    const inline = el.querySelector(":scope > code")!;
    expect(inline.classList.contains("hljs")).toBe(false);
    expect(inline.childNodes).toHaveLength(1);
  });

  describe("the existing steps still run", () => {
    it("stashes a custom emoji's mxc:// src", () => {
      const el = render('hi <img data-mx-emoticon src="mxc://example.org/abc" alt=":blob:">');

      const img = el.querySelector("img")!;
      expect(img.dataset.mxc).toBe("mxc://example.org/abc");
      expect(img.hasAttribute("src")).toBe(false);
    });

    it("decorates links and strips non-http hrefs", () => {
      const el = render('<a href="https://example.org">ok</a> <a href="javascript:alert(1)">bad</a>');

      const [ok, bad] = el.querySelectorAll("a");
      expect(ok.classList.contains("message__link")).toBe(true);
      expect(bad.hasAttribute("href")).toBe(false);
    });

    it("wires spoilers", () => {
      const el = render('<span data-mx-spoiler="plot">secret</span>');

      expect(el.querySelector("[data-mx-spoiler]")?.classList.contains("message__spoiler")).toBe(true);
    });

    it("runs inside a code block too, and leaves that block unhighlighted", async () => {
      // A link or emoji inside code outranks token colours: the block stays as
      // the sender built it, with the link decorated and the emoji stashed.
      const el = render(
        '<pre><code class="language-js">open(<a href="https://example.org">url</a>) ' +
          '<img data-mx-emoticon src="mxc://example.org/abc" alt=":blob:"></code></pre>' +
          '<pre><code class="language-js">let ok = 1;</code></pre>',
      );

      await highlighted(el.querySelectorAll("pre > code")[1]);

      const first = el.querySelector("pre > code")!;
      expect(first.classList.contains("hljs")).toBe(false);
      expect(first.querySelector("a")?.classList.contains("message__link")).toBe(true);
      expect(first.querySelector("img")?.dataset.mxc).toBe("mxc://example.org/abc");
    });
  });
});

// A message with no formatted_body: what Quark sent before fence support, and
// what bots and bridges send. Its fences are drawn as the same code blocks.
describe("renderPlainBody", () => {
  function plain(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "message__body";
    renderPlainBody(el, text);
    return el;
  }

  it("draws a fenced block as a highlighted code block between the prose", async () => {
    const el = plain("pinning nixpkgs:\n```nix\ninputs = { };\n```\nthoughts?");

    const code = el.querySelector("pre > code.language-nix");
    expect(code?.textContent).toBe("inputs = { };");
    expect(el.classList.contains("message-html")).toBe(true);
    expect(el.firstChild?.textContent).toBe("pinning nixpkgs:");
    expect(el.lastChild?.textContent).toBe("thoughts?");
    expect((await highlighted(code)).querySelector(".hljs-attr")?.textContent).toBe("inputs");
  });

  it("linkifies URLs in the prose but not in the code", () => {
    const el = plain("see https://example.org/a\n```\ncurl https://example.org/b\n```");

    expect([...el.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["https://example.org/a"]);
    expect(el.querySelector("code")?.textContent).toBe("curl https://example.org/b");
  });

  it("renders text with no fence exactly as before: linkified, no code styles", () => {
    const el = plain("just text https://example.org");

    expect(el.querySelector("pre")).toBeNull();
    expect(el.querySelector("a")?.textContent).toBe("https://example.org");
    expect(el.classList.contains("message-html")).toBe(false);
  });

  it("puts hostile code in as text, never markup", () => {
    const el = plain('```js\n</code><img src=x onerror="alert(1)">\n```');

    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("code")?.textContent).toBe('</code><img src=x onerror="alert(1)">');
  });

  // A CI log's `\r` progress line: kept raw, it came back from the highlighter
  // as different text once parsed, so it was never coloured.
  it("highlights code holding a lone CR", async () => {
    const el = plain("ci:\n```console\n$ nix build\ncopying 10%\rcopying 100%\n```");

    const code = await highlighted(el.querySelector("pre > code"));
    expect(code.textContent).toBe("$ nix build\ncopying 10%\ncopying 100%");
  });

  it(`leaves a body with more than MAX_BLOCKS_PER_BODY fences as text`, () => {
    const text = "```\nx\n```\n".repeat(MAX_BLOCKS_PER_BODY + 1).trimEnd();
    const el = plain(text);

    expect(el.querySelector("pre")).toBeNull();
    expect(el.textContent).toBe(text);
  });
});

describe("renderMessageBody", () => {
  it("renders the formatted body when there is one, else the plain body", () => {
    const el = document.createElement("div");

    renderMessageBody(el, "**hi**", "<strong>hi</strong>");
    expect(el.querySelector("strong")).not.toBeNull();

    renderMessageBody(el, "**hi**");
    expect(el.querySelector("strong")).toBeNull();
    expect(el.textContent).toBe("**hi**");
  });

  // An edit re-renders the same element: nothing of the old body may survive,
  // and an HTML body's code styles mustn't linger on plain text.
  it("replaces what the element held, class included", () => {
    const el = document.createElement("div");
    renderMessageBody(el, "", '<pre><code class="language-zig">old</code></pre>');

    renderMessageBody(el, "new text");

    expect(el.textContent).toBe("new text");
    expect(el.classList.contains("message-html")).toBe(false);
  });
});

// Quark before fence support ran its inline rules over code, so fenced code
// with `__x__`, `*`s, `||` or a backtick went out as HTML with the fence as
// text. These are that formatter's exact outputs (upstream/main's markdown.ts).
describe("renderMessageBody on HTML from a formatter without fences", () => {
  const LEGACY = {
    py: {
      body: "fixed it:\n```py\nclass A:\n    def __init__(self, *args, **kwargs):\n        pass\n```",
      html: "fixed it:<br>```py<br>class A:<br>    def <u>init</u>(self, <em>args, </em>*kwargs):<br>        pass<br>```",
    },
    sh: {
      body: "```sh\ntest -f a || exit 1\nmake || true\n```",
      html: "```sh<br>test -f a <span data-mx-spoiler> exit 1<br>make </span> true<br>```",
    },
    emoji: {
      body: "done :party:\n```js\nconst a = b * c * d;\n```",
      html: 'done <img data-mx-emoticon src="mxc://e/party" alt=":party:" title=":party:"><br>```js<br>const a = b <em> c </em> d;<br>```',
    },
  };

  function rendered(body: string, html: string): HTMLElement {
    const el = document.createElement("div");
    renderMessageBody(el, body, html);
    return el;
  }

  it("takes the code from the plain body, as typed", () => {
    const el = rendered(LEGACY.py.body, LEGACY.py.html);

    expect(el.querySelector("pre > code.language-py")?.textContent).toBe(
      "class A:\n    def __init__(self, *args, **kwargs):\n        pass",
    );
    expect(el.querySelector("u, em")).toBeNull();
    expect(el.textContent?.startsWith("fixed it:")).toBe(true);
  });

  it("undoes a spoiler the formatter made of `||`", () => {
    const el = rendered(LEGACY.sh.body, LEGACY.sh.html);

    expect(el.querySelector("[data-mx-spoiler]")).toBeNull();
    expect(el.querySelector("code")?.textContent).toBe("test -f a || exit 1\nmake || true");
  });

  it("keeps the message's custom emoji, from the original HTML", () => {
    const el = rendered(LEGACY.emoji.body, LEGACY.emoji.html);

    const img = el.querySelector("img[data-mx-emoticon]");
    expect(img?.getAttribute("alt")).toBe(":party:");
    expect(img?.getAttribute("data-mxc")).toBe("mxc://e/party");
    expect(el.querySelector("code")?.textContent).toBe("const a = b * c * d;");
  });

  it.each([
    ["HTML that already has a <pre>", "```js\nx\n```", '<pre><code class="language-js">x</code></pre>'],
    ["HTML that shows no fence", "```js\nx\n```", "<b>bold</b> x"],
    ["a body with no fence plain text means as code", "``` paste:\n*a* b", "``` paste:<br><em>a</em> b"],
    ["HTML whose fences don't match the body's", "```js\na\n```\n```py\nb\n```", "```js<br>a<br>```"],
    ["HTML that shows a fence across a block's edge", "```\nx\n```", "```<br><ul><li>x</li></ul>```"],
    ["HTML nested deeper than a message is", "```\nx\n```", `${"<b>".repeat(40)}\`\`\`<br>x<br>\`\`\`${"</b>".repeat(40)}`],
  ])("leaves %s as sent", (_label, body, html) => {
    const el = rendered(body, html);

    const sent = document.createElement("div");
    renderFormattedBody(sent, html);
    expect(el.innerHTML).toBe(sent.innerHTML);
  });

  // The quote stays: stripReplyFallback cut it from the body (Quark sends no
  // reply fallback), but only the fence changes, and it changes in the HTML.
  it("keeps everything around the fence as sent, a reply's own quote included", () => {
    const body = 'because of this:\n```py\nif __name__ == "__main__":\n    main(*sys.argv)\n```';
    const html = '<blockquote>why does it print twice?</blockquote>because of this:<br>```py<br>if <u>name</u> == "<u>main</u>":<br>    main(*sys.argv)<br>```';
    const el = rendered(body, html);

    expect(el.querySelector("blockquote")?.textContent).toBe("why does it print twice?");
    expect(el.querySelector("code")?.textContent).toBe('if __name__ == "__main__":\n    main(*sys.argv)');
    expect(el.querySelector("u")).toBeNull();
  });

  // `a || b` and `c || d` paired into one spoiler across the opening fence.
  it("lifts the block out of an inline element the fence sat inside", () => {
    const el = rendered("try a || b\n```sh\nc || d\n```\nok", "try a <span data-mx-spoiler> b<br>```sh<br>c </span> d<br>```<br>ok");

    const pre = el.querySelector("pre")!;
    expect(pre.parentElement).toBe(el);
    expect(pre.textContent).toBe("c || d");
    expect(el.querySelector("[data-mx-spoiler]")?.textContent).toBe(" b");
    expect(pre.nextSibling?.textContent).toBe("ok");
  });

  // The break between them is beside both; the first block mustn't take it
  // from under the second.
  it("repairs fences a line apart, each into its own block", () => {
    const el = rendered("```py\na = __b__\n```\n```sh\nc || d\n```", "```py<br>a = <u>b</u><br>```<br>```sh<br>c || d<br>```");

    expect([...el.childNodes].map((n) => n.nodeName)).toEqual(["PRE", "PRE"]);
    expect([...el.querySelectorAll("code")].map((c) => [c.className, c.textContent])).toEqual([
      ["language-py", "a = __b__"],
      ["language-sh", "c || d"],
    ]);
  });

  // The plain body reads `>` lines as text, so a fence in a quote is none;
  // in the HTML the same lines are a <blockquote>'s, read the same way.
  it.each([
    [
      "a quoted, unclosed fence",
      "> ```py\n> def f()\nyou need a colon:\n```py\ndef f():\n    pass\n```",
      "<blockquote>```py<br>def f()</blockquote>you need a colon:<br>```py<br>def f():<br>    pass<br>```",
    ],
    [
      "a quoted block",
      "> ```py\n> def f()\n> ```\n\nfixed:\n```py\ndef f():\n    pass\n```",
      "<blockquote>```py<br>def f()<br>```</blockquote>fixed:<br>```py<br>def f():<br>    pass<br>```",
    ],
  ])("leaves %s as sent and repairs the fence after it", (_label, body, html) => {
    const el = rendered(body, html);

    expect(el.querySelector("blockquote")?.outerHTML).toBe(html.slice(0, html.indexOf("</blockquote>") + "</blockquote>".length));
    expect([...el.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["def f():\n    pass"]);
    expect([...el.childNodes].map((n) => n.nodeName)).toEqual(["BLOCKQUOTE", "#text", "PRE"]);
  });

  it("splits a spoiler paired across two blocks, leaving the prose between", () => {
    const el = rendered(
      "```sh\na || b\n```\nthen\n```sh\nc || d\n```",
      "```sh<br>a <span data-mx-spoiler> b<br>```<br>then<br>```sh<br>c </span> d<br>```",
    );

    expect([...el.childNodes].map((n) => n.nodeName)).toEqual(["PRE", "SPAN", "PRE"]);
    expect(el.textContent).toBe("a || bthenc || d");
  });

  it("leaves no empty spoiler where a block took all of one", () => {
    const el = rendered("see ||\n```sh\nx || y\n```", "see <span data-mx-spoiler><br>```sh<br>x </span> y<br>```");

    expect(el.querySelector("[data-mx-spoiler]")).toBeNull();
    expect([...el.childNodes].map((n) => n.nodeName)).toEqual(["#text", "PRE"]);
    expect(el.querySelector("code")?.textContent).toBe("x || y");
  });

  // WebKit updates every live Range on every removal in the document until the
  // Range is collected: one per block made a crafted body take minutes there.
  it("makes no Range", () => {
    const createRange = vi.spyOn(document, "createRange");
    rendered(LEGACY.py.body, LEGACY.py.html);
    rendered("try a || b\n```sh\nc || d\n```\nok", "try a <span data-mx-spoiler> b<br>```sh<br>c </span> d<br>```<br>ok");

    expect(createRange).not.toHaveBeenCalled();
    createRange.mockRestore();
  });

  it("drops the line break and one blank line each side, as the composer does", () => {
    const el = rendered("see below\n\n```py\nx = __y__\n```\n\nthanks", "see below<br><br>```py<br>x = <u>y</u><br>```<br><br>thanks");

    expect([...el.childNodes].map((n) => n.nodeName)).toEqual(["#text", "PRE", "#text"]);
    expect(el.textContent).toBe("see belowx = __y__thanks");
  });

  // Element with markdown off sends the text escaped, newlines as <br>. The
  // sender turned markdown off, so nothing but the fence changes.
  it("leaves other clients' prose alone: Element with markdown off", () => {
    const body = "try a || b, or c || d:\n```sh\nmake check\n```\n> not a quote, 2*3*4 and __init__ and [x](https://example.com)";
    const html = "try a || b, or c || d:<br/>```sh<br/>make check<br/>```<br/>&gt; not a quote, 2*3*4 and __init__ and [x](https://example.com)";
    const el = rendered(body, html);

    expect(el.querySelector("code.language-sh")?.textContent).toBe("make check");
    expect(el.querySelector("[data-mx-spoiler], em, u, blockquote, a")).toBeNull();
    expect(el.textContent).toBe("try a || b, or c || d:make check> not a quote, 2*3*4 and __init__ and [x](https://example.com)");
  });

  it("keeps a mention pill from a client that sends one", () => {
    const el = rendered(
      "@alice:example.org run this:\n```\nnix flake update\n```",
      '<a href="https://matrix.to/#/@alice:example.org">Alice</a> run this:<br>```<br>nix flake update<br>```',
    );

    expect(el.querySelector("a")?.textContent).toBe("Alice");
    expect(el.querySelector("code")?.textContent).toBe("nix flake update");
  });

  it("finds fences on lines HTML breaks with a literal newline", () => {
    const el = rendered("```py\nx = __y__\n```", "```py\nx = <u>y</u>\n```");

    expect(el.querySelector("code.language-py")?.textContent).toBe("x = __y__");
  });

  it("puts the plain body's code in as text, never markup", () => {
    const el = rendered("```\n<img src=x onerror=alert(1)>\n```", "```<br>&lt;img src=x onerror=alert(1)&gt;<br>```");

    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("code")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});
