// Settings dialog — Notifications, Media, and Themes tabs

import { keymapManager } from "../vim/keybindings.js";
import { getConfig, setNotificationConfig } from "../app/notifications.js";
import type { NotificationConfig } from "../app/notifications.js";
import { getCacheStats, clearMediaCache, setCacheSizeLimit } from "../ipc/media.js";
import type { CacheStats } from "../ipc/media.js";
import { loadTheme } from "../app/actions.js";

type SettingsTab = "notifications" | "media" | "themes";

const BUILTIN_THEMES = [
  "phosphor",
  "amber",
  "dracula",
  "nord",
  "solarized-dark",
  "solarized-light",
  "catppuccin-mocha",
  "catppuccin-latte",
  "gruvbox-dark",
  "high-contrast",
];

let _currentTheme = "phosphor";

export function setCurrentThemeName(name: string): void {
  _currentTheme = name;
}

export class SettingsDialog {
  private _el: HTMLElement;
  private _panelEl: HTMLElement;
  private _contentEl: HTMLElement;
  private _activeTab: SettingsTab = "notifications";

  private _tabEls: Record<SettingsTab, HTMLElement> = {} as Record<SettingsTab, HTMLElement>;

  constructor() {
    // Backdrop
    this._el = document.createElement("div");
    this._el.className = "settings-dialog";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Settings");
    this._el.setAttribute("aria-modal", "true");
    this._el.style.display = "none";

    this._el.addEventListener("click", (e) => {
      if (e.target === this._el) this.hide();
    });

    // Panel
    this._panelEl = document.createElement("div");
    this._panelEl.className = "settings-dialog__panel";
    this._panelEl.tabIndex = -1;
    this._el.appendChild(this._panelEl);

    // Header
    const header = document.createElement("div");
    header.className = "settings-dialog__header";

    const title = document.createElement("span");
    title.className = "settings-dialog__title";
    title.textContent = "── settings ──";
    header.appendChild(title);

    const closeHint = document.createElement("span");
    closeHint.className = "settings-dialog__close-hint";
    closeHint.textContent = "Esc";
    closeHint.setAttribute("aria-hidden", "true");
    header.appendChild(closeHint);

    this._panelEl.appendChild(header);

    // Tab bar
    const tabs = document.createElement("div");
    tabs.className = "settings-dialog__tabs";
    tabs.setAttribute("role", "tablist");

    this._tabEls.notifications = this._makeTab("Notifications", "notifications", tabs);
    this._tabEls.media = this._makeTab("Media", "media", tabs);
    this._tabEls.themes = this._makeTab("Themes", "themes", tabs);

    this._panelEl.appendChild(tabs);

    // Content area
    this._contentEl = document.createElement("div");
    this._contentEl.className = "settings-dialog__content";
    this._panelEl.appendChild(this._contentEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "settings-dialog__footer";
    footer.textContent = "Tab switch section · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this._panelEl.appendChild(footer);

    // Keyboard handler
    this._el.addEventListener("keydown", (e) => this._handleKeydown(e));
  }

  getElement(): HTMLElement { return this._el; }

  isVisible(): boolean { return this._el.style.display !== "none"; }

  show(): void {
    this._el.style.display = "flex";
    this._switchTab("notifications");
    this._panelEl.focus();
  }

  hide(): void {
    this._el.style.display = "none";
    keymapManager.resetSequence();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _makeTab(label: string, tab: SettingsTab, parent: HTMLElement): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__tab";
    btn.textContent = label;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => this._switchTab(tab));
    parent.appendChild(btn);
    return btn;
  }

  private _switchTab(tab: SettingsTab): void {
    this._activeTab = tab;

    for (const [key, el] of Object.entries(this._tabEls)) {
      if (key === tab) {
        el.classList.add("settings-dialog__tab--active");
        el.setAttribute("aria-selected", "true");
      } else {
        el.classList.remove("settings-dialog__tab--active");
        el.setAttribute("aria-selected", "false");
      }
    }

    this._contentEl.innerHTML = "";

    if (tab === "notifications") {
      void this._buildNotificationsTab();
    } else if (tab === "media") {
      void this._buildMediaTab();
    } else {
      this._buildThemesTab();
    }
  }

  private async _buildNotificationsTab(): Promise<void> {
    const section = document.createElement("div");
    section.className = "settings-dialog__section";

    const loading = document.createElement("div");
    loading.className = "settings-dialog__row";
    loading.textContent = "Loading...";
    section.appendChild(loading);
    this._contentEl.appendChild(section);

    let config: NotificationConfig;
    try {
      config = await getConfig();
    } catch {
      loading.textContent = "Failed to load notification config.";
      return;
    }

    section.innerHTML = "";

    const makeCheckbox = (label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement => {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";

      const lbl = document.createElement("label");
      lbl.className = "settings-dialog__checkbox-label";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cb.addEventListener("change", () => onChange(cb.checked));

      lbl.appendChild(cb);
      lbl.append(" " + label);
      row.appendChild(lbl);
      return row;
    };

    let draft = { ...config };

    section.appendChild(makeCheckbox("Enable notifications", draft.enabled, (v) => { draft = { ...draft, enabled: v }; }));
    section.appendChild(makeCheckbox("Show message preview", draft.show_body, (v) => { draft = { ...draft, show_body: v }; }));
    section.appendChild(makeCheckbox("Show sender name", draft.show_sender, (v) => { draft = { ...draft, show_sender: v }; }));

    // Quiet hours
    const qhSection = document.createElement("div");
    qhSection.className = "settings-dialog__section";

    const qhTitle = document.createElement("div");
    qhTitle.className = "settings-dialog__section-title";
    qhTitle.textContent = "Quiet Hours";
    qhSection.appendChild(qhTitle);

    const qhRow = document.createElement("div");
    qhRow.className = "settings-dialog__row settings-dialog__row--quiet-hours";

    const qhLabel = document.createElement("span");
    qhLabel.className = "settings-dialog__label";
    qhLabel.textContent = "start";
    qhRow.appendChild(qhLabel);

    const startInput = document.createElement("input");
    startInput.type = "time";
    startInput.className = "settings-dialog__time-input";
    if (draft.quiet_hours) {
      const h = String(draft.quiet_hours.start_hour).padStart(2, "0");
      const m = String(draft.quiet_hours.start_minute).padStart(2, "0");
      startInput.value = `${h}:${m}`;
    }
    qhRow.appendChild(startInput);

    const qhLabel2 = document.createElement("span");
    qhLabel2.className = "settings-dialog__label";
    qhLabel2.textContent = "end";
    qhRow.appendChild(qhLabel2);

    const endInput = document.createElement("input");
    endInput.type = "time";
    endInput.className = "settings-dialog__time-input";
    if (draft.quiet_hours) {
      const h = String(draft.quiet_hours.end_hour).padStart(2, "0");
      const m = String(draft.quiet_hours.end_minute).padStart(2, "0");
      endInput.value = `${h}:${m}`;
    }
    qhRow.appendChild(endInput);

    qhSection.appendChild(qhRow);

    // Save button
    const footer = document.createElement("div");
    footer.className = "settings-dialog__section settings-dialog__actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "settings-dialog__btn";
    saveBtn.textContent = "[save]";
    saveBtn.addEventListener("click", async () => {
      // Parse quiet hours
      let quiet_hours = null;
      if (startInput.value && endInput.value) {
        const [sh, sm] = startInput.value.split(":").map(Number);
        const [eh, em] = endInput.value.split(":").map(Number);
        quiet_hours = { start_hour: sh, start_minute: sm, end_hour: eh, end_minute: em };
      }
      const finalConfig: NotificationConfig = { ...draft, quiet_hours };
      try {
        await setNotificationConfig(finalConfig);
        saveBtn.textContent = "[saved!]";
        setTimeout(() => { saveBtn.textContent = "[save]"; }, 1500);
      } catch {
        saveBtn.textContent = "[error]";
        setTimeout(() => { saveBtn.textContent = "[save]"; }, 1500);
      }
    });
    footer.appendChild(saveBtn);

    section.appendChild(qhSection);
    section.appendChild(footer);
  }

  private async _buildMediaTab(): Promise<void> {
    const section = document.createElement("div");
    section.className = "settings-dialog__section";

    const loading = document.createElement("div");
    loading.className = "settings-dialog__row";
    loading.textContent = "Loading cache stats...";
    section.appendChild(loading);
    this._contentEl.appendChild(section);

    let stats: CacheStats | null = null;
    try {
      stats = await getCacheStats();
    } catch {
      loading.textContent = "Failed to load cache stats.";
      return;
    }

    section.innerHTML = "";

    const makeRow = (label: string, value: string): HTMLElement => {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "settings-dialog__label";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.className = "settings-dialog__value";
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      return row;
    };

    const fmtBytes = (b: number): string => {
      if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
      if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
      if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${b} B`;
    };

    section.appendChild(makeRow("Usage", `${stats.usage_percent.toFixed(1)}%`));
    section.appendChild(makeRow("Cached files", String(stats.entry_count)));
    section.appendChild(makeRow("Cache size", fmtBytes(stats.total_size_bytes)));
    section.appendChild(makeRow("Max size", fmtBytes(stats.max_size_bytes)));

    // Size limit row
    const limitRow = document.createElement("div");
    limitRow.className = "settings-dialog__row";
    const limitLabel = document.createElement("span");
    limitLabel.className = "settings-dialog__label";
    limitLabel.textContent = "max size (MB)";
    const limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.className = "settings-dialog__number-input";
    limitInput.value = String(Math.round(stats.max_size_bytes / 1024 / 1024));
    limitInput.min = "10";
    limitInput.max = "10000";
    const setLimitBtn = document.createElement("button");
    setLimitBtn.type = "button";
    setLimitBtn.className = "settings-dialog__btn";
    setLimitBtn.textContent = "[set]";
    setLimitBtn.addEventListener("click", async () => {
      const mb = parseInt(limitInput.value, 10);
      if (!isNaN(mb) && mb >= 10) {
        try {
          await setCacheSizeLimit(mb);
          setLimitBtn.textContent = "[set!]";
          setTimeout(() => { setLimitBtn.textContent = "[set]"; }, 1500);
        } catch {
          setLimitBtn.textContent = "[err]";
          setTimeout(() => { setLimitBtn.textContent = "[set]"; }, 1500);
        }
      }
    });
    limitRow.appendChild(limitLabel);
    limitRow.appendChild(limitInput);
    limitRow.appendChild(setLimitBtn);
    section.appendChild(limitRow);

    // Actions
    const actionsRow = document.createElement("div");
    actionsRow.className = "settings-dialog__section settings-dialog__actions";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "settings-dialog__btn settings-dialog__btn--danger";
    clearBtn.textContent = "[clear cache]";
    clearBtn.addEventListener("click", async () => {
      try {
        await clearMediaCache();
        clearBtn.textContent = "[cleared!]";
        setTimeout(() => { clearBtn.textContent = "[clear cache]"; }, 1500);
      } catch {
        clearBtn.textContent = "[error]";
        setTimeout(() => { clearBtn.textContent = "[clear cache]"; }, 1500);
      }
    });
    actionsRow.appendChild(clearBtn);
    section.appendChild(actionsRow);
  }

  private _buildThemesTab(): void {
    const section = document.createElement("div");
    section.className = "settings-dialog__section";

    const note = document.createElement("div");
    note.className = "settings-dialog__section-title";
    note.textContent = "Built-in themes — click to apply";
    section.appendChild(note);

    for (const name of BUILTIN_THEMES) {
      const row = document.createElement("div");
      row.className = "settings-dialog__row settings-dialog__row--theme";

      const nameEl = document.createElement("button");
      nameEl.type = "button";
      nameEl.className = "settings-dialog__theme-btn";
      nameEl.textContent = name;
      nameEl.addEventListener("click", () => {
        void loadTheme(name);
        _currentTheme = name;
        // Update the current indicator
        for (const el of section.querySelectorAll(".settings-dialog__current")) {
          el.remove();
        }
        const cur = document.createElement("span");
        cur.className = "settings-dialog__current";
        cur.textContent = "(current)";
        row.appendChild(cur);
      });

      row.appendChild(nameEl);

      if (name === _currentTheme) {
        const cur = document.createElement("span");
        cur.className = "settings-dialog__current";
        cur.textContent = "(current)";
        row.appendChild(cur);
      }

      section.appendChild(row);
    }

    this._contentEl.appendChild(section);
  }

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.key === "Tab") {
      e.preventDefault();
      const tabs: SettingsTab[] = ["notifications", "media", "themes"];
      const idx = tabs.indexOf(this._activeTab);
      this._switchTab(tabs[(idx + 1) % tabs.length]);
      return;
    }

    if (e.ctrlKey && e.key === "[") {
      e.preventDefault();
      this.hide();
      return;
    }

    const result = keymapManager.resolveKey(e.key, "picker");
    if (result.kind === "action" && result.action === "close") {
      e.preventDefault();
      this.hide();
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
  }
}
