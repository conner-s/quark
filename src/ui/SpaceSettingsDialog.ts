// Space Settings Dialog — General + Children tabs
// Spaces are rooms with is_space=true; the same room settings commands apply.

import { AppState } from "../app/state.js";
import type { SpaceChild } from "../ipc/types.js";
import { setRoomName, setRoomTopic } from "../ipc/room_settings.js";
import { getSpaceChildren } from "../ipc/spaces.js";
import { DialogBase } from "./DialogBase.js";

type SpaceSettingsTab = "general" | "children";

export class SpaceSettingsDialog extends DialogBase {
  private _panelEl: HTMLElement;
  private _contentEl: HTMLElement;
  private _activeTab: SpaceSettingsTab = "general";
  private _tabEls: Record<SpaceSettingsTab, HTMLElement> = {} as Record<SpaceSettingsTab, HTMLElement>;
  // The space room ID to show settings for (set before calling show()).
  private _spaceId: string | null = null;

  constructor() {
    // Spaces share the `settings-dialog` styling.
    super({ prefix: "settings-dialog", ariaLabel: "Space Settings" });
    this._panelEl = this.content;

    // Header
    this.buildHeader("── space settings ──", "Close space settings");

    // Tabs
    const tabs = document.createElement("div");
    tabs.className = "settings-dialog__tabs";
    tabs.setAttribute("role", "tablist");
    this._tabEls.general = this._makeTab("General", "general", tabs);
    this._tabEls.children = this._makeTab("Children", "children", tabs);
    this._panelEl.appendChild(tabs);

    // Content
    this._contentEl = document.createElement("div");
    this._contentEl.className = "settings-dialog__content";
    this._panelEl.appendChild(this._contentEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "settings-dialog__footer";
    footer.textContent = "Tab switch section · Esc close";
    footer.setAttribute("aria-hidden", "true");
    this._panelEl.appendChild(footer);
  }

  async show(spaceId?: string): Promise<void> {
    this._spaceId = spaceId ?? AppState.snapshot.currentSpaceId ?? null;
    this.reveal();
    await this._switchTab("general");
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _makeTab(label: string, tab: SpaceSettingsTab, parent: HTMLElement): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__tab";
    btn.textContent = label;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => void this._switchTab(tab));
    parent.appendChild(btn);
    return btn;
  }

  private async _switchTab(tab: SpaceSettingsTab): Promise<void> {
    this._activeTab = tab;
    for (const [key, el] of Object.entries(this._tabEls)) {
      el.classList.toggle("settings-dialog__tab--active", key === tab);
      el.setAttribute("aria-selected", key === tab ? "true" : "false");
    }
    this._contentEl.innerHTML = "";
    switch (tab) {
      case "general":  await this._buildGeneralTab();  break;
      case "children": await this._buildChildrenTab(); break;
    }
  }

  private _makeSection(): HTMLElement {
    const s = document.createElement("div");
    s.className = "settings-dialog__section";
    this._contentEl.appendChild(s);
    return s;
  }

  private _makeTitle(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "settings-dialog__section-title";
    el.textContent = text;
    return el;
  }

  private _makeSaveButton(label: string, onClick: () => Promise<void>): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__btn";
    btn.textContent = `[${label}]`;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "[saving...]";
      try {
        await onClick();
        btn.textContent = "[saved!]";
      } catch (err) {
        btn.textContent = "[error]";
        console.error("Space settings save error:", err);
      }
      setTimeout(() => {
        btn.textContent = `[${label}]`;
        btn.disabled = false;
      }, 2000);
    });
    return btn;
  }

  // ── General tab ───────────────────────────────────────────────────────────────

  private async _buildGeneralTab(): Promise<void> {
    const spaceId = this._spaceId;
    if (!spaceId) {
      this._makeSection().appendChild(this._makeTitle("No space selected."));
      return;
    }

    // Try to get space info from the spaces cache or room list
    const state = AppState.snapshot;
    const spaceInfo = state.roomListCache.find((r) => r.room_id === spaceId);

    const section = this._makeSection();
    section.appendChild(this._makeTitle("Space Identity"));

    let draft = {
      name: spaceInfo?.name ?? "",
      topic: spaceInfo?.topic ?? "",
    };

    const makeTextRow = (label: string, value: string, placeholder: string, onChange: (v: string) => void): void => {
      const { row } = this.makeTextRow(label, value, placeholder, onChange, "room-settings-dialog__wide-input");
      section.appendChild(row);
    };

    makeTextRow("name", draft.name, "Space name", (v) => { draft = { ...draft, name: v }; });
    makeTextRow("topic", draft.topic, "Space description", (v) => { draft = { ...draft, topic: v }; });

    const infoSection = this._makeSection();
    infoSection.appendChild(this._makeTitle("Space Info"));
    const addInfo = (label: string, value: string): void => {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "settings-dialog__label";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.className = "settings-dialog__value settings-dialog__value--muted";
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      infoSection.appendChild(row);
    };
    addInfo("space id", spaceId);
    addInfo("members", String(spaceInfo?.member_count ?? "?"));

    const actions = this._makeSection();
    actions.className += " settings-dialog__actions";
    actions.appendChild(this._makeSaveButton("save", async () => {
      const tasks: Promise<void>[] = [];
      if (draft.name !== (spaceInfo?.name ?? "")) {
        tasks.push(setRoomName(spaceId, draft.name));
      }
      if (draft.topic !== (spaceInfo?.topic ?? "")) {
        tasks.push(setRoomTopic(spaceId, draft.topic));
      }
      await Promise.all(tasks);
    }));
  }

  // ── Children tab ──────────────────────────────────────────────────────────────

  private async _buildChildrenTab(): Promise<void> {
    const spaceId = this._spaceId;
    if (!spaceId) {
      this._makeSection().appendChild(this._makeTitle("No space selected."));
      return;
    }

    const loadingSection = this._makeSection();
    const loadingEl = document.createElement("div");
    loadingEl.className = "settings-dialog__row";
    loadingEl.textContent = "Loading children…";
    loadingSection.appendChild(loadingEl);

    let children: SpaceChild[];
    try {
      children = await getSpaceChildren(spaceId);
    } catch (err) {
      loadingEl.textContent = `Failed to load children: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }

    loadingSection.innerHTML = "";
    loadingSection.appendChild(this._makeTitle(`Children (${children.length})`));

    if (children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-dialog__row";
      empty.style.color = "var(--roomlist-muted)";
      empty.textContent = "(no children)";
      loadingSection.appendChild(empty);
    }

    for (const child of children) {
      const row = document.createElement("div");
      row.className = "settings-dialog__row space-settings-dialog__child-row";

      const typeTag = document.createElement("span");
      typeTag.className = "settings-dialog__label";
      typeTag.textContent = child.is_space ? "[space]" : "[room]";
      typeTag.style.minWidth = "60px";
      typeTag.style.color = child.is_space ? "var(--accent-secondary)" : "var(--roomlist-muted)";

      const nameEl = document.createElement("span");
      nameEl.className = "settings-dialog__value";
      nameEl.textContent = child.name ?? child.room_id;
      if (child.topic) {
        nameEl.title = child.topic;
      }

      const membersEl = document.createElement("span");
      membersEl.className = "settings-dialog__value--muted";
      membersEl.style.marginLeft = "auto";
      membersEl.style.fontSize = "calc(var(--font-size) - 2px)";
      membersEl.textContent = child.member_count != null ? `${child.member_count} members` : "";

      row.appendChild(typeTag);
      row.appendChild(nameEl);
      row.appendChild(membersEl);
      loadingSection.appendChild(row);
    }
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────────

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const tabs: SpaceSettingsTab[] = ["general", "children"];
      const idx = tabs.indexOf(this._activeTab);
      void this._switchTab(tabs[(idx + 1) % tabs.length]);
      return;
    }

    if (this.isEscape(e)) {
      e.preventDefault();
      this.hide();
      return;
    }

    this.routeKey(e);
  }
}
