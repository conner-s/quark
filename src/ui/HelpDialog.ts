// Help dialog — :commands and vim keybindings reference

interface CommandEntry {
  name: string;
  args: string;
  description: string;
}

interface BindingEntry {
  keys: string;
  mode: string;
  description: string;
}

const COMMANDS: CommandEntry[] = [
  { name: "join",     args: "<room-id|alias>",  description: "Join a room or space" },
  { name: "leave",    args: "[room-id]",         description: "Leave current or specified room" },
  { name: "invite",   args: "<user-id>",         description: "Invite a user to the current room" },
  { name: "kick",     args: "<user-id>",         description: "Kick a user from the current room" },
  { name: "ban",      args: "<user-id>",         description: "Ban a user from the current room" },
  { name: "unban",    args: "<user-id>",         description: "Unban a previously banned user" },
  { name: "msg",      args: "<user-id> <text>",  description: "Send a direct message to a user" },
  { name: "nick",     args: "<display-name>",    description: "Set your display name" },
  { name: "topic",    args: "<text>",            description: "Set the room topic" },
  { name: "theme",    args: "<name>",            description: "Load a colour theme by name" },
  { name: "upload",   args: "<path>",            description: "Upload a file to the current room" },
  { name: "verify",   args: "<user-id>",         description: "Start SAS verification with a user" },
  { name: "help",     args: "",                  description: "Show this help dialog" },
  { name: "q / quit", args: "",                  description: "Close the application" },
];

const BINDINGS: BindingEntry[] = [
  // Mode transitions
  { keys: "i",       mode: "normal",   description: "Enter insert mode" },
  { keys: ":",       mode: "normal",   description: "Enter command mode" },
  { keys: "v",       mode: "normal",   description: "Enter visual mode" },
  { keys: "Escape",  mode: "any",      description: "Return to normal mode" },
  // Timeline navigation (normal / timeline)
  { keys: "j / ↓",  mode: "normal",   description: "Select next message" },
  { keys: "k / ↑",  mode: "normal",   description: "Select previous message" },
  { keys: "gg",      mode: "normal",   description: "Jump to first message" },
  { keys: "G",       mode: "normal",   description: "Jump to last message" },
  // Room list navigation
  { keys: "j / k",   mode: "roomlist", description: "Navigate rooms" },
  { keys: "Enter",   mode: "roomlist", description: "Open selected room" },
  // Message actions
  { keys: "r",       mode: "normal",   description: "Reply to selected message" },
  { keys: "e",       mode: "normal",   description: "React to selected message" },
  { keys: "E",       mode: "normal",   description: "Edit selected message" },
  { keys: "dd",      mode: "normal",   description: "Redact (delete) selected message" },
  { keys: "t",       mode: "normal",   description: "Open thread for selected message" },
  { keys: "m",       mode: "normal",   description: "Toggle member list panel" },
  // Insert mode
  { keys: "Ctrl-e",  mode: "insert",   description: "Open emoji picker" },
  { keys: "Ctrl-g",  mode: "insert",   description: "Open GIF picker" },
  { keys: "Enter",   mode: "insert",   description: "Send message" },
  { keys: ":word:",  mode: "insert",   description: "Shortcode emoji autocomplete" },
];

type Section = "bindings" | "commands";

/** Keyboard-navigable command and keybinding reference overlay. */
export class HelpDialog {
  private _el: HTMLElement;
  private _panelEl: HTMLElement;
  private _titleEl: HTMLElement;
  private _contentEl: HTMLElement;

  private _activeSection: Section = "bindings";
  private _tabBindings: HTMLElement;
  private _tabCommands: HTMLElement;

  private _focusIndex = 0;
  private _rows: HTMLElement[] = [];

  constructor() {
    // ── Backdrop ─────────────────────────────────────────────────────────
    this._el = document.createElement("div");
    this._el.className = "help-dialog";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Help");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    // ── Panel ─────────────────────────────────────────────────────────────
    this._panelEl = document.createElement("div");
    this._panelEl.className = "help-dialog__panel";
    this._el.appendChild(this._panelEl);

    // ── Header ───────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "help-dialog__header";
    this._panelEl.appendChild(header);

    this._titleEl = document.createElement("span");
    this._titleEl.className = "help-dialog__title";
    header.appendChild(this._titleEl);

    const closeHint = document.createElement("span");
    closeHint.className = "help-dialog__close-hint";
    closeHint.textContent = "Esc";
    closeHint.setAttribute("aria-hidden", "true");
    header.appendChild(closeHint);

    // ── Tab bar ───────────────────────────────────────────────────────────
    const tabs = document.createElement("div");
    tabs.className = "help-dialog__tabs";
    tabs.setAttribute("role", "tablist");
    this._panelEl.appendChild(tabs);

    this._tabBindings = this._makeTab("Keybindings", "Tab for :commands", "bindings", tabs);
    this._tabCommands = this._makeTab(":Commands", "Tab for keybindings", "commands", tabs);

    // ── Scrollable content ────────────────────────────────────────────────
    this._contentEl = document.createElement("div");
    this._contentEl.className = "help-dialog__content";
    this._panelEl.appendChild(this._contentEl);

    // ── Footer ────────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.className = "help-dialog__footer";
    footer.textContent = "j/k navigate · Tab switch section · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this._panelEl.appendChild(footer);

    // ── Keyboard handling ────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement {
    return this._el;
  }

  show(): void {
    this._el.style.display = "flex";
    this._switchSection("bindings");
  }

  hide(): void {
    this._el.style.display = "none";
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _makeTab(label: string, hint: string, section: Section, parent: HTMLElement): HTMLElement {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "help-dialog__tab";
    tab.textContent = label;
    tab.title = hint;
    tab.setAttribute("role", "tab");
    tab.addEventListener("click", () => this._switchSection(section));
    parent.appendChild(tab);
    return tab;
  }

  private _switchSection(section: Section): void {
    this._activeSection = section;
    this._contentEl.innerHTML = "";
    this._rows = [];
    this._focusIndex = 0;

    if (section === "bindings") {
      this._titleEl.textContent = "help — keybindings";
      this._tabBindings.classList.add("help-dialog__tab--active");
      this._tabCommands.classList.remove("help-dialog__tab--active");
      this._tabBindings.setAttribute("aria-selected", "true");
      this._tabCommands.setAttribute("aria-selected", "false");
      this._buildBindingsTable();
    } else {
      this._titleEl.textContent = "help — :commands";
      this._tabCommands.classList.add("help-dialog__tab--active");
      this._tabBindings.classList.remove("help-dialog__tab--active");
      this._tabCommands.setAttribute("aria-selected", "true");
      this._tabBindings.setAttribute("aria-selected", "false");
      this._buildCommandsTable();
    }

    this._updateFocus();
    this._rows[0]?.focus();
  }

  private _buildHeadings(cols: string[]): void {
    const headings = document.createElement("div");
    headings.className = `help-dialog__headings help-dialog__headings--${this._activeSection}`;
    headings.setAttribute("aria-hidden", "true");
    for (const col of cols) {
      const span = document.createElement("span");
      span.textContent = col;
      headings.appendChild(span);
    }
    this._contentEl.appendChild(headings);
  }

  private _buildBindingsTable(): void {
    this._buildHeadings(["KEYS", "MODE", "DESCRIPTION"]);

    const table = document.createElement("div");
    table.className = "help-dialog__table";
    table.setAttribute("role", "list");

    for (let i = 0; i < BINDINGS.length; i++) {
      const b = BINDINGS[i];
      const row = document.createElement("div");
      row.className = "help-dialog__row help-dialog__row--bindings";
      row.setAttribute("role", "listitem");
      row.setAttribute("tabindex", i === 0 ? "0" : "-1");

      const keysEl = document.createElement("span");
      keysEl.className = "help-dialog__key";
      keysEl.textContent = b.keys;
      row.appendChild(keysEl);

      const modeEl = document.createElement("span");
      modeEl.className = "help-dialog__mode";
      modeEl.textContent = b.mode;
      row.appendChild(modeEl);

      const descEl = document.createElement("span");
      descEl.className = "help-dialog__cmd-desc";
      descEl.textContent = b.description;
      row.appendChild(descEl);

      this._rows.push(row);
      table.appendChild(row);
    }

    this._contentEl.appendChild(table);
  }

  private _buildCommandsTable(): void {
    this._buildHeadings(["COMMAND", "ARGS", "DESCRIPTION"]);

    const table = document.createElement("div");
    table.className = "help-dialog__table";
    table.setAttribute("role", "list");

    for (let i = 0; i < COMMANDS.length; i++) {
      const cmd = COMMANDS[i];
      const row = document.createElement("div");
      row.className = "help-dialog__row help-dialog__row--commands";
      row.setAttribute("role", "listitem");
      row.setAttribute("tabindex", i === 0 ? "0" : "-1");

      const nameEl = document.createElement("span");
      nameEl.className = "help-dialog__cmd-name";
      nameEl.textContent = `:${cmd.name}`;
      row.appendChild(nameEl);

      const argsEl = document.createElement("span");
      argsEl.className = "help-dialog__cmd-args";
      argsEl.textContent = cmd.args;
      row.appendChild(argsEl);

      const descEl = document.createElement("span");
      descEl.className = "help-dialog__cmd-desc";
      descEl.textContent = cmd.description;
      row.appendChild(descEl);

      this._rows.push(row);
      table.appendChild(row);
    }

    this._contentEl.appendChild(table);
  }

  private _updateFocus(): void {
    for (let i = 0; i < this._rows.length; i++) {
      this._rows[i].setAttribute("tabindex", i === this._focusIndex ? "0" : "-1");
    }
  }

  private _moveFocus(delta: number): void {
    this._focusIndex = Math.max(0, Math.min(this._focusIndex + delta, this._rows.length - 1));
    this._updateFocus();
    this._rows[this._focusIndex]?.focus();
  }

  private _handleKeydown(e: KeyboardEvent): void {
    // Stop all keys from reaching the global handler while dialog is open
    e.stopPropagation();

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        this.hide();
        return;

      case "Tab":
        e.preventDefault();
        this._switchSection(this._activeSection === "bindings" ? "commands" : "bindings");
        return;

      case "j":
      case "ArrowDown":
        e.preventDefault();
        this._moveFocus(1);
        return;

      case "k":
      case "ArrowUp":
        e.preventDefault();
        this._moveFocus(-1);
        return;

      case "g":
        e.preventDefault();
        this._moveFocus(-this._rows.length);
        return;

      case "G":
        e.preventDefault();
        this._moveFocus(this._rows.length);
        return;
    }
  }
}
