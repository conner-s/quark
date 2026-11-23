// Builds context-menu contents from the action registry.
//
// The menus used to be ContextMenuEntry literals inline in keyboard.ts, each
// carrying a hardcoded `hint:` string — "r", "e", "dd". Those hints were wrong
// for anyone with a quarkrc: remap redact and the menu still advertised `dd`.
// A menu that prints a stale default is worse than one that prints nothing,
// because it answers the question the user actually had.
//
// So labels, ordering, grouping and section titles come from the registry,
// hints come from the live keymap, and the caller supplies only behaviour: a
// handler per action id. An action with no handler is dropped, which is also
// how a row earns conditional visibility that `requires` cannot express — the
// room menu offers "Mark as read" by passing a handler only when the room is
// actually unread, and the selection rows appear only when there is one.

import type { ContextMenuChip, ContextMenuEntry } from "../ui/ContextMenu.js";
import {
  MENU_SECTIONS,
  isAvailable,
  menuEntries,
  menuHint,
  type AvailabilityContext,
  type MenuSurface,
} from "./registry.js";

/** Behaviour for one row, when a bare handler does not say enough. */
export interface MenuRow {
  action: () => void;
  /** Listed but greyed and inert — Cut with nothing selected. */
  disabled?: boolean;
  /** Replaces the registry label, for rows that echo their target. */
  label?: string;
  /**
   * Chip rows only: whether the toggle currently applies. Re-read after every
   * activation, since chips leave the menu open.
   */
  active?: () => boolean;
}

export type MenuHandler = (() => void) | MenuRow;

/** Behaviour for the rows a caller wants to offer, keyed by action id. */
export type MenuHandlers = Record<string, MenuHandler | undefined>;

/**
 * Assemble the entries for a context menu.
 *
 * Rows are the registry's, in its (group, order). Between groups the builder
 * draws a section header on surfaces that name their groups and a plain rule
 * elsewhere — never leading, trailing or doubled, so dropping the last row of a
 * group cannot leave a stray rule or an empty heading behind. Rows declaring a
 * `chip` collect into one toggle row per group.
 */
export function buildMenu(
  surface: MenuSurface,
  ctx: AvailabilityContext,
  handlers: MenuHandlers,
): ContextMenuEntry[] {
  const sections = MENU_SECTIONS[surface];
  const entries: ContextMenuEntry[] = [];
  let lastGroup: number | null = null;
  let chips: ContextMenuChip[] | null = null;

  for (const row of menuEntries(surface)) {
    const handler = handlers[row.id];
    if (!handler) continue;
    const available = isAvailable(row, ctx);
    if (!available && row.menu.whenUnavailable !== "disable") continue;
    const behaviour: MenuRow = typeof handler === "function" ? { action: handler } : handler;

    if (row.menu.group !== lastGroup) {
      const title = sections?.[row.menu.group];
      if (title) entries.push({ section: title });
      else if (lastGroup !== null) entries.push({ separator: true });
      lastGroup = row.menu.group;
      chips = null;
    }

    const label = behaviour.label ?? row.menu.label;
    const hint = menuHint(row.id) ?? row.menu.hint;

    if (row.menu.chip) {
      if (!chips) {
        chips = [];
        entries.push({ chips });
      }
      chips.push({
        label: row.menu.chip,
        title: hint ? `${label}  ${hint}` : label,
        ...(row.menu.accent ? { accent: true } : {}),
        ...(behaviour.active ? { active: behaviour.active } : {}),
        action: behaviour.action,
      });
      continue;
    }

    entries.push({
      label,
      ...(hint ? { hint } : {}),
      ...(behaviour.disabled || !available ? { disabled: true } : {}),
      ...(row.menu.danger ? { danger: true } : {}),
      action: behaviour.action,
    });
  }

  return entries;
}
