import { describe, it, expect } from "vitest";
import { extractShortcodeQuery, extractMentionQuery } from "./autocomplete_query.js";

// These parsers decide when the compose-box emoji/mention autocompletes fire.
// They were buried as private functions in keyboard.ts (1200+ lines, welded to
// IPC/DOM) where they couldn't be tested; pulled out here and pinned down.

describe("extractShortcodeQuery", () => {
  it("returns the query while typing a shortcode", () => {
    expect(extractShortcodeQuery("hello :smi")).toBe("smi");
    expect(extractShortcodeQuery(":smi")).toBe("smi");
    expect(extractShortcodeQuery(":a")).toBe("a");
  });

  it("allows underscores and digits in the query", () => {
    expect(extractShortcodeQuery(":sm_ile2")).toBe("sm_ile2");
  });

  it("returns null when there is no colon", () => {
    expect(extractShortcodeQuery("hello world")).toBeNull();
  });

  it("returns null immediately after a lone colon (needs ≥1 char)", () => {
    expect(extractShortcodeQuery(":")).toBeNull();
    expect(extractShortcodeQuery("hi :")).toBeNull();
  });

  it("returns null when the text after the colon contains a space", () => {
    expect(extractShortcodeQuery(":sm ile")).toBeNull();
  });

  it("returns null when the last colon closes a completed shortcode", () => {
    // ":foo:bar" — the last colon is the closing colon of :foo:, not a new query
    expect(extractShortcodeQuery(":foo:bar")).toBeNull();
  });

  it("returns null right after a completed shortcode's closing colon", () => {
    expect(extractShortcodeQuery(":foo:")).toBeNull();
  });

  it("fires again for a NEW shortcode typed after a completed one", () => {
    // The space between :smile: and :gr means the trailing colon opens a query.
    expect(extractShortcodeQuery("foo :smile: :gr")).toBe("gr");
  });
});

describe("extractMentionQuery", () => {
  it("returns the query while typing a mention", () => {
    expect(extractMentionQuery("@ali")).toBe("ali");
    expect(extractMentionQuery("hello @bo")).toBe("bo");
  });

  it("only triggers when @ starts a word (preceded by space or start)", () => {
    expect(extractMentionQuery("hello@bo")).toBeNull();
    expect(extractMentionQuery("a@b")).toBeNull();
  });

  it("uses the last @-word when several are present", () => {
    expect(extractMentionQuery("@ab @cd")).toBe("cd");
  });

  it("returns null when a space ends the mention query", () => {
    expect(extractMentionQuery("@foo bar")).toBeNull();
  });

  it("returns null when there is no @", () => {
    expect(extractMentionQuery("no mention here")).toBeNull();
  });

  it("returns an empty string for a bare @ (picker opens, unfiltered)", () => {
    expect(extractMentionQuery("@")).toBe("");
    expect(extractMentionQuery("hi @")).toBe("");
  });
});
