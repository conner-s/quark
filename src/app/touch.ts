// Touch gestures for mobile mode.
//
// Two recognisers, both attached to the layout root:
//   1. Edge swipe right from the leftmost ~20px → open drawer
//   2. Swipe left while the drawer is open → close drawer
//
// Tap-on-backdrop is handled by the backdrop element itself in App.ts.

import { isMobile, isDrawerOpen, openDrawer, closeDrawer } from "./mobile.js";

const EDGE_THRESHOLD_PX = 24;
const SWIPE_DISTANCE_PX = 60;
const SWIPE_MAX_DURATION_MS = 500;
const SWIPE_VERTICAL_TOLERANCE_PX = 40;

interface Tracked {
  x: number;
  y: number;
  t: number;
  fromEdge: boolean;
  fromDrawer: boolean;
}

let _active: Tracked | null = null;

export function setupTouchGestures(layout: HTMLElement, drawerEl: HTMLElement): void {
  layout.addEventListener("touchstart", (e) => {
    if (!isMobile()) return;
    const touch = e.touches[0];
    if (!touch) return;

    const fromDrawer = isDrawerOpen() && drawerEl.contains(e.target as Node);
    const fromEdge = !isDrawerOpen() && touch.clientX <= EDGE_THRESHOLD_PX;

    if (!fromDrawer && !fromEdge) {
      _active = null;
      return;
    }

    _active = {
      x: touch.clientX,
      y: touch.clientY,
      t: performance.now(),
      fromEdge,
      fromDrawer,
    };
  }, { passive: true });

  layout.addEventListener("touchend", (e) => {
    const tracked = _active;
    _active = null;
    if (!tracked) return;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - tracked.x;
    const dy = Math.abs(touch.clientY - tracked.y);
    const dt = performance.now() - tracked.t;

    if (dt > SWIPE_MAX_DURATION_MS) return;
    if (dy > SWIPE_VERTICAL_TOLERANCE_PX) return;

    if (tracked.fromEdge && dx > SWIPE_DISTANCE_PX) {
      openDrawer();
    } else if (tracked.fromDrawer && dx < -SWIPE_DISTANCE_PX) {
      closeDrawer();
    }
  }, { passive: true });

  layout.addEventListener("touchcancel", () => {
    _active = null;
  }, { passive: true });
}
