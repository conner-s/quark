import { describe, it, expect } from "vitest";
import { previewSnippet, dmToFloater } from "./home.js";
import { AppState } from "../state.js";
import type { HomeDmInfo } from "../../ipc/types.js";

const OWN = "@me:example.com";

describe("previewSnippet", () => {
  const last = (over: Partial<Parameters<typeof previewSnippet>[0]> = {}) => ({
    body: "hello world",
    msgType: "m.text",
    isUtd: false,
    sender: "@alice:example.com",
    ...over,
  });

  it("uses the plain body for text messages", () => {
    expect(previewSnippet(last(), OWN)).toBe("hello world");
  });

  it("prefixes own messages with you:", () => {
    expect(previewSnippet(last({ sender: OWN }), OWN)).toBe("you: hello world");
  });

  it("masks undecryptable events", () => {
    expect(previewSnippet(last({ isUtd: true, body: null }), OWN)).toBe("🔒 encrypted");
  });

  it("maps media types to glyph labels", () => {
    expect(previewSnippet(last({ msgType: "m.image", body: "cat.png" }), OWN)).toBe("📷 image");
    expect(previewSnippet(last({ msgType: "m.video" }), OWN)).toBe("🎞 video");
    expect(previewSnippet(last({ msgType: "m.audio" }), OWN)).toBe("🔊 audio");
    expect(previewSnippet(last({ msgType: "m.file" }), OWN)).toBe("📎 file");
  });

  it("keeps the sticker body text", () => {
    expect(previewSnippet(last({ msgType: "m.sticker", body: "partyblob" }), OWN)).toBe("partyblob");
    expect(previewSnippet(last({ msgType: "m.sticker", body: "" }), OWN)).toBe("sticker");
  });

  it("returns empty for rooms with no preview", () => {
    expect(previewSnippet(last({ body: null, msgType: null, sender: null }), OWN)).toBe("");
  });
});

describe("dmToFloater", () => {
  const dm = (over: Partial<HomeDmInfo> = {}): HomeDmInfo => ({
    room_id: "!dm:example.com",
    name: "Alice",
    dm_user_id: "@alice:example.com",
    avatar_url: null,
    last_activity_ts: 12345,
    last_sender: "@alice:example.com",
    last_body: "hey",
    last_msg_type: "m.text",
    last_is_utd: false,
    unread_count: 3,
    ...over,
  });

  it("maps fields and resolves cached presence", () => {
    AppState.cacheUserPresence("@alice:example.com", "online");
    const f = dmToFloater(dm(), OWN);
    expect(f).toMatchObject({
      roomId: "!dm:example.com",
      name: "Alice",
      dmUserId: "@alice:example.com",
      presence: "online",
      snippet: "hey",
      lastTs: 12345,
      unreadCount: 3,
    });
  });

  it("defaults unknown or exotic presence to offline", () => {
    AppState.cacheUserPresence("@bob:example.com", "weird-state");
    expect(dmToFloater(dm({ dm_user_id: "@bob:example.com" }), OWN).presence).toBe("offline");
    expect(dmToFloater(dm({ dm_user_id: "@nobody:example.com" }), OWN).presence).toBe("offline");
    expect(dmToFloater(dm({ dm_user_id: null }), OWN).presence).toBe("offline");
  });

  it("falls back through name → dm user → room id for the label", () => {
    expect(dmToFloater(dm({ name: null }), OWN).name).toBe("@alice:example.com");
    expect(dmToFloater(dm({ name: null, dm_user_id: null }), OWN).name).toBe("!dm:example.com");
  });

  it("carries the partner's cached status message", () => {
    AppState.cacheUserStatus("@carol:example.com", "at the lake");
    expect(dmToFloater(dm({ dm_user_id: "@carol:example.com" }), OWN).statusMessage).toBe(
      "at the lake",
    );
    expect(dmToFloater(dm({ dm_user_id: "@stranger:example.com" }), OWN).statusMessage).toBeNull();
    expect(dmToFloater(dm({ dm_user_id: null }), OWN).statusMessage).toBeNull();
  });
});
