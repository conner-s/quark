import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemberList, type MemberEntry } from "./MemberList.js";

function makeMember(overrides: Partial<MemberEntry> = {}): MemberEntry {
  return {
    id: "mem1",
    name: "Alice",
    userId: "@alice:matrix.org",
    powerLevel: "member",
    ...overrides,
  };
}

describe("MemberList", () => {
  let list: MemberList;

  beforeEach(() => {
    list = new MemberList();
    document.body.appendChild(list.getElement());
  });

  afterEach(() => {
    list.getElement().remove();
  });

  describe("setMembers", () => {
    it("renders member names in the DOM", () => {
      list.setMembers([
        makeMember({ id: "m1", name: "Alice" }),
        makeMember({ id: "m2", name: "Bob" }),
      ]);

      const names = list.getElement().querySelectorAll(".member-list__name");
      const nameTexts = Array.from(names).map((n) => n.textContent);

      expect(nameTexts).toContain("Alice");
      expect(nameTexts).toContain("Bob");
    });

    it("updates member count in header", () => {
      list.setMembers([
        makeMember({ id: "m1" }),
        makeMember({ id: "m2" }),
        makeMember({ id: "m3" }),
      ]);

      const countEl = list.getElement().querySelector(".member-list__count");
      expect(countEl?.textContent).toBe("(3)");
    });

    it("replaces existing members on re-render", () => {
      list.setMembers([makeMember({ id: "m1", name: "Alice" })]);
      list.setMembers([makeMember({ id: "m2", name: "Bob" })]);

      const names = list.getElement().querySelectorAll(".member-list__name");
      expect(names).toHaveLength(1);
      expect(names[0].textContent).toBe("Bob");
    });
  });

  describe("grouping by power level", () => {
    it("groups members into admin, mod, and member sections", () => {
      list.setMembers([
        makeMember({ id: "a1", name: "Admin1", powerLevel: "admin" }),
        makeMember({ id: "m1", name: "Mod1", powerLevel: "mod" }),
        makeMember({ id: "r1", name: "Regular", powerLevel: "member" }),
      ]);

      const sectionHeaders = list.getElement().querySelectorAll(".member-list__section-header");
      const labels = Array.from(sectionHeaders).map((h) =>
        h.querySelector("span:last-child")?.textContent
      );

      expect(labels.some((l) => l?.includes("Admin"))).toBe(true);
      expect(labels.some((l) => l?.includes("Moderator"))).toBe(true);
      expect(labels.some((l) => l?.includes("Member"))).toBe(true);
    });

    it("only renders sections that have members", () => {
      list.setMembers([
        makeMember({ id: "m1", powerLevel: "member" }),
      ]);

      const sectionHeaders = list.getElement().querySelectorAll(".member-list__section-header");
      // Only the "Members" section should appear
      expect(sectionHeaders).toHaveLength(1);
    });

    it("renders admin badge for admin members", () => {
      list.setMembers([makeMember({ id: "a1", powerLevel: "admin" })]);

      const badge = list.getElement().querySelector(".member-list__badge--admin");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe("@");
    });

    it("renders mod badge for mod members", () => {
      list.setMembers([makeMember({ id: "m1", powerLevel: "mod" })]);

      const badge = list.getElement().querySelector(".member-list__badge--mod");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe("+");
    });

    it("does not render a badge for regular members", () => {
      list.setMembers([makeMember({ id: "r1", powerLevel: "member" })]);

      const badge = list.getElement().querySelector(".member-list__badge");
      expect(badge).toBeNull();
    });
  });

  describe("presence indicators", () => {
    it("shows online presence indicator", () => {
      list.setMembers([makeMember({ id: "m1", presence: "online" })]);

      const presence = list.getElement().querySelector(".member-list__presence--online");
      expect(presence).not.toBeNull();
      expect(presence?.textContent).toBe("●");
    });

    it("shows unavailable presence indicator", () => {
      list.setMembers([makeMember({ id: "m1", presence: "unavailable" })]);

      const presence = list.getElement().querySelector(".member-list__presence--unavailable");
      expect(presence).not.toBeNull();
      expect(presence?.textContent).toBe("◐");
    });

    it("shows offline presence indicator by default", () => {
      list.setMembers([makeMember({ id: "m1" })]);

      const presence = list.getElement().querySelector(".member-list__presence--offline");
      expect(presence).not.toBeNull();
      expect(presence?.textContent).toBe("○");
    });
  });

  describe("setActiveMember", () => {
    it("adds active class to the selected member", () => {
      list.setMembers([
        makeMember({ id: "m1", name: "Alice" }),
        makeMember({ id: "m2", name: "Bob" }),
      ]);

      list.setActiveMember("m2");

      const items = list.getElement().querySelectorAll<HTMLElement>(".member-list__item");
      const activeItems = Array.from(items).filter((i) =>
        i.classList.contains("member-list__item--active")
      );

      expect(activeItems).toHaveLength(1);
      expect(activeItems[0].dataset.memberId).toBe("m2");
    });
  });

  describe("selection via click", () => {
    it("fires onSelect callback when a member is clicked", () => {
      const handler = vi.fn();
      list.onSelect(handler);

      list.setMembers([makeMember({ id: "m1", name: "Alice" })]);

      const item = list.getElement().querySelector<HTMLElement>(".member-list__item");
      item?.click();

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].id).toBe("m1");
    });
  });

  describe("section collapsing", () => {
    it("collapses a section on header click", () => {
      list.setMembers([makeMember({ id: "m1", name: "Alice", powerLevel: "member" })]);

      const sectionHeader = list.getElement().querySelector<HTMLElement>(
        ".member-list__section-header"
      );
      sectionHeader?.click();

      // After collapsing, the member items should not be visible
      const items = list.getElement().querySelectorAll(".member-list__item");
      expect(items).toHaveLength(0);
    });

    it("expands a collapsed section on a second click", () => {
      list.setMembers([makeMember({ id: "m1", name: "Alice", powerLevel: "member" })]);

      const getHeader = () =>
        list.getElement().querySelector<HTMLElement>(".member-list__section-header");

      getHeader()?.click(); // collapse
      getHeader()?.click(); // expand

      const items = list.getElement().querySelectorAll(".member-list__item");
      expect(items).toHaveLength(1);
    });
  });
});
