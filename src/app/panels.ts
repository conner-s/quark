// Panel nav wiring — registers each UI panel's nav callbacks with AppState.
// Kept separate from keyboard.ts (keyboard concerns) and state.ts (no UI deps).

import { AppState } from "./state.js";
import { cancelReply, cancelEdit, closeThread } from "./actions.js";
import type { AppComponents } from "../ui/App.js";

export function setupPanelNav(components: AppComponents): void {
  const { spaceStrip, roomList, timeline, memberList, homeView } = components;

  AppState.registerPanelNav("spaces", {
    navDown: () => spaceStrip.navDown(),
    navUp: () => spaceStrip.navUp(),
    jumpTop: () => spaceStrip.navFirst(),
    jumpBottom: () => spaceStrip.navLast(),
    select: () => spaceStrip.selectFocused(),
    focusActive: () => spaceStrip.focusActive(),
    close: () => { /* no-op */ },
  });

  AppState.registerPanelNav("roomlist", {
    navDown: () => roomList.navDown(),
    navUp: () => roomList.navUp(),
    jumpTop: () => roomList.navFirst(),
    jumpBottom: () => roomList.navLast(),
    select: () => roomList.selectFocused(),
    focusActive: () => roomList.focusActive(),
    close: () => { /* no-op */ },
  });

  AppState.registerPanelNav("timeline", {
    navDown: () => timeline.selectNext(),
    navUp: () => timeline.selectPrev(),
    jumpTop: () => timeline.selectFirst(),
    jumpBottom: () => timeline.selectLast(),
    // focusActive: no DOM focus needed — activePanel state alone drives keyboard routing
    close: () => {
      timeline.clearSelection();
      cancelReply();
      cancelEdit();
      closeThread();
    },
  });

  // Clicking in the timeline should immediately route j/k there, even if the
  // user hasn't explicitly pressed l to move focus from the room list.
  timeline.onFocus(() => {
    if (AppState.get("activePanel") !== "timeline") {
      AppState.set("activePanel", "timeline");
    }
  });

  AppState.registerPanelNav("members", {
    navDown: () => memberList.navDown(),
    navUp: () => memberList.navUp(),
    jumpTop: () => memberList.navFirst(),
    jumpBottom: () => memberList.navLast(),
    focusActive: () => memberList.focusFirst(),
    close: () => { /* no-op */ },
  });

  // Home view canvas — j/k cycle the floating DMs, Enter opens, Esc returns
  // to the space strip (panel order is [spaces, home] while it's active).
  AppState.registerPanelNav("home", {
    navDown: () => homeView.navNext(),
    navUp: () => homeView.navPrev(),
    select: () => homeView.selectFocused(),
    focusActive: () => homeView.focusActive(),
    close: () => AppState.focusPanel("spaces"),
  });
}
