import { describe, expect, it } from "vitest";
import type { CaseStatus } from "@/generated/prisma/enums";
import { CaseStatus as STATUS_VALUES } from "@/generated/prisma/enums";
import { applicationKey } from "./numbers";
import { canChangeBuildOffice, canChangeOffice, canDeleteCase, canEditDetails, kindsOffered } from "./rules";
import { type Move, moveRefusal, MOVES, type Mover, movesFrom } from "./transitions";

const STATUSES = Object.values(STATUS_VALUES) as CaseStatus[];

describe("case rules (application spec, Roles and permissions; Case statuses and transitions)", () => {
  const RUNNING = ["AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT", "ALLOCATION_RECEIVED", "IN_PROGRESS"];

  it("lets the DS change a case only while it awaits its allocation (CASE-9)", () => {
    for (const status of STATUSES) {
      expect(canEditDetails("DS_OFFICER", status), status).toBe(status === "AWAITING_ALLOCATION");
      for (const role of ["DISTRICT_OFFICER", "VIEWER", "ADMIN"] as const) {
        expect(canEditDetails(role, status), `${role} ${status}`).toBe(false);
      }
    }
  });

  it("lets the Ministry change a case until it is completed (CASE-9, STS-2)", () => {
    for (const status of STATUSES) {
      expect(canEditDetails("MINISTRY_OFFICER", status), status).toBe(RUNNING.includes(status));
    }
  });

  it("deletes a case only while it awaits its allocation, by the DS or the Ministry (CASE-8)", () => {
    for (const status of STATUSES) {
      expect(canDeleteCase("DS_OFFICER", status), status).toBe(status === "AWAITING_ALLOCATION");
      expect(canDeleteCase("MINISTRY_OFFICER", status), status).toBe(status === "AWAITING_ALLOCATION");
      expect(canDeleteCase("VIEWER", status), status).toBe(false);
    }
    expect(canDeleteCase("ADMIN", "AWAITING_ALLOCATION")).toBe(false);
  });

  it("lets only the Ministry choose the office, until the allocation (CASE-3)", () => {
    expect(canChangeOffice("MINISTRY_OFFICER", null)).toBe(true);
    expect(canChangeOffice("MINISTRY_OFFICER", "AWAITING_ALLOCATION")).toBe(true);
    expect(canChangeOffice("MINISTRY_OFFICER", "ALLOCATED_TO_DISTRICT")).toBe(false);
    expect(canChangeOffice("DS_OFFICER", null)).toBe(false);
  });

  it("changes where it is built only until the allocation (CASE-13)", () => {
    for (const status of STATUSES) expect(canChangeBuildOffice(status), status).toBe(status === "AWAITING_ALLOCATION");
    expect(canChangeBuildOffice(null)).toBe(true);
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
];
const MOVERS: Mover[] = ["DS_OFFICER", "DISTRICT_OFFICER", "MINISTRY_OFFICER", "VIEWER", "ADMIN", "SYSTEM"];

describe("status changes (application spec, Case statuses and transitions)", () => {
  it("allows exactly the moves in the table, to the right status and by the right people (STS-1)", () => {
    for (const move of Object.keys(MOVES) as Move[]) {
      for (const from of [null, ...STATUSES]) {
        for (const to of STATUSES) {
          for (const by of MOVERS) {
            const allowed = ALLOWED.some(([m, f, t, who]) => m === move && f === from && t === to && who.includes(by));
            const made = moveRefusal(by, move, from) === null && MOVES[move].to === to;
            expect(made, `${by} ${move} ${from} → ${to}`).toBe(allowed);
          }
        }
      }
    }
  });

  it("says whether the role or the status is the problem", () => {
    expect(moveRefusal("DS_OFFICER", "allocate", "AWAITING_ALLOCATION")).toBe("roleNotAllowed");
    expect(moveRefusal("MINISTRY_OFFICER", "allocate", "ALLOCATED_TO_DISTRICT")).toBe("notAllowedNow");
    expect(moveRefusal("MINISTRY_OFFICER", "complete", "IN_PROGRESS")).toBe("roleNotAllowed");
    expect(moveRefusal("MINISTRY_OFFICER", "release", "ALLOCATED_TO_DISTRICT")).toBe("roleNotAllowed");
    expect(moveRefusal("DISTRICT_OFFICER", "release", "AWAITING_ALLOCATION")).toBe("notAllowedNow");
  });

  it("has no check, send back, reject, stop or reopen (change 0006, AC-58)", () => {
    expect(Object.keys(MOVES).sort()).toEqual(["allocate", "complete", "release", "save", "start", "unstart"].sort());
    expect(STATUSES.toSorted()).toEqual(
      ["AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT", "ALLOCATION_RECEIVED", "IN_PROGRESS", "COMPLETED"].sort(),
    );
  });

  it("tells the offices about every move but saving, starting and undoing a start (NTF-1)", () => {
    const told = (Object.keys(MOVES) as Move[]).filter((move) => MOVES[move].notify !== null);
    expect(told.sort()).toEqual(["allocate", "complete", "release"]);
  });

  it("has no way out of a completed case (STS-2)", () => {
    expect(movesFrom("COMPLETED")).toEqual([]);
  });

  it("takes a case from its allocation to its first installment and back (change 0006)", () => {
    expect(movesFrom("AWAITING_ALLOCATION")).toEqual(["allocate"]);
    expect(movesFrom("ALLOCATED_TO_DISTRICT")).toEqual(["release"]);
    expect(movesFrom("ALLOCATION_RECEIVED")).toEqual(["start"]);
    expect(movesFrom("IN_PROGRESS").sort()).toEqual(["complete", "unstart"]);
  });
});

describe("the kind of help after the District's release (CASE-9)", () => {
  it("changes freely until the release, then only within its group", () => {
    expect(kindsOffered(null, null)).toHaveLength(5);
    expect(kindsOffered("AWAITING_ALLOCATION", "NEW_HOUSE")).toHaveLength(5);
    expect(kindsOffered("ALLOCATED_TO_DISTRICT", "LAND_ONLY")).toHaveLength(5);
    expect(kindsOffered("ALLOCATION_RECEIVED", "NEW_HOUSE")).toEqual(["NEW_HOUSE", "RENOVATION"]);
    expect(kindsOffered("IN_PROGRESS", "LAND_AND_BUILD")).toEqual(["LAND_ONLY", "LAND_AND_BUILD", "LAND_WITH_HOUSE"]);
    expect(kindsOffered("COMPLETED", "RENOVATION")).toEqual(["NEW_HOUSE", "RENOVATION"]);
  });
});

describe("Application Numbers (CASE-12)", () => {
  it("compares them in capitals without spaces", () => {
    expect(applicationKey("kdw / 147")).toBe("KDW/147");
    expect(applicationKey(" KDW/147 ")).toBe("KDW/147");
    expect(applicationKey("ප්‍රා/12 අ")).toBe("ප්‍රා/12අ");
  });
});
