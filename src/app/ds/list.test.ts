import { describe, expect, it } from "vitest";
import { CASE_TABS, readHomeList, TABS, tabFilter } from "./list";

describe("the DS home's tabs and search (HOME-2)", () => {
  it("has five case tabs, then the three amendment tabs (AMD-9)", () => {
    expect(TABS).toEqual([
      "all",
      "notAllocated",
      "received",
      "inProgress",
      "completed",
      "amendmentsWaiting",
      "amendmentsApproved",
      "amendmentsRejected",
    ]);
    expect(CASE_TABS).toEqual(["all", "notAllocated", "received", "inProgress", "completed"]);
  });

  it("reads the tab and search from the address", () => {
    expect(readHomeList({ tab: "inProgress", q: "ඒ. බී." })).toEqual({
      tab: "inProgress",
      q: "ඒ. බී.",
      filter: { statuses: ["IN_PROGRESS"], q: "ඒ. බී." },
      amendments: null,
    });
    expect(readHomeList({ tab: "completed" }).filter).toEqual({ statuses: ["COMPLETED"], q: "" });
  });

  it("puts the first two statuses under 'not yet allocated', and the third under 'allocation received'", () => {
    expect(tabFilter("notAllocated")).toEqual({ statuses: ["AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT"] });
    expect(tabFilter("received")).toEqual({ statuses: ["ALLOCATION_RECEIVED"] });
  });

  it("leaves replaced cases to 'all' only", () => {
    for (const tab of CASE_TABS.filter((tab) => tab !== "all")) {
      expect(tabFilter(tab).statuses, tab).not.toContain("REPLACED");
    }
    expect(tabFilter("all")).toEqual({});
  });

  it("lists amendments on an amendment tab, with no search", () => {
    expect(readHomeList({ tab: "amendmentsWaiting", q: "ඒ. බී." })).toEqual({
      tab: "amendmentsWaiting",
      q: "",
      filter: { q: "" },
      amendments: "WAITING",
    });
    expect(readHomeList({ tab: "amendmentsApproved" }).amendments).toBe("APPROVED");
    expect(readHomeList({ tab: "amendmentsRejected" }).amendments).toBe("REJECTED");
  });

  it("shows every case for an unknown tab, even one named like an object's own property", () => {
    for (const tab of [undefined, "", "LAND", "detailsMissing", "toString", "constructor", "WAITING", ["all"]]) {
      expect(readHomeList({ tab }), String(tab)).toEqual({ tab: "all", q: "", filter: { q: "" }, amendments: null });
    }
  });

  it("gives each caller a filter of its own", () => {
    for (const tab of CASE_TABS) expect(tabFilter(tab)).not.toBe(tabFilter(tab));
    const first = tabFilter("inProgress");
    first.statuses?.push("COMPLETED");
    expect(tabFilter("inProgress")).toEqual({ statuses: ["IN_PROGRESS"] });
    const notAllocated = tabFilter("notAllocated");
    notAllocated.statuses?.push("COMPLETED");
    expect(tabFilter("notAllocated").statuses).toHaveLength(2);
  });
});
