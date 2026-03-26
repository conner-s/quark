// Compose bar with mode indicator

import { Mode } from "../vim/mode.js";

const MODE_LABELS: Record<string, string> = {
  Normal: "NOR",
  Insert: "INS",
  Command: "CMD",
  Visual: "VIS",
};

const MODE_CSS_CLASS: Record<string, string> = {
  Normal: "",
  Insert: "input-bar__mode--insert",
  Command: "input-bar__mode--command",
  Visual: "input-bar__mode--visual",
};

export class Input {
  private _el: HTMLElement;
  private _modeEl: HTMLElement;
  private _fieldEl: HTMLInputElement;
  private _composeBoxEl: HTMLElement;
  private _currentMode: string = "Normal";
  private _onEmojiClick: (() => void) | null = null;
  private _onAttachClick: (() => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "input-bar";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Message input");

    // Mode indicator (stays on far left, full height)
    this._modeEl = document.createElement("span");
    this._modeEl.className = "input-bar__mode";
    this._modeEl.setAttribute("aria-live", "polite");
    this._modeEl.setAttribute("aria-label", "Editor mode");
    this._modeEl.textContent = "NOR";
    this._el.appendChild(this._modeEl);

    // Compose box — directly after mode indicator, no avatar
    this._composeBoxEl = document.createElement("div");
    this._composeBoxEl.className = "input-bar__compose-box";

    // Text field
    this._fieldEl = document.createElement("input");
    this._fieldEl.type = "text";
    this._fieldEl.className = "input-bar__field";
    this._fieldEl.setAttribute("autocomplete", "off");
    this._fieldEl.setAttribute("autocorrect", "off");
    this._fieldEl.setAttribute("autocapitalize", "off");
    this._fieldEl.setAttribute("spellcheck", "false");
    this._fieldEl.setAttribute("aria-label", "Compose message");
    this._fieldEl.placeholder = "…";
    this._composeBoxEl.appendChild(this._fieldEl);

    // Action buttons on the right side of the compose box
    const actionsEl = document.createElement("div");
    actionsEl.className = "input-bar__actions";

    const emojiBtn = document.createElement("button");
    emojiBtn.type = "button";
    emojiBtn.className = "input-bar__action-btn";
    emojiBtn.setAttribute("title", "Emoji picker (Ctrl+E)");
    emojiBtn.setAttribute("aria-label", "Open emoji picker");
    emojiBtn.setAttribute("tabindex", "-1");
    emojiBtn.textContent = "🙂";
    emojiBtn.addEventListener("click", () => this._onEmojiClick?.());
    actionsEl.appendChild(emojiBtn);

    const attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.className = "input-bar__action-btn";
    attachBtn.setAttribute("title", "Attach file");
    attachBtn.setAttribute("aria-label", "Attach file");
    attachBtn.setAttribute("tabindex", "-1");
    attachBtn.textContent = "📎";
    attachBtn.addEventListener("click", () => this._onAttachClick?.());
    actionsEl.appendChild(attachBtn);

    this._composeBoxEl.appendChild(actionsEl);

    this._el.appendChild(this._composeBoxEl);
  }

  /** Register a callback for the emoji picker button. */
  onEmojiPickerClick(handler: () => void): void {
    this._onEmojiClick = handler;
  }

  /** Register a callback for the attach file button. */
  onAttachClick(handler: () => void): void {
    this._onAttachClick = handler;
  }

  /** Returns the compose box element (for position measurement and animation). */
  getComposeBoxElement(): HTMLElement {
    return this._composeBoxEl;
  }

  /** Returns the text input field element (for precise text position measurement). */
  getFieldElement(): HTMLInputElement {
    return this._fieldEl;
  }

  /**
   * Animate the compose box when a message merges into an existing bubble.
   * The border fades to transparent and back, signalling absorption rather than flight.
   */
  animateMerge(): void {
    this._composeBoxEl.classList.remove("input-bar__compose-box--merge");
    void this._composeBoxEl.offsetWidth;
    this._composeBoxEl.classList.add("input-bar__compose-box--merge");
  }

  /** Trigger a brief refresh animation on the compose box after sending. */
  animateSent(): void {
    this._composeBoxEl.classList.remove("input-bar__compose-box--sent");
    void this._composeBoxEl.offsetWidth; // force reflow to restart animation
    this._composeBoxEl.classList.add("input-bar__compose-box--sent");
  }

  getElement(): HTMLElement {
    return this._el;
  }

  getValue(): string {
    return this._fieldEl.value;
  }

  setValue(text: string): void {
    this._fieldEl.value = text;
  }

  focus(): void {
    this._fieldEl.focus();
  }

  blur(): void {
    this._fieldEl.blur();
  }

  setMode(mode: Mode): void {
    const label: string = mode;
    this._currentMode = label;

    // Remove previous mode class
    for (const cls of Object.values(MODE_CSS_CLASS)) {
      if (cls) this._modeEl.classList.remove(cls);
    }

    // Set mode label
    this._modeEl.textContent = MODE_LABELS[label] ?? label.slice(0, 3).toUpperCase();

    // Apply mode class
    const cls = MODE_CSS_CLASS[label];
    if (cls) this._modeEl.classList.add(cls);

    if (label === "Command") {
      this._fieldEl.placeholder = "command…";
      this._fieldEl.focus();
    } else if (label === "Insert") {
      this._fieldEl.placeholder = "…";
      this._fieldEl.focus();
    } else {
      this._fieldEl.placeholder = "…";
    }
  }

  onSubmit(handler: (value: string) => void): void {
    this._fieldEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handler(this._fieldEl.value);
      }
    });
  }

  onInput(handler: (value: string) => void): void {
    this._fieldEl.addEventListener("input", () => handler(this._fieldEl.value));
  }

}
