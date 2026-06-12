// Touch gestures for mobile mode.
//
// The room-list drawer is dragged interactively, Discord-style: a horizontal
// drag from anywhere on screen pulls the drawer along with the finger, and on
// release it snaps open or closed based on how far it travelled and how fast.
//   • Drawer closed → drag right to pull it out.
//   • Drawer open   → drag left to push it back.
// A separate gesture — pull down from the top of the open room list — opens the
// command palette, which is otherwise keyboard-only (`:`) and unreachable on a
// touch device.
//
// Tap-on-backdrop is handled by the backdrop element itself in App.ts.

import { isMobile, isDrawerOpen, openDrawer, closeDrawer } from "./mobile.js";

export interface TouchGestureOptions {
  /** Scrollable room-list element; pull-down only fires when it's at the top. */
  scrollEl?: HTMLElement;
  /** Invoked when the user pulls down from the top of the open drawer. */
  onPullDown?: () => void;
}

// Minimum dominant-axis travel before we commit to interpreting a touch as a
// horizontal drag or a vertical scroll/pull.
const AXIS_LOCK_PX = 8;
// Fraction of the drawer that must be revealed (or a fling faster than this) for
// a release to settle open rather than snapping back.
const SETTLE_FRACTION = 0.5;
const FLING_VELOCITY_PX_PER_MS = 0.5;
// Pull-down (open command palette) wants a deliberate drag and tolerates drift.
const PULL_DOWN_DISTANCE_PX = 64;
const PULL_DOWN_HORIZONTAL_TOLERANCE_PX = 60;
const SWIPE_MAX_DURATION_MS = 600;

type Axis = "none" | "horizontal" | "vertical";

interface Tracked {
  x: number;
  y: number;
  t: number;
  startedOpen: boolean;
  /** Drawer touch that began with the room list scrolled to the top. */
  pullDownEligible: boolean;
  axis: Axis;
  /** True once we've committed to driving the drawer with this touch. */
  dragging: boolean;
}

let _active: Tracked | null = null;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** "Shut" amount the drawer would have at the current finger position. */
function shutFor(tracked: Tracked, dx: number): number {
  const baseShut = tracked.startedOpen ? 0 : 1;
  return clamp01(baseShut - dx / window.innerWidth);
}

function beginDrag(): void {
  document.body.classList.add("quark-drawer-dragging");
}

function endDrag(): void {
  document.body.classList.remove("quark-drawer-dragging");
}

export function setupTouchGestures(
  layout: HTMLElement,
  opts: TouchGestureOptions = {},
): void {
  layout.addEventListener("touchstart", (e) => {
    if (!isMobile()) {
      _active = null;
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;

    const startedOpen = isDrawerOpen();
    // Pull-to-reveal the command palette only when the list can't scroll up any
    // further — otherwise a downward drag is a normal scroll.
    const atTop = (opts.scrollEl?.scrollTop ?? 0) <= 0;
    _active = {
      x: touch.clientX,
      y: touch.clientY,
      t: performance.now(),
      startedOpen,
      pullDownEligible: startedOpen && !!opts.onPullDown && atTop,
      axis: "none",
      dragging: false,
    };
  }, { passive: true });

  // Non-passive so we can suppress native scroll while a drawer drag is in
  // flight — the drag can start over the timeline, which would otherwise scroll.
  layout.addEventListener("touchmove", (e) => {
    const tracked = _active;
    if (!tracked) return;
    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - tracked.x;
    const dy = touch.clientY - tracked.y;

    // Lock the gesture to an axis on first decisive movement.
    if (tracked.axis === "none") {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > AXIS_LOCK_PX) {
        // A drag only controls the drawer in the direction that has somewhere
        // to go: rightward when closed, leftward when open.
        const opening = !tracked.startedOpen && dx > 0;
        const closing = tracked.startedOpen && dx < 0;
        if (opening || closing) {
          tracked.axis = "horizontal";
          tracked.dragging = true;
          beginDrag();
        } else {
          _active = null;
          return;
        }
      } else if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > AXIS_LOCK_PX) {
        tracked.axis = "vertical";
        // Only the pull-down-from-top gesture keeps a vertical touch; everything
        // else is a normal scroll and must be released back to the page.
        if (!(tracked.pullDownEligible && dy > 0)) {
          _active = null;
          return;
        }
      } else {
        return; // not enough movement to decide yet
      }
    }

    if (tracked.axis === "horizontal" && tracked.dragging) {
      e.preventDefault();
      document.body.style.setProperty("--drawer-shut", String(shutFor(tracked, dx)));
    } else if (tracked.axis === "vertical" && tracked.pullDownEligible) {
      e.preventDefault(); // suppress overscroll bounce while tracking the pull
    }
  }, { passive: false });

  layout.addEventListener("touchend", (e) => {
    const tracked = _active;
    _active = null;
    if (!tracked) return;

    const touch = e.changedTouches[0];
    if (!touch) {
      endDrag();
      return;
    }

    const dx = touch.clientX - tracked.x;
    const dy = touch.clientY - tracked.y;
    const dt = performance.now() - tracked.t;

    if (tracked.dragging) {
      // Settle the drawer: open if revealed past the midpoint or flung fast in
      // the opening direction; close on the converse. Releasing the dragging
      // class lets the CSS transition animate the remaining distance.
      endDrag();
      const openness = 1 - shutFor(tracked, dx);
      const vx = dt > 0 ? dx / dt : 0;
      let open: boolean;
      if (tracked.startedOpen) {
        const shouldClose = openness < SETTLE_FRACTION || vx < -FLING_VELOCITY_PX_PER_MS;
        open = !shouldClose;
      } else {
        open = openness > SETTLE_FRACTION || vx > FLING_VELOCITY_PX_PER_MS;
      }
      if (open) openDrawer(); else closeDrawer();
      return;
    }

    // Pull-down from the top of the room list → open the command palette.
    if (
      tracked.axis === "vertical" &&
      tracked.pullDownEligible &&
      dt <= SWIPE_MAX_DURATION_MS &&
      dy > PULL_DOWN_DISTANCE_PX &&
      Math.abs(dx) < PULL_DOWN_HORIZONTAL_TOLERANCE_PX
    ) {
      opts.onPullDown?.();
    }
  }, { passive: true });

  layout.addEventListener("touchcancel", () => {
    if (_active?.dragging) endDrag();
    _active = null;
  }, { passive: true });
}
