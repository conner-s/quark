// Panel nav wiring — registers each UI panel's nav callbacks with AppState.
// Kept separate from keyboard.ts (keyboard concerns) and state.ts (no UI deps).

import { AppState } from "./state.js";
import { cancelReply } from "./actions.js";
import type { AppComponents } from "../ui/App.js";

export function setupPanelNav(components: AppComponents): void {
  const { spaceStrip, roomList, timeline, memberList } = components;

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
    close: () => {
      timeline.clearSelection();
      cancelReply();
      AppState.set("threadRootEventId", null);
    },
  });

  AppState.registerPanelNav("members", {
    navDown: () => memberList.navDown(),
    navUp: () => memberList.navUp(),
    jumpTop: () => memberList.navFirst(),
    jumpBottom: () => memberList.navLast(),
    focusActive: () => memberList.focusFirst(),
    close: () => { /* no-op */ },
  });
}
