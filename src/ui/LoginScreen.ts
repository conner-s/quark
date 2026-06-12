// Terminal-styled login screen for Quark

export type LoginCallback = (homeserver: string, username: string, password: string) => void | Promise<void>;

const ASCII_BANNER = `  ██████  ██    ██  █████  ██████  ██   ██
 ██    ██ ██    ██ ██   ██ ██   ██ ██  ██
 ██    ██ ██    ██ ███████ ██████  █████
 ██ ▄▄ ██ ██    ██ ██   ██ ██   ██ ██  ██
  ██████   ██████  ██   ██ ██   ██ ██   ██
     ▀▀
`;

type FieldName = "homeserver" | "username" | "password";
const FIELDS: FieldName[] = ["homeserver", "username", "password"];

export class LoginScreen {
  private _el: HTMLElement;
  private _statusEl: HTMLElement;
  private _inputs: Record<FieldName, HTMLInputElement>;
  private _submitBtn: HTMLButtonElement;
  private _onLogin: LoginCallback | null = null;
  private _activeField: number = 0;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "login-screen";
    this._el.setAttribute("role", "main");
    this._el.setAttribute("aria-label", "Quark login");

    // ── Banner ──────────────────────────────────────────────────────────────
    const banner = document.createElement("pre");
    banner.className = "login-screen__banner";
    banner.setAttribute("aria-hidden", "true");
    banner.textContent = ASCII_BANNER;
    this._el.appendChild(banner);

    // ── Tagline ─────────────────────────────────────────────────────────────
    const tagline = document.createElement("p");
    tagline.className = "login-screen__tagline";
    tagline.textContent = "a cli-styled matrix client";
    this._el.appendChild(tagline);

    // ── Divider ─────────────────────────────────────────────────────────────
    const divider = document.createElement("div");
    divider.className = "login-screen__divider";
    divider.setAttribute("aria-hidden", "true");
    divider.textContent = "─".repeat(42);
    this._el.appendChild(divider);

    // ── Form ────────────────────────────────────────────────────────────────
    const form = document.createElement("form");
    form.className = "login-screen__form";
    form.setAttribute("autocomplete", "off");
    form.setAttribute("novalidate", "");

    this._inputs = {
      homeserver: this._createField(form, "homeserver", "Homeserver URL", "https://matrix.org", "url"),
      username: this._createField(form, "username", "Username", "@user:matrix.org", "text"),
      password: this._createField(form, "password", "Password", "••••••••", "password"),
    };

    // ── Submit button ────────────────────────────────────────────────────────
    this._submitBtn = document.createElement("button");
    this._submitBtn.type = "submit";
    this._submitBtn.className = "login-screen__submit";
    this._submitBtn.textContent = "[ CONNECT ]";
    form.appendChild(this._submitBtn);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this._handleSubmit();
    });

    this._el.appendChild(form);

    // ── Status / error line ──────────────────────────────────────────────────
    this._statusEl = document.createElement("div");
    this._statusEl.className = "login-screen__status";
    this._statusEl.setAttribute("role", "status");
    this._statusEl.setAttribute("aria-live", "polite");
    this._el.appendChild(this._statusEl);

    // ── Key hints ───────────────────────────────────────────────────────────
    const hints = document.createElement("p");
    hints.className = "login-screen__hints";
    hints.setAttribute("aria-hidden", "true");
    hints.textContent = "<Tab> next field  <Enter> connect  <Esc> clear";
    this._el.appendChild(hints);

    // ── Keyboard navigation ──────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));

    // Focus the first field by default
    this._focusField(0);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getElement(): HTMLElement {
    return this._el;
  }

  show(): void {
    this._el.style.display = "";
    this._clearStatus();
    this._focusField(0);
  }

  hide(): void {
    this._el.style.display = "none";
  }

  onLogin(callback: LoginCallback): void {
    this._onLogin = callback;
  }

  /** Display a status message inline. type drives the CSS modifier. */
  setStatus(message: string, type: "info" | "error" | "success" = "info"): void {
    this._statusEl.textContent = `> ${message}`;
    this._statusEl.className = `login-screen__status login-screen__status--${type}`;
  }

  /** Enable/disable the form while a login attempt is in flight. */
  setLoading(loading: boolean): void {
    this._submitBtn.disabled = loading;
    this._submitBtn.textContent = loading ? "[ CONNECTING… ]" : "[ CONNECT ]";
    for (const input of Object.values(this._inputs)) {
      input.disabled = loading;
    }
    if (loading) {
      this.setStatus("connecting…", "info");
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _createField(
    form: HTMLElement,
    name: FieldName,
    label: string,
    placeholder: string,
    type: string
  ): HTMLInputElement {
    const row = document.createElement("div");
    row.className = "login-screen__field";

    const prompt = document.createElement("span");
    prompt.className = "login-screen__field-prompt";
    prompt.setAttribute("aria-hidden", "true");
    prompt.textContent = ":>";
    row.appendChild(prompt);

    const labelEl = document.createElement("label");
    labelEl.className = "login-screen__field-label";
    labelEl.htmlFor = `login-${name}`;
    labelEl.textContent = `${label}:`;
    row.appendChild(labelEl);

    const input = document.createElement("input");
    input.type = type;
    input.id = `login-${name}`;
    input.name = name;
    input.className = "login-screen__field-input";
    input.placeholder = placeholder;
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");

    if (name === "homeserver") {
      input.value = "https://matrix.org";
    }

    input.addEventListener("focus", () => {
      this._activeField = FIELDS.indexOf(name);
      row.classList.add("login-screen__field--focused");
    });

    input.addEventListener("blur", () => {
      row.classList.remove("login-screen__field--focused");
    });

    row.appendChild(input);
    form.appendChild(row);

    return input;
  }

  private _focusField(index: number): void {
    const clamped = Math.max(0, Math.min(FIELDS.length - 1, index));
    this._activeField = clamped;
    this._inputs[FIELDS[clamped]]?.focus();
  }

  private _handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Tab") {
      e.preventDefault();
      const next = e.shiftKey
        ? this._activeField - 1
        : this._activeField + 1;
      this._focusField((next + FIELDS.length) % FIELDS.length);
    } else if (e.key === "Escape") {
      this._clearStatus();
      for (const input of Object.values(this._inputs)) {
        input.value = "";
      }
      if (this._inputs.homeserver) {
        this._inputs.homeserver.value = "https://matrix.org";
      }
      this._focusField(0);
    }
  }

  private async _handleSubmit(): Promise<void> {
    const homeserver = this._inputs.homeserver.value.trim();
    const username = this._inputs.username.value.trim();
    const password = this._inputs.password.value;

    if (!homeserver) {
      this.setStatus("homeserver URL is required", "error");
      this._focusField(0);
      return;
    }
    if (!username) {
      this.setStatus("username is required", "error");
      this._focusField(1);
      return;
    }
    if (!password) {
      this.setStatus("password is required", "error");
      this._focusField(2);
      return;
    }

    if (this._onLogin) {
      await this._onLogin(homeserver, username, password);
    }
  }

  private _clearStatus(): void {
    this._statusEl.textContent = "";
    this._statusEl.className = "login-screen__status";
  }
}
