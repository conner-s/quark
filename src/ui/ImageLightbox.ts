// Image lightbox — full-screen viewer with zoom, pan, and download

export class ImageLightbox {
  private _el: HTMLElement;
  private _imgEl: HTMLImageElement;
  private _zoomLabel: HTMLElement;
  private _scale = 1;
  private _panX = 0;
  private _panY = 0;
  private _dragging = false;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _panStartX = 0;
  private _panStartY = 0;
  private _currentSrc = "";
  private _currentAlt = "";

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "image-lightbox";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Image viewer");
    this._el.setAttribute("aria-modal", "true");

    // Close on backdrop click (but not after a drag)
    this._el.addEventListener("click", (e) => {
      if (this._dragging) return;
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

    // Pan via mouse drag
    imgWrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this._dragging = false;
      this._dragStartX = e.clientX;
      this._dragStartY = e.clientY;
      this._panStartX = this._panX;
      this._panStartY = this._panY;
      imgWrap.style.cursor = "grabbing";
      // Suppress the CSS transition while dragging so the image tracks the
      // cursor exactly. Transitions restart on every transform change, which
      // at mousemove frequency (~60fps) causes a visible stutter/vibration.
      this._imgEl.style.transition = "none";

      const onMove = (me: MouseEvent) => {
        const dx = me.clientX - this._dragStartX;
        const dy = me.clientY - this._dragStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._dragging = true;
        this._panX = this._panStartX + dx;
        this._panY = this._panStartY + dy;
        this._applyTransform();
      };
      const onUp = () => {
        this._imgEl.style.transition = "";
        imgWrap.style.cursor = this._scale > 1 ? "grab" : "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        // Defer _dragging reset so the backdrop click handler sees it
        requestAnimationFrame(() => { this._dragging = false; });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    // Zoom with scroll wheel — suppress transition while scrolling (same
    // reason as drag: the 150ms ease restarts on every wheel event, causing
    // jitter on trackpads). Restore once scrolling pauses for 200ms.
    let _wheelDebounce: ReturnType<typeof setTimeout> | null = null;
    imgWrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      this._imgEl.style.transition = "none";
      if (_wheelDebounce !== null) clearTimeout(_wheelDebounce);
      _wheelDebounce = setTimeout(() => {
        this._imgEl.style.transition = "";
        _wheelDebounce = null;
      }, 200);
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      this._setScale(Math.min(5, Math.max(0.25, this._scale + delta)));
    }, { passive: false });

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
    this._panX = 0;
    this._panY = 0;
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
    if (scale <= 1) {
      this._panX = 0;
      this._panY = 0;
    }
    this._applyTransform();
    this._zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    this._imgWrap.style.cursor = scale > 1 ? "grab" : "";
  }

  private _applyTransform(): void {
    this._imgEl.style.transform =
      `translate(${this._panX}px, ${this._panY}px) scale(${this._scale})`;
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
        this._panX = 0;
        this._panY = 0;
        this._setScale(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        this._panX += 40;
        this._applyTransform();
        break;
      case "ArrowRight":
        e.preventDefault();
        this._panX -= 40;
        this._applyTransform();
        break;
      case "ArrowUp":
        e.preventDefault();
        this._panY += 40;
        this._applyTransform();
        break;
      case "ArrowDown":
        e.preventDefault();
        this._panY -= 40;
        this._applyTransform();
        break;
    }
  }
}
