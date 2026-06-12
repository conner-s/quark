// Help dialog — :commands and vim keybindings reference

import { keymapManager } from "../vim/keybindings.js";
import { DialogBase } from "./DialogBase.js";

interface CommandEntry {
  name: string;
  args: string;
  description: string;
}

interface BindingEntry {
  keys: string;
  mode: string;
  description: string;
  /** keymapManager action ID — used to look up the live binding */
  action?: string;
  /** keymapManager context for the action */
  context?: string;
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
  { name: "logout",   args: "",                  description: "Log out and return to login screen" },
  { name: "q / quit", args: "",                  description: "Close the application" },
];

const BINDINGS: BindingEntry[] = [
  // Mode transitions
  { keys: "i",       mode: "normal",   description: "Enter insert mode",               action: "mode-insert",     context: "global" },
  { keys: ":",       mode: "normal",   description: "Enter command mode",              action: "mode-command",    context: "global" },
  { keys: "v",       mode: "normal",   description: "Enter visual mode",               action: "mode-visual",     context: "global" },
  { keys: "Escape",  mode: "any",      description: "Return to normal mode / cancel" },
  // Timeline navigation (normal / timeline)
  { keys: "j / ↓",  mode: "normal",   description: "Select next message",             action: "nav-down",        context: "global" },
  { keys: "k / ↑",  mode: "normal",   description: "Select previous message",         action: "nav-up",          context: "global" },
  { keys: "gg",      mode: "normal",   description: "Jump to first message",           action: "jump-top",        context: "global" },
  { keys: "G",       mode: "normal",   description: "Jump to last message",            action: "jump-bottom",     context: "global" },
  // Room list navigation
  { keys: "j / k",   mode: "roomlist", description: "Navigate rooms" },
  { keys: "Enter",   mode: "roomlist", description: "Open selected room" },
  // Message actions
  { keys: "r",       mode: "normal",   description: "Reply to selected message",       action: "reply",           context: "global" },
  { keys: "e",       mode: "normal",   description: "React to selected message",       action: "react",           context: "global" },
  { keys: "E / c",   mode: "normal",   description: "Edit (revise) selected message",  action: "edit",            context: "global" },
  { keys: "dd",      mode: "normal",   description: "Redact (delete) selected message",action: "redact",          context: "global" },
  { keys: "t",       mode: "normal",   description: "Open thread for selected message",action: "open-thread",     context: "global" },
  { keys: "m",       mode: "normal",   description: "Toggle member list panel",        action: "toggle-members",  context: "global" },
  { keys: "P",       mode: "normal",   description: "Open profile dialog",             action: "open-profile",    context: "global" },
  { keys: "I",       mode: "normal",   description: "Open room info dialog",           action: "open-room-info",  context: "global" },
  { keys: "S",       mode: "normal",   description: "Edit presence status",            action: "edit-status",     context: "global" },
  { keys: "?",       mode: "normal",   description: "Open settings",                   action: "open-settings",   context: "global" },
  // Insert mode
  { keys: "Ctrl-e",  mode: "insert",   description: "Open emoji picker",              action: "emoji",           context: "insert" },
  { keys: "Ctrl-g",  mode: "insert",   description: "Open GIF picker",                action: "gif",             context: "insert" },
  { keys: "Enter",   mode: "insert",   description: "Send message" },
  { keys: ":word:",  mode: "insert",   description: "Shortcode emoji autocomplete" },
];

type Section = "bindings" | "commands";

/** Keyboard-navigable command and keybinding reference overlay. */
export class HelpDialog extends DialogBase {
  private _titleEl: HTMLElement;
  private _contentEl: HTMLElement;

  private _activeSection: Section = "bindings";
  private _tabBindings: HTMLElement;
  private _tabCommands: HTMLElement;

  private _focusIndex = 0;
  private _rows: HTMLElement[] = [];

  constructor() {
    super({ prefix: "help-dialog", ariaLabel: "Help" });

    // ── Header (title text is set per-section in _switchSection) ───────────
    this.buildHeader("", "Close help");
    this._titleEl = this.titleEl!;

    // ── Tab bar ───────────────────────────────────────────────────────────
    const tabs = document.createElement("div");
    tabs.className = "help-dialog__tabs";
    tabs.setAttribute("role", "tablist");
    this.content.appendChild(tabs);

    this._tabBindings = this._makeTab("Keybindings", "Tab for :commands", "bindings", tabs);
    this._tabCommands = this._makeTab(":Commands", "Tab for keybindings", "commands", tabs);

    // ── Scrollable content ────────────────────────────────────────────────
    this._contentEl = document.createElement("div");
    this._contentEl.className = "help-dialog__content";
    this.content.appendChild(this._contentEl);

    // ── Footer ────────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.className = "help-dialog__footer";
    footer.textContent = "j/k navigate · Tab switch section · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this.content.appendChild(footer);
  }

  show(): void {
    this.reveal();
    this._switchSection("bindings");
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

    // Build a lookup: action → [sequences] from the live keymapManager
    const liveEntries = keymapManager.getEntries();
    const actionToSeqs = new Map<string, string[]>();
    for (const e of liveEntries) {
      const key = `${e.context}:${e.action}`;
      if (!actionToSeqs.has(key)) actionToSeqs.set(key, []);
      actionToSeqs.get(key)!.push(e.sequence);
    }

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

      // Check if there's a live binding for this action and whether it differs from the default
      let displayKeys = b.keys;
      let isCustomized = false;
      if (b.action && b.context) {
        const liveSeqs = actionToSeqs.get(`${b.context}:${b.action}`);
        if (liveSeqs && liveSeqs.length > 0) {
          const liveKey = liveSeqs.join(" / ");
          if (liveKey !== b.keys) {
            isCustomized = true;
            displayKeys = liveKey;
          }
        }
      }

      keysEl.textContent = displayKeys;
      if (isCustomized) {
        keysEl.title = `Remapped (default: ${b.keys})`;
        keysEl.style.color = "var(--accent-primary)";
      }
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

  protected override handleKeydown(e: KeyboardEvent): void {
    // Stop all keys from reaching the global handler while dialog is open
    e.stopPropagation();

    // Tab is overlay-specific (switch sections) — not remappable
    if (e.key === "Tab") {
      e.preventDefault();
      this._switchSection(this._activeSection === "bindings" ? "commands" : "bindings");
      return;
    }

    const result = keymapManager.resolveKey(e.key, "picker");

    if (result.kind === "action") {
      switch (result.action) {
        case "close":
          e.preventDefault();
          this.hide();
          break;
        case "nav-down":
          e.preventDefault();
          this._moveFocus(1);
          break;
        case "nav-up":
          e.preventDefault();
          this._moveFocus(-1);
          break;
        case "jump-top":
          e.preventDefault();
          this._moveFocus(-this._rows.length);
          break;
        case "jump-bottom":
          e.preventDefault();
          this._moveFocus(this._rows.length);
          break;
      }
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
  }
}
