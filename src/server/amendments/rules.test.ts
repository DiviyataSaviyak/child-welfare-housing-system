import { describe, expect, it } from "vitest";
import type { CaseStatus } from "@/generated/prisma/enums";
import type { Role } from "../auth/roles";
import { amendRefusal, buildOfficeAllowed, buildOfficesFor, canAmend } from "./rules";

const crpo = { role: "DS_OFFICER" as Role, residence: true };
const facts = (status: CaseStatus, more: { paid?: boolean; waiting?: boolean } = {}) => ({
  status,
  paid: more.paid ?? false,
  waiting: more.waiting ?? false,
});

describe("who may submit an amendment, and when (AMD-1 to AMD-3)", () => {
  it("lets the CRPO of the DS of residence amend before the first installment is paid", () => {
    for (const status of ["AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT", "ALLOCATION_RECEIVED"] as const) {
      expect(canAmend(crpo, facts(status))).toBe(true);
    }
  });

  it("refuses once an installment is paid, and for a case in progress, completed or replaced (AMD-2)", () => {
    expect(amendRefusal(crpo, facts("ALLOCATION_RECEIVED", { paid: true }))).toBe("amendmentNotAllowed");
    for (const status of ["IN_PROGRESS", "COMPLETED", "REPLACED"] as const) {
      expect(amendRefusal(crpo, facts(status))).toBe("amendmentNotAllowed");
    }
  });

  it("refuses a second amendment while one waits (AMD-3)", () => {
    expect(amendRefusal(crpo, facts("AWAITING_ALLOCATION", { waiting: true }))).toBe("amendmentWaiting");
  });

  it("refuses every other account, and the CRPO of the DS where it is built (AC-48)", () => {
    for (const role of ["VIEWER", "DISTRICT_OFFICER", "MINISTRY_OFFICER", "ADMIN"] as const) {
      expect(amendRefusal({ role, residence: true }, facts("AWAITING_ALLOCATION"))).toBe("roleNotAllowed");
    }
    expect(amendRefusal({ role: "DS_OFFICER", residence: false }, facts("AWAITING_ALLOCATION"))).toBe("roleNotAllowed");
  });
});

describe("where the new beneficiary may be built (AMD-8)", () => {
  const buildDsOffice = { id: 7, districtId: 2 };

  it("follows the money: any DS office, then the district of the letter, then the DS of the release", () => {
    expect(buildOfficesFor({ status: "AWAITING_ALLOCATION", buildDsOffice })).toEqual({ kind: "any" });
    expect(buildOfficesFor({ status: "ALLOCATED_TO_DISTRICT", buildDsOffice })).toEqual({
      kind: "district",
      districtId: 2,
    });
    expect(buildOfficesFor({ status: "ALLOCATION_RECEIVED", buildDsOffice })).toEqual({
      kind: "office",
      dsOfficeId: 7,
    });
  });

  it("allows only those offices", () => {
    const sameDistrict = { id: 8, districtId: 2 };
    const otherDistrict = { id: 9, districtId: 3 };
    expect(buildOfficeAllowed({ kind: "any" }, otherDistrict)).toBe(true);
    expect(buildOfficeAllowed({ kind: "district", districtId: 2 }, sameDistrict)).toBe(true);
    expect(buildOfficeAllowed({ kind: "district", districtId: 2 }, otherDistrict)).toBe(false);
    expect(buildOfficeAllowed({ kind: "office", dsOfficeId: 7 }, buildDsOffice)).toBe(true);
    expect(buildOfficeAllowed({ kind: "office", dsOfficeId: 7 }, sameDistrict)).toBe(false);
  });
});
