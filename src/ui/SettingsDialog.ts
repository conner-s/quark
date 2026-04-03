// Settings dialog — General, Media, GIF, Emoji, Notifications, Themes tabs

import { keymapManager } from "../vim/keybindings.js";
import { getConfig, setNotificationConfig } from "../app/notifications.js";
import type { NotificationConfig } from "../app/notifications.js";
import { getCacheStats, clearMediaCache, setCacheSizeLimit } from "../ipc/media.js";
import type { CacheStats } from "../ipc/media.js";
import { getAppConfig, setAppConfig } from "../ipc/app_config.js";
import type { AppConfig } from "../ipc/app_config.js";
import { loadTheme } from "../app/actions.js";

type SettingsTab = "general" | "media" | "gif" | "emoji" | "notifications" | "themes";

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
  private _activeTab: SettingsTab = "general";

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

    this._tabEls.general = this._makeTab("General", "general", tabs);
    this._tabEls.media = this._makeTab("Media", "media", tabs);
    this._tabEls.gif = this._makeTab("GIF", "gif", tabs);
    this._tabEls.emoji = this._makeTab("Emoji", "emoji", tabs);
    this._tabEls.notifications = this._makeTab("Notifications", "notifications", tabs);
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
    this._switchTab("general");
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

    switch (tab) {
      case "general":       void this._buildGeneralTab(); break;
      case "media":         void this._buildMediaTab(); break;
      case "gif":           void this._buildGifTab(); break;
      case "emoji":         void this._buildEmojiTab(); break;
      case "notifications": void this._buildNotificationsTab(); break;
      case "themes":        this._buildThemesTab(); break;
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────────────

  private _makeCheckbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
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
  }

  private _makeNumberRow(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-dialog__row";
    const lbl = document.createElement("span");
    lbl.className = "settings-dialog__label";
    lbl.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "settings-dialog__number-input";
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.addEventListener("change", () => {
      const v = parseInt(input.value, 10);
      if (!isNaN(v)) onChange(v);
    });
    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  }

  private _makeSelectRow(label: string, value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-dialog__row";
    const lbl = document.createElement("span");
    lbl.className = "settings-dialog__label";
    lbl.textContent = label;
    const sel = document.createElement("select");
    sel.className = "settings-dialog__select";
    for (const [val, display] of options) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = display;
      if (val === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    row.appendChild(lbl);
    row.appendChild(sel);
    return row;
  }

  private _makeTextRow(label: string, value: string, placeholder: string, onChange: (v: string) => void): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-dialog__row";
    const lbl = document.createElement("span");
    lbl.className = "settings-dialog__label";
    lbl.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "settings-dialog__text-input";
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", () => onChange(input.value));
    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  }

  private _makeSaveButton(onClick: () => Promise<void>): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__btn";
    btn.textContent = "[save]";
    btn.addEventListener("click", async () => {
      try {
        await onClick();
        btn.textContent = "[saved!]";
      } catch {
        btn.textContent = "[error]";
      }
      setTimeout(() => { btn.textContent = "[save]"; }, 1500);
    });
    return btn;
  }

  private _makeSectionTitle(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "settings-dialog__section-title";
    el.textContent = text;
    return el;
  }

  private _makeLoadingSection(): { section: HTMLElement; loading: HTMLElement } {
    const section = document.createElement("div");
    section.className = "settings-dialog__section";
    const loading = document.createElement("div");
    loading.className = "settings-dialog__row";
    loading.textContent = "Loading...";
    section.appendChild(loading);
    this._contentEl.appendChild(section);
    return { section, loading };
  }

  // ── General tab ───────────────────────────────────────────────────────────────

  private async _buildGeneralTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

    let cfg: AppConfig;
    try {
      cfg = await getAppConfig();
    } catch {
      loading.textContent = "Failed to load config.";
      return;
    }

    section.innerHTML = "";
    section.appendChild(this._makeSectionTitle("General"));

    let draft = structuredClone(cfg);

    section.appendChild(this._makeCheckbox(
      "Confirm before redacting messages",
      draft.general.confirm_redact,
      (v) => { draft = { ...draft, general: { ...draft.general, confirm_redact: v } }; },
    ));

    section.appendChild(this._makeSectionTitle("Sync"));

    section.appendChild(this._makeCheckbox(
      "Use Sliding Sync (MSC4186)",
      draft.sync.sliding_sync,
      (v) => { draft = { ...draft, sync: { ...draft.sync, sliding_sync: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Timeline messages to load",
      draft.sync.timeline_limit,
      10, 500,
      (v) => { draft = { ...draft, sync: { ...draft.sync, timeline_limit: v } }; },
    ));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__section settings-dialog__actions";
    actions.appendChild(this._makeSaveButton(() => setAppConfig(draft)));
    section.appendChild(actions);
  }

  // ── Media tab ─────────────────────────────────────────────────────────────────

  private async _buildMediaTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

    let cfg: AppConfig | null = null;
    let stats: CacheStats | null = null;

    try {
      [cfg, stats] = await Promise.all([getAppConfig(), getCacheStats()]);
    } catch {
      loading.textContent = "Failed to load media config.";
      return;
    }

    section.innerHTML = "";
    section.appendChild(this._makeSectionTitle("Image Display"));

    let draft = structuredClone(cfg);

    section.appendChild(this._makeCheckbox(
      "Auto-load inline images",
      draft.media.auto_load_images,
      (v) => { draft = { ...draft, media: { ...draft.media, auto_load_images: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Max image width (px)",
      draft.media.max_image_width,
      100, 4096,
      (v) => { draft = { ...draft, media: { ...draft.media, max_image_width: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Max image height (px)",
      draft.media.max_image_height,
      100, 4096,
      (v) => { draft = { ...draft, media: { ...draft.media, max_image_height: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Sticker max size (px)",
      draft.media.sticker_max_size,
      32, 1024,
      (v) => { draft = { ...draft, media: { ...draft.media, sticker_max_size: v } }; },
    ));

    section.appendChild(this._makeSectionTitle("Cache"));

    // Cache stats (read-only)
    const fmtBytes = (b: number): string => {
      if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
      if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
      if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${b} B`;
    };

    const makeReadRow = (label: string, value: string): HTMLElement => {
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

    section.appendChild(makeReadRow("Usage", `${stats.usage_percent.toFixed(1)}%`));
    section.appendChild(makeReadRow("Cached files", String(stats.entry_count)));
    section.appendChild(makeReadRow("Cache size", fmtBytes(stats.total_size_bytes)));

    section.appendChild(this._makeNumberRow(
      "Cache size limit (MB)",
      draft.media.cache_size_mb,
      10, 10000,
      (v) => { draft = { ...draft, media: { ...draft.media, cache_size_mb: v } }; },
    ));

    // Actions row: save + clear cache
    const actions = document.createElement("div");
    actions.className = "settings-dialog__section settings-dialog__actions";
    actions.appendChild(this._makeSaveButton(() => setAppConfig(draft)));

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "settings-dialog__btn settings-dialog__btn--danger";
    clearBtn.textContent = "[clear cache]";
    clearBtn.addEventListener("click", async () => {
      try {
        await clearMediaCache();
        clearBtn.textContent = "[cleared!]";
      } catch {
        clearBtn.textContent = "[error]";
      }
      setTimeout(() => { clearBtn.textContent = "[clear cache]"; }, 1500);
    });
    actions.appendChild(clearBtn);

    section.appendChild(actions);
  }

  // ── GIF tab ───────────────────────────────────────────────────────────────────

  private async _buildGifTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

    let cfg: AppConfig;
    try {
      cfg = await getAppConfig();
    } catch {
      loading.textContent = "Failed to load config.";
      return;
    }

    section.innerHTML = "";
    section.appendChild(this._makeSectionTitle("GIF Provider"));

    let draft = structuredClone(cfg);

    section.appendChild(this._makeSelectRow(
      "Provider",
      draft.gif.provider,
      [["tenor", "Tenor"], ["giphy", "Giphy"]],
      (v) => { draft = { ...draft, gif: { ...draft.gif, provider: v as "tenor" | "giphy" } }; },
    ));

    section.appendChild(this._makeTextRow(
      "API key",
      draft.gif.api_key,
      "paste your API key here",
      (v) => { draft = { ...draft, gif: { ...draft.gif, api_key: v } }; },
    ));

    section.appendChild(this._makeSelectRow(
      "Content rating",
      draft.gif.rating,
      [["g", "G"], ["pg", "PG"], ["pg-13", "PG-13"], ["r", "R"]],
      (v) => { draft = { ...draft, gif: { ...draft.gif, rating: v as "g" | "pg" | "pg-13" | "r" } }; },
    ));

    section.appendChild(this._makeCheckbox(
      "Cache search results",
      draft.gif.cache_results,
      (v) => { draft = { ...draft, gif: { ...draft.gif, cache_results: v } }; },
    ));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__section settings-dialog__actions";
    actions.appendChild(this._makeSaveButton(() => setAppConfig(draft)));
    section.appendChild(actions);
  }

  // ── Emoji tab ─────────────────────────────────────────────────────────────────

  private async _buildEmojiTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

    let cfg: AppConfig;
    try {
      cfg = await getAppConfig();
    } catch {
      loading.textContent = "Failed to load config.";
      return;
    }

    section.innerHTML = "";
    section.appendChild(this._makeSectionTitle("Emoji Autocomplete"));

    let draft = structuredClone(cfg);

    section.appendChild(this._makeCheckbox(
      "Enable :shortcode autocomplete",
      draft.emoji.shortcode_autocomplete,
      (v) => { draft = { ...draft, emoji: { ...draft.emoji, shortcode_autocomplete: v } }; },
    ));

    section.appendChild(this._makeNumberRow(
      "Min chars to trigger autocomplete",
      draft.emoji.autocomplete_min_chars,
      1, 10,
      (v) => { draft = { ...draft, emoji: { ...draft.emoji, autocomplete_min_chars: v } }; },
    ));

    const actions = document.createElement("div");
    actions.className = "settings-dialog__section settings-dialog__actions";
    actions.appendChild(this._makeSaveButton(() => setAppConfig(draft)));
    section.appendChild(actions);
  }

  // ── Notifications tab ─────────────────────────────────────────────────────────

  private async _buildNotificationsTab(): Promise<void> {
    const { section, loading } = this._makeLoadingSection();

    let config: NotificationConfig;
    try {
      config = await getConfig();
    } catch {
      loading.textContent = "Failed to load notification config.";
      return;
    }

    section.innerHTML = "";

    let draft = { ...config };

    section.appendChild(this._makeCheckbox("Enable notifications", draft.enabled, (v) => { draft = { ...draft, enabled: v }; }));
    section.appendChild(this._makeCheckbox("Show message preview", draft.show_body, (v) => { draft = { ...draft, show_body: v }; }));
    section.appendChild(this._makeCheckbox("Show sender name", draft.show_sender, (v) => { draft = { ...draft, show_sender: v }; }));

    // Quiet hours
    const qhSection = document.createElement("div");
    qhSection.className = "settings-dialog__section";
    qhSection.appendChild(this._makeSectionTitle("Quiet Hours"));

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

    const footer = document.createElement("div");
    footer.className = "settings-dialog__section settings-dialog__actions";

    const saveBtn = this._makeSaveButton(async () => {
      let quiet_hours = null;
      if (startInput.value && endInput.value) {
        const [sh, sm] = startInput.value.split(":").map(Number);
        const [eh, em] = endInput.value.split(":").map(Number);
        quiet_hours = { start_hour: sh, start_minute: sm, end_hour: eh, end_minute: em };
      }
      await setNotificationConfig({ ...draft, quiet_hours });
    });
    footer.appendChild(saveBtn);

    section.appendChild(qhSection);
    section.appendChild(footer);
  }

  // ── Themes tab ────────────────────────────────────────────────────────────────

  private _buildThemesTab(): void {
    const section = document.createElement("div");
    section.className = "settings-dialog__section";
    section.appendChild(this._makeSectionTitle("Built-in themes — click to apply"));

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

  // ── Keyboard handler ──────────────────────────────────────────────────────────

  private _handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.key === "Tab") {
      e.preventDefault();
      const tabs: SettingsTab[] = ["general", "media", "gif", "emoji", "notifications", "themes"];
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
