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
  private _pastePreviewEl: HTMLElement;
  private _pastePreviewImg: HTMLImageElement;
  private _inputBarEl: HTMLElement;
  private _pendingPasteBlob: Blob | null = null;
  private _currentMode: string = "Normal";
  private _onEmojiClick: (() => void) | null = null;
  private _onAttachClick: (() => void) | null = null;
  private _onImagePaste: ((blob: Blob) => void) | null = null;
  private _onFocusEnterInsert: (() => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "input-bar-wrap";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Message input");

    // ── Paste image preview (hidden by default, shown above compose bar) ──
    this._pastePreviewEl = document.createElement("div");
    this._pastePreviewEl.className = "paste-preview";
    this._pastePreviewEl.style.display = "none";
    this._pastePreviewEl.setAttribute("role", "group");
    this._pastePreviewEl.setAttribute("aria-label", "Image paste preview");

    this._pastePreviewImg = document.createElement("img");
    this._pastePreviewImg.className = "paste-preview__img";
    this._pastePreviewImg.alt = "Pasted image";
    this._pastePreviewEl.appendChild(this._pastePreviewImg);

    const previewLabel = document.createElement("span");
    previewLabel.className = "paste-preview__label";
    previewLabel.textContent = "Send image?";
    this._pastePreviewEl.appendChild(previewLabel);

    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "paste-preview__btn paste-preview__btn--send";
    sendBtn.textContent = "Send";
    sendBtn.addEventListener("click", () => this._confirmPaste());
    this._pastePreviewEl.appendChild(sendBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "paste-preview__btn paste-preview__btn--cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this._cancelPaste());
    this._pastePreviewEl.appendChild(cancelBtn);

    this._el.appendChild(this._pastePreviewEl);

    // ── The actual input bar ──────────────────────────────────────────────
    const inputBar = document.createElement("div");
    inputBar.className = "input-bar";
    this._inputBarEl = inputBar;

    // Mode indicator (stays on far left, full height)
    this._modeEl = document.createElement("span");
    this._modeEl.className = "input-bar__mode";
    this._modeEl.setAttribute("aria-live", "polite");
    this._modeEl.setAttribute("aria-label", "Editor mode");
    this._modeEl.textContent = "NOR";
    inputBar.appendChild(this._modeEl);

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

    // Clicking the field while not in insert mode should switch to insert mode
    this._fieldEl.addEventListener("click", () => this._onFocusEnterInsert?.());

    // Image paste handler. clipboardData.items is standard; .files is an
    // alternative that some Linux clipboard managers populate instead.
    // On Linux/Wayland, WebKit2GTK text inputs may not expose image data
    // in clipboardData at all, so we also fall back to navigator.clipboard.read().
    this._fieldEl.addEventListener("paste", (e) => {
      if (!this._onImagePaste) return;
      // Standard path: items
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const blob = item.getAsFile();
            if (blob) {
              e.preventDefault();
              this._showPastePreview(blob);
              return;
            }
          }
        }
      }
      // Fallback: files list (used by some Linux clipboard managers)
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        for (const file of Array.from(files)) {
          if (file.type.startsWith("image/")) {
            e.preventDefault();
            this._showPastePreview(file);
            return;
          }
        }
      }
      // Async fallback: Clipboard API (Linux/Wayland may not populate clipboardData
      // for images pasted into a text input)
      if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
        void navigator.clipboard.read().then((clipItems) => {
          for (const ci of clipItems) {
            for (const type of ci.types) {
              if (type.startsWith("image/")) {
                void ci.getType(type).then((blob) => this._showPastePreview(blob));
                return;
              }
            }
          }
        }).catch(() => { /* Clipboard API unavailable or permission denied */ });
      }
    });

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

    inputBar.appendChild(this._composeBoxEl);
    this._el.appendChild(inputBar);
  }

  /** Register a callback invoked when the field is clicked to enter insert mode. */
  onFocusEnterInsert(handler: () => void): void {
    this._onFocusEnterInsert = handler;
  }

  /** Register a callback for the emoji picker button. */
  onEmojiPickerClick(handler: () => void): void {
    this._onEmojiClick = handler;
  }

  /** Register a callback for the attach file button. */
  onAttachClick(handler: () => void): void {
    this._onAttachClick = handler;
  }

  /** Register a callback invoked when an image is pasted into the compose field. */
  onImagePaste(handler: (blob: Blob) => void): void {
    this._onImagePaste = handler;
  }

  /** Returns the inner input-bar div (used for scrollbar sync padding). */
  getInputBarElement(): HTMLElement {
    return this._inputBarEl;
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

  // ── Private ─────────────────────────────────────────────────────────────────

  private _showPastePreview(blob: Blob): void {
    this._pendingPasteBlob = blob;
    const url = URL.createObjectURL(blob);
    this._pastePreviewImg.src = url;
    // Clean up the old object URL when the image loads
    this._pastePreviewImg.onload = () => URL.revokeObjectURL(url);
    this._pastePreviewEl.style.display = "flex";
  }

  private _confirmPaste(): void {
    const blob = this._pendingPasteBlob;
    if (blob) {
      this._onImagePaste?.(blob);
    }
    this._cancelPaste();
  }

  private _cancelPaste(): void {
    this._pendingPasteBlob = null;
    this._pastePreviewImg.src = "";
    this._pastePreviewEl.style.display = "none";
  }

}
