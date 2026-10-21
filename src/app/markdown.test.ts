import { describe, it, expect } from "vitest";
import { markdownToHtml, mapProse, withoutCode, insideCodeFence } from "./markdown.js";

const resolveParty = (sc: string): string | undefined => (sc === "party" ? "mxc://e/party" : undefined);
const PARTY_IMG = '<img data-mx-emoticon src="mxc://e/party" alt=":party:" title=":party:">';

describe("markdownToHtml", () => {
  it("returns undefined for plain text with no formatting", () => {
    expect(markdownToHtml("just a normal message")).toBeUndefined();
  });

  it("renders bold, italic, underline, strikethrough", () => {
    expect(markdownToHtml("a **b** c")).toBe("a <strong>b</strong> c");
    expect(markdownToHtml("a *b* c")).toBe("a <em>b</em> c");
    expect(markdownToHtml("a __b__ c")).toBe("a <u>b</u> c");
    expect(markdownToHtml("a ~~b~~ c")).toBe("a <del>b</del> c");
  });

  it("renders spoilers as data-mx-spoiler spans", () => {
    expect(markdownToHtml("psst ||secret||")).toBe('psst <span data-mx-spoiler>secret</span>');
  });

  it("treats inline code as literal and escapes it", () => {
    expect(markdownToHtml("run `a < b && c`")).toBe("run <code>a &lt; b &amp;&amp; c</code>");
  });

  it("does not parse markers inside inline code", () => {
    expect(markdownToHtml("`**not bold**`")).toBe("<code>**not bold**</code>");
  });

  it("prefers the longer delimiter (** over *)", () => {
    expect(markdownToHtml("**bold**")).toBe("<strong>bold</strong>");
  });

  it("nests formatting", () => {
    expect(markdownToHtml("**bold and ~~struck~~**")).toBe(
      "<strong>bold and <del>struck</del></strong>",
    );
  });

  it("leaves snake_case identifiers untouched", () => {
    expect(markdownToHtml("call send_video_now please")).toBeUndefined();
  });

  it("escapes HTML in plain segments", () => {
    expect(markdownToHtml("a < b & **c**")).toBe("a &lt; b &amp; <strong>c</strong>");
  });

  it("resolves custom emoji to mx-emoticon images and keeps formatting", () => {
    const resolveEmoji = (sc: string) => (sc === "party" ? "mxc://e/party" : undefined);
    expect(markdownToHtml("**yay** :party:", { resolveEmoji })).toBe(
      '<strong>yay</strong> <img data-mx-emoticon src="mxc://e/party" alt=":party:" title=":party:">',
    );
  });

  // Pack URLs are room state; a quote in one must not end the src attribute.
  it("escapes a custom emoji's URL inside its src attribute", () => {
    const resolveEmoji = () => 'mxc://evil/x"><img src="https://t.example/p.gif';
    expect(markdownToHtml(":cat:", { resolveEmoji })).toBe(
      '<img data-mx-emoticon src="mxc://evil/x&quot;&gt;&lt;img src=&quot;https://t.example/p.gif" alt=":cat:" title=":cat:">',
    );
  });

  it("returns undefined when an emoji shortcode is unknown and there is no formatting", () => {
    expect(markdownToHtml("hi :unknown:", { resolveEmoji: () => undefined })).toBeUndefined();
  });

  describe("links (#115)", () => {
    it("renders [text](url) as an anchor", () => {
      expect(markdownToHtml("[link](https://www.google.com)")).toBe(
        '<a href="https://www.google.com">link</a>',
      );
    });

    it("renders a link mid-sentence and parses formatting in the label", () => {
      expect(markdownToHtml("see [**docs**](https://e.com/a) now")).toBe(
        'see <a href="https://e.com/a"><strong>docs</strong></a> now',
      );
    });

    it("keeps the URL literal: markers and underscores in it are not formatting", () => {
      expect(markdownToHtml("[x](https://e.com/a__b__c*d*)")).toBe(
        '<a href="https://e.com/a__b__c*d*">x</a>',
      );
    });

    it("escapes the URL for an attribute", () => {
      expect(markdownToHtml('[q](https://e.com/?a=1&b="2")')).toBe(
        '<a href="https://e.com/?a=1&amp;b=&quot;2&quot;">q</a>',
      );
    });

    it("allows one level of balanced parentheses in the URL", () => {
      expect(markdownToHtml("[w](https://en.wikipedia.org/wiki/Foo_(bar))")).toBe(
        '<a href="https://en.wikipedia.org/wiki/Foo_(bar)">w</a>',
      );
    });

    it("accepts mailto: and matrix: links", () => {
      expect(markdownToHtml("[me](mailto:a@b.c)")).toBe('<a href="mailto:a@b.c">me</a>');
      expect(markdownToHtml("[room](matrix:r/quark:e.org)")).toBe(
        '<a href="matrix:r/quark:e.org">room</a>',
      );
    });

    it("leaves unsafe or relative targets as literal text", () => {
      expect(markdownToHtml("[x](javascript:alert(1))")).toBeUndefined();
      expect(markdownToHtml("[x](/relative)")).toBeUndefined();
      expect(markdownToHtml("[x](https://has space.com)")).toBeUndefined();
    });

    it("does not splice a custom emoji into an href", () => {
      const resolveEmoji = (sc: string) => (sc === "party" ? "mxc://e/party" : undefined);
      const html = markdownToHtml("[x](https://e.com/:party:)", { resolveEmoji });
      expect(html).not.toContain("<a");
      expect(html).toContain("data-mx-emoticon");
    });
  });

  it("turns newlines into <br> in a formatted body", () => {
    expect(markdownToHtml("**a**\nb\r\nc")).toBe("<strong>a</strong><br>b<br>c");
  });

  it("leaves a multi-line message with no formatting as plain text", () => {
    expect(markdownToHtml("a\nb")).toBeUndefined();
  });

  describe("block quotes (#118)", () => {
    it("renders a quote followed by text without stray <br>", () => {
      expect(markdownToHtml("> quoted text\n\nnormal text")).toBe(
        "<blockquote>quoted text</blockquote>normal text",
      );
    });

    it("groups consecutive quote lines, accepting a bare >", () => {
      expect(markdownToHtml("> a\n>b\n> c")).toBe("<blockquote>a<br>b<br>c</blockquote>");
    });

    it("parses inline markdown inside the quote", () => {
      expect(markdownToHtml("> **bold** `x`")).toBe(
        "<blockquote><strong>bold</strong> <code>x</code></blockquote>",
      );
    });

    it("keeps text before a quote and single-newline adjacency", () => {
      expect(markdownToHtml("intro\n> q\nafter")).toBe(
        "intro<blockquote>q</blockquote>after",
      );
    });

    it("escapes HTML inside the quote", () => {
      expect(markdownToHtml("> <b>")).toBe("<blockquote>&lt;b&gt;</blockquote>");
    });

    it("does not treat > mid-line as a quote", () => {
      expect(markdownToHtml("a > b")).toBeUndefined();
    });

    it("leaves > lines inside a fenced block literal", () => {
      const out = markdownToHtml("```\n> not a quote\n```");
      expect(out === undefined || !out.includes("<blockquote>")).toBe(true);
    });

    it("nests a quote inside a quote", () => {
      // Quote content is parsed like a message of its own, so a second `>`
      // opens a second level rather than staying a literal `&gt;`.
      expect(markdownToHtml("> > a\n> b")).toBe(
        "<blockquote><blockquote>a</blockquote>b</blockquote>",
      );
      expect(markdownToHtml(">>x")).toBe("<blockquote><blockquote>x</blockquote></blockquote>");
    });

    it("stops nesting at 32 levels and keeps the rest of the >s as text", () => {
      const out = markdownToHtml(">".repeat(40) + " x")!;
      expect(out.match(/<blockquote>/g)).toHaveLength(32);
      expect(out).toContain(`<blockquote>${"&gt;".repeat(8)} x</blockquote>`);
    });

    it("survives a body of tens of thousands of >s", () => {
      // Any room member can send one, and withoutCode runs on every incoming
      // body the timeline renders: one recursion per level would overflow the
      // stack and blank the room.
      const hostile = ">".repeat(65000);
      expect(markdownToHtml(hostile)).toMatch(/^(<blockquote>){32}(&gt;)+(<\/blockquote>){32}$/);
      expect(mapProse(hostile, (p) => p)).toBe(hostile);
      expect(withoutCode(hostile)).toBe(hostile);
      // With code in it, so withoutCode really parses rather than short-cuts.
      const withCode = `${hostile} \`x\` https://a.example`;
      expect(withoutCode(withCode)).toBe(`${hostile}   https://a.example`);
      expect(mapProse(withCode, (p) => p)).toBe(withCode);
    });
  });

  describe("fenced code blocks", () => {
    it("labels the block with the fence's language", () => {
      expect(markdownToHtml("```js\nlet x = 1;\n```")).toBe(
        '<pre><code class="language-js">let x = 1;</code></pre>',
      );
    });

    it("sends a fence with no language as a bare <pre><code>", () => {
      expect(markdownToHtml("```\nhello\n```")).toBe("<pre><code>hello</code></pre>");
    });

    it("keeps the sender's case in the language class", () => {
      expect(markdownToHtml("```Nix\nx\n```")).toBe('<pre><code class="language-Nix">x</code></pre>');
    });

    it("sends the user's Nix example verbatim, indentation and quotes included", () => {
      const src = [
        "```nix",
        "inputs = {",
        '    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";',
        "    # a comment",
        "  };",
        "```",
      ].join("\n");
      expect(markdownToHtml(src)).toBe(
        '<pre><code class="language-nix">inputs = {\n' +
          '    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";\n' +
          "    # a comment\n" +
          "  };</code></pre>",
      );
    });

    it("HTML-escapes the code", () => {
      expect(markdownToHtml("```\n<b>x</b> && y\n```")).toBe(
        "<pre><code>&lt;b&gt;x&lt;/b&gt; &amp;&amp; y</code></pre>",
      );
    });

    it("drops a hostile info string instead of putting it in the class", () => {
      expect(markdownToHtml('```"><img onerror=x>\nboom\n```')).toBe("<pre><code>boom</code></pre>");
    });

    it("drops an info string that isn't a language name (pandoc attributes)", () => {
      expect(markdownToHtml("```{.python}\nx\n```")).toBe("<pre><code>x</code></pre>");
    });

    it("takes the first word of the info string as the language", () => {
      expect(markdownToHtml("```nix title=foo\nx\n```")).toBe(
        '<pre><code class="language-nix">x</code></pre>',
      );
    });

    it("accepts language names with + # . -", () => {
      expect(markdownToHtml("```c++\nx\n```")).toBe('<pre><code class="language-c++">x</code></pre>');
      expect(markdownToHtml("```c#\nx\n```")).toBe('<pre><code class="language-c#">x</code></pre>');
    });

    it("leaves every inline marker literal inside a fence", () => {
      expect(
        markdownToHtml("```py\n__init__ **b** ~~s~~ ||sp|| [l](https://e.com) `x` a * b * c\n```"),
      ).toBe(
        '<pre><code class="language-py">__init__ **b** ~~s~~ ||sp|| [l](https://e.com) `x` a * b * c</code></pre>',
      );
    });

    it("keeps a custom emoji shortcode literal inside a fence but resolves it outside", () => {
      expect(markdownToHtml(":party:\n```\n:party:\n```", { resolveEmoji: resolveParty })).toBe(
        `${PARTY_IMG}<pre><code>:party:</code></pre>`,
      );
    });

    it("keeps newlines, blank lines and tabs inside the code literal (never <br>)", () => {
      expect(markdownToHtml("```\na\n\n\n\tb\n```")).toBe("<pre><code>a\n\n\n\tb</code></pre>");
    });

    it("normalises CRLF line endings inside the code", () => {
      expect(markdownToHtml("```js\r\na\r\nb\r\n```")).toBe(
        '<pre><code class="language-js">a\nb</code></pre>',
      );
    });

    it("puts no <br> against the block when text touches it", () => {
      expect(markdownToHtml("intro\n```sh\nls\n```\nafter")).toBe(
        'intro<pre><code class="language-sh">ls</code></pre>after',
      );
    });

    it("drops the one blank line separating text from the block", () => {
      expect(markdownToHtml("intro\n\n```sh\nls\n```\n\nafter")).toBe(
        'intro<pre><code class="language-sh">ls</code></pre>after',
      );
    });

    it("still parses markdown in the text around the block", () => {
      expect(markdownToHtml("**look**\n```\nx\n```\n*done*")).toBe(
        "<strong>look</strong><pre><code>x</code></pre><em>done</em>",
      );
    });

    it("runs an unclosed fence with content to the end of the message", () => {
      expect(markdownToHtml("```\n> a\n**b**")).toBe("<pre><code>&gt; a\n**b**</code></pre>");
    });

    it("leaves an unclosed fence with no content as literal text, not an empty box", () => {
      expect(markdownToHtml("```nix")).toBeUndefined();
      expect(markdownToHtml("look\n```")).toBeUndefined();
      expect(markdownToHtml("**a**\n```")).toBe("<strong>a</strong><br>```");
    });

    it("sends a closed empty fence as an empty block", () => {
      expect(markdownToHtml("```\n```")).toBe("<pre><code></code></pre>");
    });

    it("accepts trailing spaces and tabs on the fences", () => {
      expect(markdownToHtml("```   \ncode\n``` \t")).toBe("<pre><code>code</code></pre>");
    });

    it("accepts ~~~ fences, closed only by ~~~", () => {
      expect(markdownToHtml("~~~\n> a\n~~~")).toBe("<pre><code>&gt; a</code></pre>");
      expect(markdownToHtml("```\na\n~~~\nb\n```")).toBe("<pre><code>a\n~~~\nb</code></pre>");
    });

    it("needs a closer at least as long as the opener", () => {
      expect(markdownToHtml("````\n```\ninner\n```\n````")).toBe(
        "<pre><code>```\ninner\n```</code></pre>",
      );
    });

    it("treats a would-be closer with an info string as content", () => {
      expect(markdownToHtml("```\na\n```js\nb\n```")).toBe("<pre><code>a\n```js\nb</code></pre>");
    });

    it("doesn't open a fence from a one-line ```code``` run", () => {
      expect(markdownToHtml("```code```\nnext")).toBe("``<code>code</code>``<br>next");
    });

    it("strips the opener's indentation from the content lines", () => {
      expect(markdownToHtml("  ```\n  a\n    b\nc\n  ```")).toBe("<pre><code>a\n  b\nc</code></pre>");
    });

    it("doesn't treat a fence indented four spaces as one", () => {
      expect(markdownToHtml("    ```\nx\n    ```")).toBeUndefined();
    });

    it("renders a fence inside a quote", () => {
      expect(markdownToHtml("> ```js\n> let x = 1;\n> ```")).toBe(
        '<blockquote><pre><code class="language-js">let x = 1;</code></pre></blockquote>',
      );
    });

    it("ends a quote at a fence that follows it", () => {
      expect(markdownToHtml("> q\n```\n> not\n```")).toBe(
        "<blockquote>q</blockquote><pre><code>&gt; not</code></pre>",
      );
    });
  });

  describe("code spans", () => {
    it("keeps a custom emoji shortcode literal inside a code span", () => {
      expect(markdownToHtml("`:party:` :party:", { resolveEmoji: resolveParty })).toBe(
        `<code>:party:</code> ${PARTY_IMG}`,
      );
    });

    it("binds tighter than emphasis, as in CommonMark", () => {
      expect(markdownToHtml("**a `b** c`")).toBe("**a <code>b** c</code>");
    });

    it("can sit inside emphasis and link labels", () => {
      expect(markdownToHtml("**x `y` z**")).toBe("<strong>x <code>y</code> z</strong>");
      expect(markdownToHtml("[`x`](https://e.com)")).toBe('<a href="https://e.com"><code>x</code></a>');
    });
  });
});

describe("mapProse", () => {
  const tag = (s: string): string => `[${s}]`;

  it("hands fn the prose and leaves fenced code alone", () => {
    expect(mapProse("before\n```nix\nf = a:b;\n```\nafter", tag)).toBe(
      "[before]\n```nix\nf = a:b;\n```\n[after]",
    );
  });

  it("leaves code spans alone", () => {
    expect(mapProse("run `a:b:c` now", tag)).toBe("[run ]`a:b:c`[ now]");
  });

  it("keeps quote markers out of fn, and fences in quotes alone", () => {
    expect(mapProse("> ```\n> a:b\n> ```\n> hi", tag)).toBe("> ```\n> a:b\n> ```\n> [hi]");
  });

  it("is lossless: identity returns the input byte for byte", () => {
    for (const s of [
      "x\r\n```\r\n:b:\r\n```\r\n:b:",
      "intro\n\n```\nx\n```\n\nafter",
      "  ```\n  a\n    b\n  ```",
      "> > q\n\n```\nunclosed\n\n\n",
      "```nix",
      "",
    ]) {
      expect(mapProse(s, (p) => p)).toBe(s);
    }
  });

  it("treats a lone unclosed fence as prose, as markdownToHtml does", () => {
    expect(mapProse("```nix", tag)).toBe("[```nix]");
  });
});

describe("withoutCode", () => {
  it("blanks fenced code and code spans but keeps the prose", () => {
    const out = withoutCode("see https://a.com and `https://b.com`\n```\nhttps://c.com\n```\nend");
    expect(out).toContain("https://a.com");
    expect(out).not.toContain("b.com");
    expect(out).not.toContain("c.com");
    expect(out).toContain("end");
  });

  it("keeps prose on either side of a code span apart", () => {
    expect(withoutCode("https://a.com`x`")).toBe("https://a.com ");
  });
});

describe("insideCodeFence", () => {
  it("is true right after an opener and inside an unclosed block", () => {
    expect(insideCodeFence("```nix")).toBe(true);
    expect(insideCodeFence("```nix\nfoo")).toBe(true);
    expect(insideCodeFence("~~~\nx")).toBe(true);
  });

  it("is false once the fence is closed", () => {
    expect(insideCodeFence("```nix\nfoo\n```")).toBe(false);
    expect(insideCodeFence("```nix\nfoo\n``")).toBe(true); // too short to close
  });

  it("is false for backticks that don't open a fence", () => {
    expect(insideCodeFence("a ```")).toBe(false);
    expect(insideCodeFence("```code```")).toBe(false);
    expect(insideCodeFence("`x`")).toBe(false);
  });

  it("looks only at the text before the caret", () => {
    const text = "```\ncode\n```\nafter";
    expect(insideCodeFence(text, text.indexOf("code") + 2)).toBe(true);
    expect(insideCodeFence(text, text.length)).toBe(false);
    expect(insideCodeFence(text, 0)).toBe(false);
  });

  it("tracks a second fence after a closed one", () => {
    expect(insideCodeFence("```\na\n```\nb\n```py")).toBe(true);
  });

  it("ignores fences inside quotes", () => {
    expect(insideCodeFence("> ```\n> x")).toBe(false);
  });
});
