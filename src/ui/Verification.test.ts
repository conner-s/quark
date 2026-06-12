import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Verification, type SasEmoji } from "./Verification.js";

const EMOJI: SasEmoji[] = [
  { emoji: "🐶", description: "Dog" },
  { emoji: "🍕", description: "Pizza" },
];

describe("Verification", () => {
  let verification: Verification;

  beforeEach(() => {
    verification = new Verification();
    document.body.appendChild(verification.getElement());
  });

  afterEach(() => {
    verification.hide();
    verification.getElement().remove();
  });

  function emojiCells(): NodeListOf<Element> {
    return verification.getElement().querySelectorAll(".verification-dialog__emoji-cell");
  }

  it("renders the SAS emoji grid in comparing state", () => {
    verification.show();
    verification.setSasEmoji(EMOJI);
    verification.setState("comparing");
    expect(emojiCells()).toHaveLength(2);
  });

  it("clears stale emoji when a new incoming request arrives after a failure", () => {
    // First attempt: emoji shown, then verification fails.
    verification.show();
    verification.setSasEmoji(EMOJI);
    verification.setState("comparing");
    verification.setState("failed");
    verification.hide();

    // Second attempt: incoming popup must not show the old emoji.
    verification.setIncomingRequest("@alice:example.org", "DEVICE2");
    verification.setState("incoming");
    verification.show();
    expect(emojiCells()).toHaveLength(0);
  });

  it("clears stale emoji when starting a new outbound flow", () => {
    verification.show();
    verification.setSasEmoji(EMOJI);
    verification.setState("comparing");
    verification.setState("cancelled");
    verification.hide();

    verification.setState("waiting");
    verification.show();
    expect(emojiCells()).toHaveLength(0);
  });
});
