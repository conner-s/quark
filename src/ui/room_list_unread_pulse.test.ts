import { describe, it, expect, beforeAll, beforeEach } from "vitest";
// Vite's `?raw` loader; `src/vite-env.d.ts` types it.
import BASE_CSS from "../style/base.css?raw";

/**
 * An unread room's row pulses to draw the eye. A room can stay unread for
 * hours, though, and with `unread-pulse … infinite` every unread row kept
 * animating for as long as it stayed unread: an otherwise idle window never
 * stopped producing frames, at the monitor's refresh rate, whether anyone was
 * looking or not. The pulse runs a few times and then holds still.
 */
function loadStylesheet(): void {
  const style = document.createElement("style");
  style.textContent = BASE_CSS;
  document.head.appendChild(style);
}

function buildUnreadRow(): HTMLElement {
  const el = document.createElement("div");
  el.className = "room-list__item room-list__item--unread";
  document.body.appendChild(el);
  return el;
}

/**
 * jsdom leaves the `animation` shorthand unexpanded (`animationName` and
 * `animationIterationCount` read ""), so read its tokens the way base.css
 * writes them.
 */
const animationTokens = (el: HTMLElement): string[] => getComputedStyle(el).animation.trim().split(/\s+/);

describe("unread room pulse", () => {
  beforeAll(loadStylesheet);
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("pulses an unread row", () => {
    expect(animationTokens(buildUnreadRow())[0]).toBe("unread-pulse");
  });

  it("stops pulsing instead of animating for as long as the room is unread", () => {
    const tokens = animationTokens(buildUnreadRow());
    expect(tokens).not.toContain("infinite");
    const count = tokens.find((t) => /^\d+$/.test(t));
    expect(count, `no iteration count in "${tokens.join(" ")}"`).toBeDefined();
  });
});
