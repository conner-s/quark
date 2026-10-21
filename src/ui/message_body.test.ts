import { describe, it, expect, vi } from "vitest";
import { renderFormattedBody } from "./message_body.js";

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
