import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppState } from "./state.js";
import {
  autocompleteAllowed,
  effectiveSendOnEnter,
  enterSends,
  shouldShowSendButton,
} from "./send_behavior.js";

// isMobile() reads module state set by initMobile(); mock it so platform can be
// driven directly.
const h = vi.hoisted(() => ({ mobile: false }));
vi.mock("./mobile.js", () => ({ isMobile: () => h.mobile }));

beforeEach(() => {
  h.mobile = false;
  AppState.set("sendKeyBehavior", "auto");
});

describe("effectiveSendOnEnter", () => {
  it("auto → sends on desktop", () => {
    AppState.set("sendKeyBehavior", "auto");
    h.mobile = false;
    expect(effectiveSendOnEnter()).toBe(true);
  });

  it("auto → inserts a newline on mobile", () => {
    AppState.set("sendKeyBehavior", "auto");
    h.mobile = true;
    expect(effectiveSendOnEnter()).toBe(false);
  });

  it("enter → always sends, even on mobile", () => {
    AppState.set("sendKeyBehavior", "enter");
    h.mobile = true;
    expect(effectiveSendOnEnter()).toBe(true);
  });

  it("newline → never sends, even on desktop", () => {
    AppState.set("sendKeyBehavior", "newline");
    h.mobile = false;
    expect(effectiveSendOnEnter()).toBe(false);
  });
});

describe("enterSends", () => {
  it("sends plain text when Enter sends", () => {
    expect(enterSends("hello")).toBe(true);
  });

  it("inserts a newline right after a fence opener", () => {
    expect(enterSends("```nix")).toBe(false);
  });

  it("inserts a newline inside an unclosed fence", () => {
    expect(enterSends("look:\n```nix\ninputs = {")).toBe(false);
  });

  it("sends again once the fence is closed", () => {
    expect(enterSends("```nix\nx = 1;\n```")).toBe(true);
  });

  it("decides by the caret, not the end of the text", () => {
    const text = "```\ncode\n```\nafter";
    expect(enterSends(text, text.indexOf("code"))).toBe(false);
    expect(enterSends(text, text.length)).toBe(true);
  });

  it("never sends when Enter doesn't send, fence or not", () => {
    AppState.set("sendKeyBehavior", "newline");
    expect(enterSends("hello")).toBe(false);
    expect(enterSends("```\nx\n```")).toBe(false);
  });

  it("follows the platform in auto mode (mobile inserts a newline)", () => {
    h.mobile = true;
    expect(enterSends("hello")).toBe(false);
  });
});

describe("autocompleteAllowed", () => {
  it("allows the popups in prose", () => {
    expect(autocompleteAllowed("hi :smi")).toBe(true);
    expect(autocompleteAllowed("ping @al")).toBe(true);
  });

  it("keeps them shut with the caret in an open fence", () => {
    expect(autocompleteAllowed("```nix\nf = a:b")).toBe(false);
    expect(autocompleteAllowed("```py\n@decorator")).toBe(false);
  });

  it("keeps them shut while the text ends in an open fence, wherever the caret is", () => {
    // The query is read from, and a completion written to, the end of the
    // text: a popup here would turn the Nix `a:b` into `a🅱️`.
    const text = "fixed it:\n```nix\nf = a:b";
    expect(autocompleteAllowed(text, 3)).toBe(false);
    const ping = "ping\n```py\n@decorator";
    expect(autocompleteAllowed(ping, 2)).toBe(false);
  });

  it("keeps them shut with the caret in a closed fence above prose", () => {
    // The popup would claim the Enter meant as a newline in the code.
    const text = "```\ncode\n```\nhi :smi";
    expect(autocompleteAllowed(text, text.indexOf("code"))).toBe(false);
    expect(autocompleteAllowed(text)).toBe(true);
  });

  it("allows them again once the fence is closed", () => {
    expect(autocompleteAllowed("```\na:b\n```\nnow :smi")).toBe(true);
  });

  it("doesn't depend on the send-key behavior", () => {
    AppState.set("sendKeyBehavior", "newline");
    expect(autocompleteAllowed("hi :smi")).toBe(true);
    expect(autocompleteAllowed("```\na:b")).toBe(false);
  });
});

describe("shouldShowSendButton", () => {
  it("hidden on desktop in auto mode", () => {
    AppState.set("sendKeyBehavior", "auto");
    h.mobile = false;
    expect(shouldShowSendButton()).toBe(false);
  });

  it("shown on mobile (touch needs a tap target)", () => {
    AppState.set("sendKeyBehavior", "auto");
    h.mobile = true;
    expect(shouldShowSendButton()).toBe(true);
  });

  it("shown on desktop when Enter won't send (newline mode)", () => {
    AppState.set("sendKeyBehavior", "newline");
    h.mobile = false;
    expect(shouldShowSendButton()).toBe(true);
  });

  it("hidden on desktop in enter mode", () => {
    AppState.set("sendKeyBehavior", "enter");
    h.mobile = false;
    expect(shouldShowSendButton()).toBe(false);
  });
});
