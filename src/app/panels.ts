// Panel nav wiring — registers each UI panel's nav callbacks with AppState.
// Kept separate from keyboard.ts (keyboard concerns) and state.ts (no UI deps).

import { AppState } from "./state.js";
import type { AppComponents } from "../ui/App.js";

export function setupPanelNav(components: AppComponents): void {
  const { spaceStrip, roomList, timeline, memberList } = components;

  AppState.registerPanelNav("spaces", {
    navDown: () => spaceStrip.navDown(),
    navUp: () => spaceStrip.navUp(),
    focusActive: () => spaceStrip.focusActive(),
  });

  AppState.registerPanelNav("roomlist", {
    navDown: () => roomList.navDown(),
    navUp: () => roomList.navUp(),
    focusActive: () => roomList.focusActive(),
  });

  AppState.registerPanelNav("timeline", {
    navDown: () => timeline.selectNext(),
    navUp: () => timeline.selectPrev(),
  });

  AppState.registerPanelNav("members", {
    navDown: () => memberList.navDown(),
    navUp: () => memberList.navUp(),
    focusActive: () => memberList.focusFirst(),
  });
}
