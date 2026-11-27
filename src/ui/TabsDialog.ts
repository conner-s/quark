// Tabs dialog — show, hide, order, create and edit the room-list tabs.
//
//   ── tabs ──                                        [× Esc]
//   [x] ⌂ Home       │ name   [Home        ]  icon [⌂]
//   [x] ≡ All Rooms  │ place  [above spaces ▾]
//   [ ] ✉ DMs        │ shows  [x] direct messages
//   [x] # Groups     │ rooms  [in no space ▾]
//   [x] W Work       │ tags   [work, favourites]
//                    │ group  [by space ▾]   sort [by hand ▾]
//   [↑] [↓] [+ new]  │                    [reset] / [delete]
//
// A custom tab also chooses what it opens: a list (the rows above), or one
// room or DM — then a room picker and "picture" replace the list's rows.
//
// Every change saves as it is made (view_store.ts): selects and checkboxes at
// once, text fields when they lose focus or on Enter, so typing a name is one
// account-data write rather than one per key.

import { DialogBase } from "./DialogBase.js";
import { AppState } from "../app/state.js";
import {
  GROUP_OPTIONS,
  HOME_VIEW_ID,
  NEW_TAB_LABEL,
  SORT_OPTIONS,
  defaultIcon,
  formatTags,
  isBuiltinView,
  isShortcut,
  newView,
  parseTags,
  tagLabel,
  type RoomScope,
  type RoomView,
  type ViewGroupBy,
  type ViewPosition,
  type ViewSort,
} from "../app/room_views.js";
import {
  addView,
  allViews,
  canMoveView,
  getView,
  moveView,
  resetView,
  setViewHidden,
  updateView,
} from "../app/view_store.js";

const SCOPE_OPTIONS: [RoomScope, string][] = [
  ["all", "all rooms"],
  ["unspaced", "rooms in no space"],
  ["spaces", "rooms in chosen spaces"],
  ["none", "no rooms (DMs only)"],
];
const POSITION_OPTIONS: [ViewPosition, string][] = [
  ["top", "above spaces"],
  ["bottom", "below spaces"],
];
const OPENS_OPTIONS: [string, string][] = [
  ["list", "a list of rooms"],
  ["room", "one room or DM"],
];

/** What a tab turned into a shortcut opens first: the open room, else the first by name. */
function defaultShortcutRoom(): string | null {
  const rooms = AppState.get("roomListCache");
  const open = AppState.get("currentRoomId");
  if (open && rooms.some((r) => r.room_id === open)) return open;
  const first = [...rooms].sort((a, b) => (a.name ?? a.room_id).localeCompare(b.name ?? b.room_id))[0];
  return first?.room_id ?? null;
}

/**
 * Point a tab at `roomId`. A name that was still the default, or the old
 * room's, follows the room, and an icon that was still the name's initial
 * follows the name; a name or icon the user picked is left alone.
 */
function shortcutPatch(viewId: string, roomId: string): Partial<Omit<RoomView, "id">> {
  const view = getView(viewId);
  const rooms = AppState.get("roomListCache");
  const nameOf = (id: string | null) => {
    const r = id ? rooms.find((x) => x.room_id === id) : undefined;
    return r ? (r.name ?? r.room_id) : null;
  };
  const name = nameOf(roomId);
  if (!view || !name) return { roomId };
  const followLabel = view.label === NEW_TAB_LABEL || view.label === nameOf(view.roomId);
  if (!followLabel) return { roomId };
  const followIcon = view.icon === defaultIcon(view.label);
  return { roomId, label: name, ...(followIcon ? { icon: defaultIcon(name) } : {}) };
}

export class TabsDialog extends DialogBase {
  private _listEl: HTMLElement;
  private _editorEl: HTMLElement;
  private _selectedId: string | null = null;
  /** The room the editor's form was drawn for (null: a list tab's form). */
  private _editorRoomId: string | null = null;
  private _unbind: (() => void) | null = null;
  private _upBtn: HTMLButtonElement;
  private _downBtn: HTMLButtonElement;
  /** Hint listing tags already in use, for the tag fields. */
  private _knownTags: () => string[] = () => [];

  constructor() {
    super({ prefix: "settings-dialog", ariaLabel: "Tabs" });
    this.root.classList.add("tabs-dialog");
    this.buildHeader("── tabs ──", "Close");

    const body = document.createElement("div");
    body.className = "tabs-dialog__body";

    const side = document.createElement("div");
    side.className = "tabs-dialog__side";
    this._listEl = document.createElement("div");
    this._listEl.className = "tabs-dialog__list";
    this._listEl.setAttribute("role", "listbox");
    this._listEl.setAttribute("aria-label", "Tabs");
    side.appendChild(this._listEl);

    const listActions = document.createElement("div");
    listActions.className = "tabs-dialog__list-actions";
    this._upBtn = this._button("[↑]", "Move tab up", () => this._move(-1));
    this._downBtn = this._button("[↓]", "Move tab down", () => this._move(1));
    listActions.append(this._upBtn, this._downBtn, this._button("[+ new]", "New tab", () => this._create()));
    side.appendChild(listActions);

    this._editorEl = document.createElement("div");
    this._editorEl.className = "settings-dialog__content tabs-dialog__editor";

    body.append(side, this._editorEl);
    this.content.appendChild(body);
  }

  /** Where the tag fields' "in use" hint comes from. */
  setKnownTags(source: () => string[]): void {
    this._knownTags = source;
  }

  /** Open on `viewId`, or on the first tab. */
  show(viewId?: string): void {
    const views = allViews();
    this._selectedId = (viewId && views.some((v) => v.id === viewId) ? viewId : views[0]?.id) ?? null;
    this._renderList();
    this._renderEditor();
    this._unbind?.();
    // Keep the list current (names, visibility, another device's edits). The
    // editor is only rebuilt when the tab it shows goes away, so a sync
    // landing mid-edit can't take the field being typed in.
    this._unbind = AppState.on("roomViews", () => {
      this._renderList();
      const selected = this._selectedId ? getView(this._selectedId) : undefined;
      if (this._selectedId && !selected) {
        this._selectedId = allViews()[0]?.id ?? null;
        this._renderEditor();
      } else if (selected && selected.roomId !== this._editorRoomId) {
        // Now opens a room, another room, or lists again: a different form.
        this._renderEditor();
      }
    });
    this.reveal();
  }

  protected override onHide(): void {
    this._unbind?.();
    this._unbind = null;
  }

  protected override focusTarget(): HTMLElement {
    return this._listEl.querySelector<HTMLElement>(".tabs-dialog__item--selected") ?? this.content;
  }

  // ── List ───────────────────────────────────────────────────────────────────

  private _renderList(): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".tabs-dialog__item")?.dataset.viewId;
    this._listEl.innerHTML = "";
    const views = allViews();
    for (const position of ["top", "bottom"] as const) {
      const group = views.filter((v) => v.position === position);
      if (group.length === 0) continue;
      const heading = document.createElement("div");
      heading.className = "tabs-dialog__group";
      heading.textContent = position === "top" ? "above spaces" : "below spaces";
      this._listEl.appendChild(heading);
      for (const v of group) this._listEl.appendChild(this._createItem(v));
    }
    if (focusedId) this._listEl.querySelector<HTMLElement>(`[data-view-id="${CSS.escape(focusedId)}"]`)?.focus();
    this._syncMoveButtons();
  }

  private _createItem(v: RoomView): HTMLElement {
    const el = document.createElement("div");
    el.className = "tabs-dialog__item";
    el.classList.toggle("tabs-dialog__item--selected", v.id === this._selectedId);
    el.classList.toggle("tabs-dialog__item--hidden", v.hidden);
    el.dataset.viewId = v.id;
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", String(v.id === this._selectedId));
    el.tabIndex = 0;

    const shown = document.createElement("input");
    shown.type = "checkbox";
    shown.checked = !v.hidden;
    shown.title = v.hidden ? "Show on the strip" : "Hide from the strip";
    shown.setAttribute("aria-label", `Show ${v.label}`);
    shown.addEventListener("click", (e) => e.stopPropagation());
    shown.addEventListener("change", () => void setViewHidden(v.id, !shown.checked));

    const icon = document.createElement("span");
    icon.className = "tabs-dialog__icon";
    icon.textContent = v.icon;
    const name = document.createElement("span");
    name.className = "tabs-dialog__name";
    name.textContent = v.label;
    el.append(shown, icon, name);

    const select = () => {
      if (this._selectedId === v.id) return;
      this._selectedId = v.id;
      this._renderList();
      this._renderEditor();
    };
    el.addEventListener("click", select);
    el.addEventListener("keydown", (e) => {
      if (e.target !== el) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    });
    return el;
  }

  private _syncMoveButtons(): void {
    const id = this._selectedId;
    this._upBtn.disabled = !id || !canMoveView(id, -1);
    this._downBtn.disabled = !id || !canMoveView(id, 1);
  }

  private _move(delta: -1 | 1): void {
    if (this._selectedId) void moveView(this._selectedId, delta);
  }

  /** The new tab is in the list at once (the save follows), so edit it straight away. */
  private _create(): void {
    const view = newView("", allViews().map((v) => v.id));
    this._selectedId = view.id;
    void addView(view);
    this._renderEditor();
    this._editorEl.querySelector<HTMLInputElement>("input[aria-label='Tab name']")?.select();
  }

  // ── Editor ─────────────────────────────────────────────────────────────────

  private _renderEditor(): void {
    // A redraw for the tab's new kind or room keeps the control that made it focused.
    const active = document.activeElement as HTMLElement | null;
    const refocus = active && this._editorEl.contains(active) ? active.getAttribute("aria-label") : null;
    this._editorEl.innerHTML = "";
    const view = this._selectedId ? getView(this._selectedId) : undefined;
    this._editorRoomId = view?.roomId ?? null;
    if (!view) return;
    this._fillEditor(view);
    if (refocus) this._editorEl.querySelector<HTMLElement>(`[aria-label="${CSS.escape(refocus)}"]`)?.focus();
  }

  private _fillEditor(view: RoomView): void {
    const id = view.id;
    const save = (patch: Partial<Omit<RoomView, "id">>) => void updateView(id, patch);

    // Name and icon. Renaming a tab whose icon was its old initial keeps the
    // icon in step; one the user picked is left alone.
    const nameRow = this.makeTextRow("name", view.label, "Tab name", () => {});
    nameRow.input.setAttribute("aria-label", "Tab name");
    const icon = document.createElement("input");
    icon.type = "text";
    icon.className = "settings-dialog__text-input tabs-dialog__icon-input";
    icon.value = view.icon;
    icon.maxLength = 4;
    icon.setAttribute("aria-label", "Tab icon");
    icon.title = "One or two characters shown on the strip";
    nameRow.row.append(icon);
    commitOnChange(nameRow.input, (value) => {
      const current = getView(id);
      const label = value.trim() || current?.label || "Tab";
      const followIcon = current && current.icon === defaultIcon(current.label);
      save({ label, ...(followIcon ? { icon: defaultIcon(label) } : {}) });
      if (followIcon) icon.value = defaultIcon(label);
    });
    commitOnChange(icon, (value) => {
      const glyph = [...value.trim()].slice(0, 2).join("");
      if (glyph) save({ icon: glyph });
      else icon.value = getView(id)?.icon ?? "";
    });
    this._editorEl.appendChild(nameRow.row);

    this._editorEl.appendChild(
      this.makeSelectRow("place", view.position, POSITION_OPTIONS, (v) => save({ position: v as ViewPosition })),
    );

    if (id === HOME_VIEW_ID) {
      this._editorEl.appendChild(
        this._labelled("desktop", this.makeCheckbox("open the DM canvas instead of a list", view.canvas, (canvas) => save({ canvas }))),
      );
    }

    // A tab of your own can open one room or DM instead of listing.
    if (!isBuiltinView(id)) {
      // The editor redraws itself for the new kind (see `show`).
      const opens = this.makeSelectRow("opens", view.roomId ? "room" : "list", OPENS_OPTIONS, (v) => {
        if (v === "list") {
          void updateView(id, { roomId: null });
          return;
        }
        const target = defaultShortcutRoom();
        if (target) void updateView(id, shortcutPatch(id, target));
        else this._renderEditor(); // no room to open: stay a list
      });
      opens.querySelector("select")?.setAttribute("aria-label", "Tab opens");
      this._editorEl.appendChild(opens);
    }

    if (isShortcut(view)) this._renderShortcutRows(view);
    else this._renderListRows(view);

    const actions = document.createElement("div");
    actions.className = "settings-dialog__actions tabs-dialog__actions";
    if (isBuiltinView(id)) {
      actions.appendChild(this._button("[reset]", "Reset to how it ships", () => {
        void resetView(id).then(() => this._renderEditor());
      }));
    } else {
      const del = this._button("[delete]", "Delete this tab", () => this._onDelete?.(id));
      del.classList.add("settings-dialog__btn--danger");
      actions.appendChild(del);
    }
    this._editorEl.appendChild(actions);
    this._syncMoveButtons();
  }

  /** A shortcut tab's rows: which room it opens, and whether the strip shows its picture. */
  private _renderShortcutRows(view: RoomView & { roomId: string }): void {
    const id = view.id;
    const rooms = [...AppState.get("roomListCache")].sort((a, b) =>
      (a.name ?? a.room_id).localeCompare(b.name ?? b.room_id));
    const options: [string, string][] = rooms.map((r) => [r.room_id, `${r.name ?? r.room_id}${r.is_direct ? " · DM" : ""}`]);
    if (!rooms.some((r) => r.room_id === view.roomId)) options.unshift([view.roomId, "(a room you're not in)"]);
    const roomRow = this.makeSelectRow("room", view.roomId, options, (roomId) => {
      void updateView(id, shortcutPatch(id, roomId));
    });
    roomRow.querySelector("select")?.setAttribute("aria-label", "Room this tab opens");
    this._editorEl.appendChild(roomRow);

    const isDm = rooms.find((r) => r.room_id === view.roomId)?.is_direct ?? false;
    const label = isDm ? "show their profile picture on the strip" : "show the room's avatar on the strip";
    this._editorEl.appendChild(
      this._labelled("picture", this.makeCheckbox(label, view.avatar, (avatar) => void updateView(id, { avatar }))),
    );
  }

  /** A list tab's rows: what it keeps, and how it groups and sorts it. */
  private _renderListRows(view: RoomView): void {
    const id = view.id;
    const save = (patch: Partial<Omit<RoomView, "id">>) => void updateView(id, patch);

    // What it lists.
    this._editorEl.appendChild(this._labelled("shows", this.makeCheckbox("direct messages", view.dms, (dms) => save({ dms }))));
    const spacesRow = this._spacesRow(view, (spaces) => save({ spaces }));
    this._editorEl.appendChild(
      this.makeSelectRow("rooms", view.rooms, SCOPE_OPTIONS, (v) => {
        save({ rooms: v as RoomScope });
        spacesRow.hidden = v !== "spaces";
      }),
    );
    spacesRow.hidden = view.rooms !== "spaces";
    this._editorEl.appendChild(spacesRow);

    const known = this._knownTags().map(tagLabel).join(", ");
    const tagsRow = this.makeTextRow("tags", formatTags(view.tags), "any tag (e.g. work, favourites)", () => {});
    tagsRow.input.setAttribute("aria-label", "Only rooms with one of these tags");
    tagsRow.input.title = known ? `In use: ${known}` : "";
    commitOnChange(tagsRow.input, (value) => {
      const tags = parseTags(value);
      save({ tags });
      tagsRow.input.value = formatTags(tags);
    });
    this._editorEl.appendChild(tagsRow.row);

    const exceptRow = this.makeTextRow("except", formatTags(view.excludeTags), "leave out rooms tagged…", () => {});
    exceptRow.input.setAttribute("aria-label", "Leave out rooms with these tags");
    exceptRow.input.title = tagsRow.input.title;
    commitOnChange(exceptRow.input, (value) => {
      const excludeTags = parseTags(value);
      save({ excludeTags });
      exceptRow.input.value = formatTags(excludeTags);
    });
    this._editorEl.appendChild(exceptRow.row);

    const flags = document.createElement("div");
    flags.className = "tabs-dialog__flags";
    flags.append(
      this.makeCheckbox("unread only", view.unreadOnly, (unreadOnly) => save({ unreadOnly })),
      this.makeCheckbox("hide muted", view.hideMuted, (hideMuted) => save({ hideMuted })),
    );
    this._editorEl.appendChild(this._labelled("", flags));

    // How it lists them.
    this._editorEl.appendChild(
      this.makeSelectRow("group", view.groupBy, GROUP_OPTIONS, (v) => save({ groupBy: v as ViewGroupBy })),
    );
    this._editorEl.appendChild(
      this.makeSelectRow("sort", view.sort, SORT_OPTIONS, (v) => save({ sort: v as ViewSort })),
    );
  }

  private _onDelete: ((viewId: string) => void) | null = null;

  /** Delete asks first; the caller owns the confirmation. */
  onDelete(handler: (viewId: string) => void): void {
    this._onDelete = handler;
  }

  /** The space checklist for "rooms in chosen spaces". */
  private _spacesRow(view: RoomView, onChange: (spaces: string[]) => void): HTMLElement {
    const box = document.createElement("div");
    box.className = "tabs-dialog__spaces";
    const spaces = AppState.get("topLevelSpaces");
    if (spaces.length === 0) {
      const none = document.createElement("span");
      none.className = "tabs-dialog__hint";
      none.textContent = "You're not in any spaces.";
      box.appendChild(none);
    }
    const chosen = new Set(view.spaces);
    for (const s of spaces) {
      box.appendChild(this.makeCheckbox(s.name, chosen.has(s.id), (on) => {
        if (on) chosen.add(s.id);
        else chosen.delete(s.id);
        onChange(spaces.map((x) => x.id).filter((x) => chosen.has(x)));
      }));
    }
    return this._labelled("spaces", box);
  }

  /** A form row with a label column, around a control that has its own. */
  private _labelled(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement("div");
    row.className = "settings-dialog__row";
    const lbl = document.createElement("span");
    lbl.className = "settings-dialog__label";
    lbl.textContent = label;
    row.append(lbl, control);
    return row;
  }

  private _button(text: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__btn";
    btn.textContent = text;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", onClick);
    return btn;
  }
}

/** Run `commit` with the field's value when it changes and loses focus, or on Enter. */
function commitOnChange(input: HTMLInputElement, commit: (value: string) => void): void {
  let committed = input.value;
  const run = () => {
    if (input.value === committed) return;
    committed = input.value;
    commit(input.value);
    committed = input.value;
  };
  input.addEventListener("change", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });
}
