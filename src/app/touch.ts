// Touch gestures for mobile mode.
//
// Three recognisers, all attached to the layout root:
//   1. Edge swipe right from the leftmost ~32px → open drawer
//   2. Swipe left while the drawer is open → close drawer
//   3. Pull down from the top of the room list (drawer open, list scrolled to
//      top) → open the command palette. Command mode is keyboard-only (`:`) and
//      unreachable on a touch device, so this exposes it to mobile users.
//
// Tap-on-backdrop is handled by the backdrop element itself in App.ts.

import { isMobile, isDrawerOpen, openDrawer, closeDrawer } from "./mobile.js";

export interface TouchGestureOptions {
  /** Scrollable room-list element; pull-down only fires when it's at the top. */
  scrollEl?: HTMLElement;
  /** Invoked when the user pulls down from the top of the open drawer. */
  onPullDown?: () => void;
}

// Android's system back-gesture grabs the leftmost ~16dp, so the app's
// edge-swipe target has to start further in. 32px is a comfortable middle
// ground: still feels like an edge swipe, but the touch is reliably the
// app's and not the system gesture's.
const EDGE_THRESHOLD_PX = 32;
const SWIPE_DISTANCE_PX = 48;
const SWIPE_MAX_DURATION_MS = 600;
const SWIPE_VERTICAL_TOLERANCE_PX = 50;
// Pull-down (open command palette) wants a more deliberate drag than the
// horizontal swipes, and tolerates a little horizontal drift.
const PULL_DOWN_DISTANCE_PX = 64;
const PULL_DOWN_HORIZONTAL_TOLERANCE_PX = 60;

interface Tracked {
  x: number;
  y: number;
  t: number;
  fromEdge: boolean;
  fromDrawer: boolean;
  /** Drawer touch that began with the room list scrolled to the top. */
  pullDownEligible: boolean;
}

let _active: Tracked | null = null;

export function setupTouchGestures(
  layout: HTMLElement,
  drawerEl: HTMLElement,
  opts: TouchGestureOptions = {},
): void {
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

    // Pull-to-reveal the command palette only when the list can't scroll up
    // any further — otherwise a downward drag is a normal scroll.
    const atTop = (opts.scrollEl?.scrollTop ?? 0) <= 0;
    _active = {
      x: touch.clientX,
      y: touch.clientY,
      t: performance.now(),
      fromEdge,
      fromDrawer,
      pullDownEligible: fromDrawer && !!opts.onPullDown && atTop,
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
    // and stop the page from scrolling underneath.
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
      e.preventDefault();
    } else if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 12) {
      // Vertical move. A downward pull from the top of the room list is the
      // command-palette gesture — keep tracking it and suppress the native
      // overscroll bounce. Anything else (scrolling, upward drag) bails out so
      // legitimate scrolling still works.
      if (tracked.pullDownEligible && dy > 0) {
        e.preventDefault();
      } else {
        _active = null;
      }
    }
  }, { passive: false });

  layout.addEventListener("touchend", (e) => {
    const tracked = _active;
    _active = null;
    if (!tracked) return;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const dxSigned = touch.clientX - tracked.x;
    const dySigned = touch.clientY - tracked.y;
    const dx = dxSigned;
    const dy = Math.abs(dySigned);
    const dt = performance.now() - tracked.t;

    if (dt > SWIPE_MAX_DURATION_MS) return;

    // Pull-down from the top of the room list → open the command palette.
    if (
      tracked.pullDownEligible &&
      dySigned > PULL_DOWN_DISTANCE_PX &&
      Math.abs(dx) < PULL_DOWN_HORIZONTAL_TOLERANCE_PX
    ) {
      opts.onPullDown?.();
      return;
    }

    // Horizontal drawer swipes reject if they drift too far vertically.
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
