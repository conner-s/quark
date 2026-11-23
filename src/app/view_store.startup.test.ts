import { describe, it, expect, vi } from "vitest";

// The bug this pins: a restored session loads the room list before the UI is
// bound, and the tab store used to be wired to the backend only when it was,
// so that first load read nothing and showed the built-in tabs alone. A tab
// change made then wrote the built-ins over the account's own tabs.

const { stored } = vi.hoisted(() => ({ stored: { value: null as unknown } }));
vi.mock("../ipc/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ipc/index.js")>();
  return {
    ...actual,
    getRoomViews: vi.fn(async () => stored.value),
    fetchRoomViews: vi.fn(async () => stored.value),
    setRoomViews: vi.fn(async () => {}),
  };
});

const { loadViews, allViews } = await import("./view_store.js");
const { newView, parseViews, serializeViews } = await import("./room_views.js");

describe("the tab store at startup", () => {
  it("reads the account's tabs on the first load, before anything binds it", async () => {
    const mine = newView("Work", []);
    stored.value = serializeViews([...parseViews(null), mine]);
    await loadViews();
    expect(allViews().map((v) => v.id)).toContain(mine.id);
  });
});
