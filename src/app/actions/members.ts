// Member list actions: toggling the member-list sidebar.

import { AppState } from "../state.js";
import { isMobile, closeDrawer } from "../mobile.js";

import { getComponents } from "./context.js";

/**
 * Toggle the member list sidebar visibility.
 */
export function toggleMemberList(): void {
  const { mainLayout } = getComponents();
  const current = AppState.get("memberListVisible");
  const next = !current;
  AppState.set("memberListVisible", next);

  if (!next && AppState.get("activePanel") === "members") {
    AppState.set("activePanel", "timeline");
  }

  mainLayout.classList.toggle("quark-layout--member-list-open", next);

  // Mobile is one-overlay-at-a-time: opening the member-list pulls focus
  // away from the drawer.
  if (next && isMobile()) closeDrawer();
}
