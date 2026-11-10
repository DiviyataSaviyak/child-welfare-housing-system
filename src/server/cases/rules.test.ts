import { describe, expect, it } from "vitest";
import type { CaseStatus } from "@/generated/prisma/enums";
import { CaseStatus as STATUS_VALUES } from "@/generated/prisma/enums";
import { applicationKey, formatCaseNumber } from "./numbers";
import { canChangeOffice, canDeleteDraft, canEditDetails, isBeingEntered, mustStayComplete } from "./rules";
import { type Move, moveRefusal, MOVES, type Mover, movesFrom } from "./transitions";

const STATUSES = Object.values(STATUS_VALUES) as CaseStatus[];

describe("case rules (application spec, Roles and permissions; Case statuses and transitions)", () => {
  it("lets the office change only drafts and returned cases, and nobody a case being checked (CASE-7, STS-3)", () => {
    for (const status of STATUSES) {
      const entry = status === "DRAFT" || status === "RETURNED";
      expect(canEditDetails("DS_OFFICER", status), status).toBe(entry);
      expect(isBeingEntered(status), status).toBe(entry);
      expect(canEditDetails("ADMIN", status), status).toBe(false);
    }
    expect(canEditDetails("MINISTRY_OFFICER", "SUBMITTED")).toBe(false);
  });

  it("lets only Head Office change a verified case while it runs, and keeps it complete (CASE-9)", () => {
    const afterCheck = ["VERIFIED", "IN_PROGRESS"];
    for (const status of STATUSES) {
      const entry = status === "DRAFT" || status === "RETURNED";
      expect(canEditDetails("MINISTRY_OFFICER", status), status).toBe(entry || afterCheck.includes(status));
      expect(mustStayComplete(status), status).toBe(afterCheck.includes(status));
    }
  });

  it("deletes drafts only (CASE-8)", () => {
    for (const status of STATUSES) expect(canDeleteDraft("DS_OFFICER", status), status).toBe(status === "DRAFT");
    expect(canDeleteDraft("ADMIN", "DRAFT")).toBe(false);
  });

  it("lets only Head Office choose the office, before the case has a number (CASE-3)", () => {
    expect(canChangeOffice("MINISTRY_OFFICER", null)).toBe(true);
    expect(canChangeOffice("MINISTRY_OFFICER", "DRAFT")).toBe(true);
    expect(canChangeOffice("MINISTRY_OFFICER", "RETURNED")).toBe(false);
    expect(canChangeOffice("DS_OFFICER", null)).toBe(false);
  });
});

/**
 * Application spec, Case statuses and transitions: [move, from, to, who]. Every other combination
 * must be refused (STS-1).
 */
const ALLOWED: [Move, CaseStatus | null, CaseStatus, Mover[]][] = [
  // Change 0006.
  ["save", null, "AWAITING_ALLOCATION", ["DS_OFFICER", "MINISTRY_OFFICER"]],
  ["allocate", "AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT", ["MINISTRY_OFFICER"]],
  ["release", "ALLOCATED_TO_DISTRICT", "ALLOCATION_RECEIVED", ["DISTRICT_OFFICER"]],
  ["start", "ALLOCATION_RECEIVED", "IN_PROGRESS", ["SYSTEM"]],
  ["unstart", "IN_PROGRESS", "ALLOCATION_RECEIVED", ["SYSTEM"]],
  ["complete", "IN_PROGRESS", "COMPLETED", ["SYSTEM"]],
  // Version 1's, until change 0006's tasks 4 to 6 remove them.
  ["submit", "DRAFT", "SUBMITTED", ["DS_OFFICER", "MINISTRY_OFFICER"]],
  ["submit", "RETURNED", "SUBMITTED", ["DS_OFFICER", "MINISTRY_OFFICER"]],
  ["verify", "SUBMITTED", "VERIFIED", ["MINISTRY_OFFICER"]],
  ["sendBack", "SUBMITTED", "RETURNED", ["MINISTRY_OFFICER"]],
  ["reject", "SUBMITTED", "REJECTED", ["MINISTRY_OFFICER"]],
  ["releaseV1", "VERIFIED", "IN_PROGRESS", ["MINISTRY_OFFICER"]],
  ["stop", "VERIFIED", "STOPPED", ["MINISTRY_OFFICER"]],
  ["stop", "IN_PROGRESS", "STOPPED", ["MINISTRY_OFFICER"]],
  ["reopen", "STOPPED", "VERIFIED", ["MINISTRY_OFFICER"]],
  ["reopen", "STOPPED", "IN_PROGRESS", ["MINISTRY_OFFICER"]],
];
const MOVERS: Mover[] = ["DS_OFFICER", "DISTRICT_OFFICER", "MINISTRY_OFFICER", "VIEWER", "ADMIN", "SYSTEM"];

describe("status changes (application spec, Case statuses and transitions)", () => {
  it("allows exactly the moves in the table, to the right status and by the right people (STS-1)", () => {
    for (const move of Object.keys(MOVES) as Move[]) {
      for (const from of [null, ...STATUSES]) {
        for (const to of STATUSES) {
          for (const by of MOVERS) {
            const allowed = ALLOWED.some(([m, f, t, who]) => m === move && f === from && t === to && who.includes(by));
            const refusal = moveRefusal(by, move, from, to);
            expect(refusal === null, `${by} ${move} ${from} → ${to}`).toBe(allowed);
          }
        }
      }
    }
  });

  it("says whether the role or the status is the problem", () => {
    expect(moveRefusal("DS_OFFICER", "verify", "SUBMITTED")).toBe("roleNotAllowed");
    expect(moveRefusal("MINISTRY_OFFICER", "verify", "VERIFIED")).toBe("notAllowedNow");
    expect(moveRefusal("MINISTRY_OFFICER", "complete", "IN_PROGRESS")).toBe("roleNotAllowed");
    expect(moveRefusal("MINISTRY_OFFICER", "release", "ALLOCATED_TO_DISTRICT")).toBe("roleNotAllowed");
    expect(moveRefusal("DISTRICT_OFFICER", "release", "AWAITING_ALLOCATION")).toBe("notAllowedNow");
  });

  it("needs a reason to send back, reject, stop or reopen (CHK-3, CLS-2, CLS-3)", () => {
    const withReason = (Object.keys(MOVES) as Move[]).filter((move) => MOVES[move].needsReason);
    expect(withReason.sort()).toEqual(["reject", "reopen", "sendBack", "stop"]);
  });

  it("tells the offices about every move but saving, submitting, starting and undoing a start (NTF-1)", () => {
    const told = (Object.keys(MOVES) as Move[]).filter((move) => MOVES[move].notify !== null);
    expect(told.sort()).toEqual([
      "allocate",
      "complete",
      "reject",
      "release",
      "releaseV1",
      "reopen",
      "sendBack",
      "stop",
      "verify",
    ]);
  });

  it("has no way out of a completed or rejected case (STS-2)", () => {
    expect(movesFrom("COMPLETED")).toEqual([]);
    expect(movesFrom("REJECTED")).toEqual([]);
    expect(movesFrom("SUBMITTED").sort()).toEqual(["reject", "sendBack", "verify"]);
  });

  it("takes a case from its allocation to its first installment and back (change 0006)", () => {
    expect(movesFrom("AWAITING_ALLOCATION")).toEqual(["allocate"]);
    expect(movesFrom("ALLOCATED_TO_DISTRICT")).toEqual(["release"]);
    expect(movesFrom("ALLOCATION_RECEIVED")).toEqual(["start"]);
    expect(movesFrom("IN_PROGRESS").sort()).toEqual(["complete", "stop", "unstart"]);
  });
});

describe("Application Numbers (CASE-12)", () => {
  it("compares them in capitals without spaces", () => {
    expect(applicationKey("kdw / 147")).toBe("KDW/147");
    expect(applicationKey(" KDW/147 ")).toBe("KDW/147");
    expect(applicationKey("ප්‍රා/12 අ")).toBe("ප්‍රා/12අ");
  });
});

describe("case numbers (CASE-5)", () => {
  it("is the office code, the year and at least three digits", () => {
    expect(formatCaseNumber("HMG", 2026, 11)).toBe("HMG-2026-011");
    expect(formatCaseNumber("HMG", 2026, 1)).toBe("HMG-2026-001");
    expect(formatCaseNumber("KDW", 2027, 1234)).toBe("KDW-2027-1234");
  });
});
