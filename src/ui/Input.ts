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
  private _promptEl: HTMLElement;
  private _fieldEl: HTMLInputElement;
  private _currentMode: string = "Normal";

  constructor(promptSymbol = ":>") {
    this._el = document.createElement("div");
    this._el.className = "input-bar";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Message input");

    // Mode indicator
    this._modeEl = document.createElement("span");
    this._modeEl.className = "input-bar__mode";
    this._modeEl.setAttribute("aria-live", "polite");
    this._modeEl.setAttribute("aria-label", "Editor mode");
    this._modeEl.textContent = "NOR";
    this._el.appendChild(this._modeEl);

    // Prompt symbol
    this._promptEl = document.createElement("span");
    this._promptEl.className = "input-bar__prompt";
    this._promptEl.textContent = promptSymbol;
    this._promptEl.setAttribute("aria-hidden", "true");
    this._el.appendChild(this._promptEl);

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
    this._el.appendChild(this._fieldEl);
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

    // In command mode, prefix the prompt with ":"
    if (label === "Command") {
      this._promptEl.textContent = ":";
      this._fieldEl.placeholder = "command…";
      this._fieldEl.focus();
    } else if (label === "Insert") {
      this._promptEl.textContent = this._getDefaultPrompt();
      this._fieldEl.placeholder = "…";
      this._fieldEl.focus();
    } else {
      this._promptEl.textContent = this._getDefaultPrompt();
      this._fieldEl.placeholder = "…";
    }
  }

  setPromptSymbol(symbol: string): void {
    if (this._currentMode !== "Command") {
      this._promptEl.textContent = symbol;
    }
    this._el.dataset.promptSymbol = symbol;
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

  // ── Private ──────────────────────────────────────────────────────────────

  private _getDefaultPrompt(): string {
    return this._el.dataset.promptSymbol ?? ":>";
  }
}
