// Root layout component — creates the three-panel grid layout

import { SpaceStrip } from "./SpaceStrip.js";
import { RoomList } from "./RoomList.js";
import { Timeline } from "./Timeline.js";
import { Input } from "./Input.js";

export interface AppComponents {
  spaceStrip: SpaceStrip;
  roomList: RoomList;
  timeline: Timeline;
  input: Input;
}

/**
 * Renders the root Quark layout into the given container element.
 * Returns references to the major UI components for wiring up by main.ts.
 */
export function mountApp(container: HTMLElement): AppComponents {
  // Clear any existing content
  container.innerHTML = "";

  // ── Create top-level grid ───────────────────────────────────────────────
  const layout = document.createElement("div");
  layout.className = "quark-layout";

  // ── Space strip (column 1) ──────────────────────────────────────────────
  const spaceStrip = new SpaceStrip();
  layout.appendChild(spaceStrip.getElement());

  // ── Room list (column 2) ────────────────────────────────────────────────
  const roomList = new RoomList();
  layout.appendChild(roomList.getElement());

  // ── Main panel (column 3) ───────────────────────────────────────────────
  const mainPanel = document.createElement("div");
  mainPanel.className = "main-panel";

  // Room header
  const mainHeader = document.createElement("div");
  mainHeader.className = "main-panel__header";
  mainHeader.textContent = "Quark";
  mainPanel.appendChild(mainHeader);

  // Timeline
  const timeline = new Timeline();
  mainPanel.appendChild(timeline.getElement());

  // Input bar
  const input = new Input();
  mainPanel.appendChild(input.getElement());

  layout.appendChild(mainPanel);

  // ── Mount ───────────────────────────────────────────────────────────────
  container.appendChild(layout);

  return { spaceStrip, roomList, timeline, input };
}
