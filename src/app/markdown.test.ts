import { describe, it, expect } from "vitest";
import { markdownToHtml } from "./markdown.js";

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

  it("returns undefined when an emoji shortcode is unknown and there is no formatting", () => {
    expect(markdownToHtml("hi :unknown:", { resolveEmoji: () => undefined })).toBeUndefined();
  });
});
