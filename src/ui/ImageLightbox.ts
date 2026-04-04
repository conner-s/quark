// Image lightbox — full-screen viewer with zoom and download

export class ImageLightbox {
  private _el: HTMLElement;
  private _imgEl: HTMLImageElement;
  private _zoomLabel: HTMLElement;
  private _scale = 1;
  private _currentSrc = "";
  private _currentAlt = "";

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "image-lightbox";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Image viewer");
    this._el.setAttribute("aria-modal", "true");

    // Close on backdrop click
    this._el.addEventListener("click", (e) => {
      if (e.target === this._el || e.target === this._imgWrap) this.hide();
    });

    // Image wrapper
    const imgWrap = document.createElement("div");
    imgWrap.className = "image-lightbox__img-wrap";
    this._imgWrap = imgWrap;

    this._imgEl = document.createElement("img");
    this._imgEl.className = "image-lightbox__img";
    this._imgEl.alt = "";
    imgWrap.appendChild(this._imgEl);
    this._el.appendChild(imgWrap);

    // Toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "image-lightbox__toolbar";

    const zoomInBtn = this._makeBtn("zoom +", () => this._zoom(0.25));
    const zoomOutBtn = this._makeBtn("zoom -", () => this._zoom(-0.25));
    const resetBtn = this._makeBtn("1:1", () => this._setScale(1));

    this._zoomLabel = document.createElement("span");
    this._zoomLabel.className = "image-lightbox__zoom-label";
    this._zoomLabel.textContent = "100%";

    const downloadBtn = this._makeBtn("⬇ download", () => this._download());
    const closeBtn = this._makeBtn("✕ close", () => this.hide());
    closeBtn.classList.add("image-lightbox__close");

    toolbar.appendChild(zoomOutBtn);
    toolbar.appendChild(zoomInBtn);
    toolbar.appendChild(resetBtn);
    toolbar.appendChild(this._zoomLabel);
    toolbar.appendChild(downloadBtn);
    toolbar.appendChild(closeBtn);
    this._el.appendChild(toolbar);

    // Keyboard handler
    this._el.addEventListener("keydown", (e) => this._handleKey(e));
  }

  private _imgWrap!: HTMLElement;

  getElement(): HTMLElement {
    return this._el;
  }

  isVisible(): boolean {
    return this._el.classList.contains("image-lightbox--open");
  }

  show(src: string, alt?: string): void {
    this._currentSrc = src;
    this._currentAlt = alt ?? "";
    this._imgEl.src = src;
    this._imgEl.alt = alt ?? "";
    this._setScale(1);
    this._el.classList.add("image-lightbox--open");
    this._el.setAttribute("tabindex", "-1");
    this._el.focus();
  }

  hide(): void {
    this._el.classList.remove("image-lightbox--open");
    this._imgEl.src = "";
    this._currentSrc = "";
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _makeBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "image-lightbox__btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private _zoom(delta: number): void {
    this._setScale(Math.min(5, Math.max(0.25, this._scale + delta)));
  }

  private _setScale(scale: number): void {
    this._scale = scale;
    this._imgEl.style.transform = `scale(${scale})`;
    this._zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  private _download(): void {
    if (!this._currentSrc) return;
    const a = document.createElement("a");
    a.href = this._currentSrc;
    a.download = this._currentAlt || "image";
    a.click();
  }

  private _handleKey(e: KeyboardEvent): void {
    e.stopPropagation();
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        this.hide();
        break;
      case "+":
      case "=":
        e.preventDefault();
        this._zoom(0.25);
        break;
      case "-":
        e.preventDefault();
        this._zoom(-0.25);
        break;
      case "0":
        e.preventDefault();
        this._setScale(1);
        break;
    }
  }
}
