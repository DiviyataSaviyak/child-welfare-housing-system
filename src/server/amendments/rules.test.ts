import { describe, expect, it } from "vitest";
import type { CaseStatus } from "@/generated/prisma/enums";
import type { Role } from "../auth/roles";
import { amendRefusal, canAmend, replacementStep } from "./rules";

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

describe("where the new case starts, and how far the money goes back (AMD-8, AMD-11)", () => {
  // Kaduwela (7) and Homagama (8) in Colombo (2); Biyagama (20) in Gampaha (3).
  const kaduwela = { id: 7, districtId: 2 };
  const homagama = { id: 8, districtId: 2 };
  const biyagama = { id: 20, districtId: 3 };
  const step = (status: CaseStatus, built: { id: number; districtId: number }) =>
    replacementStep({ status, buildDsOffice: kaduwela }, built);

  it("awaiting its allocation: any DS office, nothing to return", () => {
    for (const built of [kaduwela, homagama, biyagama]) {
      expect(step("AWAITING_ALLOCATION", built)).toEqual({ status: "AWAITING_ALLOCATION", returnedTo: null });
    }
  });

  it("allocated to its district: the same district stays on the letter; another goes back to the Ministry", () => {
    for (const built of [kaduwela, homagama]) {
      expect(step("ALLOCATED_TO_DISTRICT", built)).toEqual({ status: "ALLOCATED_TO_DISTRICT", returnedTo: null });
    }
    expect(step("ALLOCATED_TO_DISTRICT", biyagama)).toEqual({ status: "AWAITING_ALLOCATION", returnedTo: "MINISTRY" });
  });

  it("allocation received: the same DS office keeps it; the district's other offices back to the District; another district to the Ministry", () => {
    expect(step("ALLOCATION_RECEIVED", kaduwela)).toEqual({ status: "ALLOCATION_RECEIVED", returnedTo: null });
    expect(step("ALLOCATION_RECEIVED", homagama)).toEqual({ status: "ALLOCATED_TO_DISTRICT", returnedTo: "DISTRICT" });
    expect(step("ALLOCATION_RECEIVED", biyagama)).toEqual({ status: "AWAITING_ALLOCATION", returnedTo: "MINISTRY" });
  });
});
