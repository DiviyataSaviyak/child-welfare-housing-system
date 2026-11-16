import { describe, expect, it } from "vitest";
import { readHomeList } from "@/app/ds/list";
import { AMENDMENT_STATUSES } from "@/server/amendments/queries";
import { amendmentsHref, readAmendmentTab } from "./tabs";

describe("the amendments list's tabs (AMD-9)", () => {
  it("reads each tab from the address, and the waiting queue for anything else", () => {
    expect(readAmendmentTab("approved")).toBe("APPROVED");
    expect(readAmendmentTab("rejected")).toBe("REJECTED");
    for (const tab of [undefined, "", "waiting", "WAITING", "APPROVED", "toString", ["approved"]]) {
      expect(readAmendmentTab(tab), String(tab)).toBe("WAITING");
    }
  });

  it("links the Ministry's and the view-only screens' tabs, the queue without a tab", () => {
    expect(amendmentsHref("ministry", "WAITING")).toBe("/ministry/amendments");
    expect(amendmentsHref("ministry", "APPROVED")).toBe("/ministry/amendments?tab=approved");
    expect(amendmentsHref("oversight", "REJECTED", 2)).toBe("/oversight/amendments?tab=rejected&page=2");
    for (const status of AMENDMENT_STATUSES) {
      const query = new URL(amendmentsHref("ministry", status), "http://x").searchParams;
      expect(readAmendmentTab(query.get("tab") ?? undefined)).toBe(status);
    }
  });

  it("links the DS's to its home page's amendment tabs (HOME-2)", () => {
    expect(amendmentsHref("ds", "WAITING")).toBe("/ds?tab=amendmentsWaiting");
    for (const status of AMENDMENT_STATUSES) {
      const query = new URL(amendmentsHref("ds", status), "http://x").searchParams;
      expect(readHomeList({ tab: query.get("tab") ?? undefined }).amendments).toBe(status);
    }
  });
});
