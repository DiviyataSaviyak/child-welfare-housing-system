import { describe, expect, it } from "vitest";
import type { CaseStatus } from "@/generated/prisma/enums";
import { formatCaseNumber } from "./numbers";
import { canChangeOffice, canDeleteDraft, canEditDetails, isBeingEntered, mustStayComplete } from "./rules";
import { type Move, moveRefusal, MOVES, type Mover, movesFrom } from "./transitions";

const STATUSES: CaseStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "RETURNED",
  "VERIFIED",
  "IN_PROGRESS",
  "COMPLETED",
  "REJECTED",
  "STOPPED",
];

describe("case rules (application spec, Roles and permissions; Case statuses and transitions)", () => {
  it("lets the office change only drafts and returned cases, and nobody a case being checked (CASE-7, STS-3)", () => {
    for (const status of STATUSES) {
      const entry = status === "DRAFT" || status === "RETURNED";
      expect(canEditDetails("DS_OFFICER", status), status).toBe(entry);
      expect(isBeingEntered(status), status).toBe(entry);
      expect(canEditDetails("ADMIN", status), status).toBe(false);
    }
    expect(canEditDetails("HO_OFFICER", "SUBMITTED")).toBe(false);
  });

  it("lets only Head Office change a verified case while it runs, and keeps it complete (CASE-9)", () => {
    const afterCheck = ["VERIFIED", "IN_PROGRESS"];
    for (const status of STATUSES) {
      const entry = status === "DRAFT" || status === "RETURNED";
      expect(canEditDetails("HO_OFFICER", status), status).toBe(entry || afterCheck.includes(status));
      expect(mustStayComplete(status), status).toBe(afterCheck.includes(status));
    }
  });

  it("deletes drafts only (CASE-8)", () => {
    for (const status of STATUSES) expect(canDeleteDraft("DS_OFFICER", status), status).toBe(status === "DRAFT");
    expect(canDeleteDraft("ADMIN", "DRAFT")).toBe(false);
  });

  it("lets only Head Office choose the office, before the case has a number (CASE-3)", () => {
    expect(canChangeOffice("HO_OFFICER", null)).toBe(true);
    expect(canChangeOffice("HO_OFFICER", "DRAFT")).toBe(true);
    expect(canChangeOffice("HO_OFFICER", "RETURNED")).toBe(false);
    expect(canChangeOffice("DS_OFFICER", null)).toBe(false);
  });
});

/**
 * Application spec, Case statuses and transitions: [move, from, to, who]. Every other combination
 * must be refused (STS-1).
 */
const ALLOWED: [Move, CaseStatus, CaseStatus, Mover[]][] = [
  ["submit", "DRAFT", "SUBMITTED", ["DS_OFFICER", "HO_OFFICER"]],
  ["submit", "RETURNED", "SUBMITTED", ["DS_OFFICER", "HO_OFFICER"]],
  ["verify", "SUBMITTED", "VERIFIED", ["HO_OFFICER"]],
  ["sendBack", "SUBMITTED", "RETURNED", ["HO_OFFICER"]],
  ["reject", "SUBMITTED", "REJECTED", ["HO_OFFICER"]],
  ["release", "VERIFIED", "IN_PROGRESS", ["HO_OFFICER"]],
  ["complete", "IN_PROGRESS", "COMPLETED", ["SYSTEM"]],
  ["stop", "VERIFIED", "STOPPED", ["HO_OFFICER"]],
  ["stop", "IN_PROGRESS", "STOPPED", ["HO_OFFICER"]],
  ["reopen", "STOPPED", "VERIFIED", ["HO_OFFICER"]],
  ["reopen", "STOPPED", "IN_PROGRESS", ["HO_OFFICER"]],
];
const MOVERS: Mover[] = ["DS_OFFICER", "HO_OFFICER", "ADMIN", "SYSTEM"];

describe("status changes (application spec, Case statuses and transitions)", () => {
  it("allows exactly the moves in the table, to the right status and by the right people (STS-1)", () => {
    for (const move of Object.keys(MOVES) as Move[]) {
      for (const from of STATUSES) {
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
    expect(moveRefusal("HO_OFFICER", "verify", "VERIFIED")).toBe("notAllowedNow");
    expect(moveRefusal("HO_OFFICER", "complete", "IN_PROGRESS")).toBe("roleNotAllowed");
  });

  it("needs a reason to send back, reject, stop or reopen (CHK-3, CLS-2, CLS-3)", () => {
    const withReason = (Object.keys(MOVES) as Move[]).filter((move) => MOVES[move].needsReason);
    expect(withReason.sort()).toEqual(["reject", "reopen", "sendBack", "stop"]);
  });

  it("tells the DS office about every decision but the submit (NTF-1)", () => {
    const told = (Object.keys(MOVES) as Move[]).filter((move) => MOVES[move].notify !== null);
    expect(told.sort()).toEqual(["complete", "reject", "release", "reopen", "sendBack", "stop", "verify"]);
  });

  it("has no way out of a completed or rejected case (STS-2)", () => {
    expect(movesFrom("COMPLETED")).toEqual([]);
    expect(movesFrom("REJECTED")).toEqual([]);
    expect(movesFrom("SUBMITTED").sort()).toEqual(["reject", "sendBack", "verify"]);
  });
});

describe("case numbers (CASE-5)", () => {
  it("is the office code, the year and at least three digits", () => {
    expect(formatCaseNumber("HMG", 2026, 11)).toBe("HMG-2026-011");
    expect(formatCaseNumber("HMG", 2026, 1)).toBe("HMG-2026-001");
    expect(formatCaseNumber("KDW", 2027, 1234)).toBe("KDW-2027-1234");
  });
});
