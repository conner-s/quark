// Post-login onboarding prompt: invites the user to verify this session against
// another device they're already signed in on. It's only the yes/later/never
// gate shown on startup — the actual SAS emoji-compare flow lives in
// `app/actions/crypto.ts` (`startVerification`). Reuses the `verification-dialog`
// CSS so it matches the verification overlay without new styles.

import { DialogBase } from "./DialogBase.js";

export type VerificationPromptChoice =
  | "verify" // start the emoji-compare flow now
  | "later"  // dismiss; ask again on the next startup
  | "never"; // dismiss and stop prompting (persists prompt_session_verification=false)

type ChoiceCallback = (choice: VerificationPromptChoice) => void;

export class VerificationPromptDialog extends DialogBase {
  private _onChoose: ChoiceCallback | null = null;
  private readonly _verifyBtn: HTMLButtonElement;

  constructor() {
    // Match the Verification overlay: don't reset the key sequence on hide.
    super({
      prefix: "verification-dialog",
      ariaLabel: "Verify this session",
      resetSequenceOnHide: false,
    });

    const panel = this.content;

    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "verification-dialog__header";
    panel.appendChild(header);

    const title = document.createElement("span");
    title.className = "verification-dialog__title";
    title.textContent = "verify this session";
    header.appendChild(title);

    // Esc / close button = "Not now" (non-destructive: re-asks next startup).
    header.appendChild(this.makeCloseButton("Dismiss", () => this._choose("later")));

    // ── Body ──────────────────────────────────────────────────────────────
    const body = document.createElement("div");
    body.className = "verification-dialog__body";
    panel.appendChild(body);

    const msg = document.createElement("div");
    msg.className = "verification-dialog__status";
    msg.textContent =
      "This session isn't verified yet. Verify it against another device you're " +
      "signed in on (emoji compare) to sync your encryption keys and read past " +
      "encrypted messages.";
    body.appendChild(msg);

    // ── Action buttons ────────────────────────────────────────────────────
    const actions = document.createElement("div");
    actions.className = "verification-dialog__actions";
    body.appendChild(actions);

    this._verifyBtn = this._makeButton(
      "[ Verify now ]",
      "confirm",
      "Start emoji-compare verification",
      () => this._choose("verify"),
    );
    actions.appendChild(this._verifyBtn);
    actions.appendChild(
      this._makeButton("[ Not now ]", "deny", "Ask again next time", () => this._choose("later")),
    );
    actions.appendChild(
      this._makeButton("[ Never ask ]", "dismiss", "Stop prompting on startup", () => this._choose("never")),
    );
  }

  private _makeButton(
    label: string,
    variant: "confirm" | "deny" | "dismiss",
    ariaLabel: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `verification-dialog__btn verification-dialog__btn--${variant}`;
    btn.textContent = label;
    btn.setAttribute("aria-label", ariaLabel);
    btn.addEventListener("click", onClick);
    return btn;
  }

  private _choose(choice: VerificationPromptChoice): void {
    const cb = this._onChoose;
    this._onChoose = null; // fire at most once per show()
    this.hide();
    cb?.(choice);
  }

  /** Show the prompt. `onChoose` fires exactly once with the user's selection. */
  show(onChoose: ChoiceCallback): void {
    this._onChoose = onChoose;
    this.reveal();
  }

  /** Focus the primary action so Enter confirms "Verify now". */
  protected override focusTarget(): HTMLElement {
    return this._verifyBtn;
  }
}
