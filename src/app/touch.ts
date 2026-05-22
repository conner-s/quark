// Touch gestures for mobile mode.
//
// Two recognisers, both attached to the layout root:
//   1. Edge swipe right from the leftmost ~20px → open drawer
//   2. Swipe left while the drawer is open → close drawer
//
// Tap-on-backdrop is handled by the backdrop element itself in App.ts.

import { isMobile, isDrawerOpen, openDrawer, closeDrawer } from "./mobile.js";

// Android's system back-gesture grabs the leftmost ~16dp, so the app's
// edge-swipe target has to start further in. 32px is a comfortable middle
// ground: still feels like an edge swipe, but the touch is reliably the
// app's and not the system gesture's.
const EDGE_THRESHOLD_PX = 32;
const SWIPE_DISTANCE_PX = 48;
const SWIPE_MAX_DURATION_MS = 600;
const SWIPE_VERTICAL_TOLERANCE_PX = 50;

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

  // Non-passive so we can suppress native scroll while a drawer gesture is in
  // flight. Without this, an edge-swipe right-drag also drags the timeline
  // because the touch starts inside it.
  layout.addEventListener("touchmove", (e) => {
    const tracked = _active;
    if (!tracked) return;
    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - tracked.x;
    const dy = touch.clientY - tracked.y;

    // Once the horizontal component dominates, treat this as a drawer gesture
    // and stop the page from scrolling underneath. A purely vertical move
    // bails out (cancel the tracked gesture) so legitimate scrolling still works.
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
      e.preventDefault();
    } else if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 12) {
      _active = null;
    }
  }, { passive: false });

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
