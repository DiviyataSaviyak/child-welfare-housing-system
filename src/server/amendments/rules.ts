import type { CaseStatus } from "@/generated/prisma/enums";
import type { Role } from "../auth/roles";

/**
 * Who may submit an amendment, and where the new beneficiary may be built (application spec, Amendments:
 * AMD-1, AMD-2, AMD-8). Plain functions: the screens use them to show or hide the action, and the
 * commands to refuse it, again inside the transaction that locks the case.
 */

/** AMD-1: before and after the allocation, until the first installment is paid. */
export const AMENDABLE_STATUSES: readonly CaseStatus[] = [
  "AWAITING_ALLOCATION",
  "ALLOCATED_TO_DISTRICT",
  "ALLOCATION_RECEIVED",
];

/** What AMD-1 to AMD-3 read about the case. */
export type AmendFacts = {
  status: CaseStatus;
  /** An installment of the case has been paid (`RELEASED`). */
  paid: boolean;
  /** An amendment of the case waits for the Ministry. */
  waiting: boolean;
};

export type AmendRefusal =
  /** Not a CRPO of the case's DS of residence (AMD-1, PRM-5). */
  | "roleNotAllowed"
  /** Paid, completed or replaced (AMD-2). */
  | "amendmentNotAllowed"
  /** One already waits (AMD-3). */
  | "amendmentWaiting";

/**
 * AMD-1 to AMD-3: why the account can't submit an amendment for the case now, or null when it can.
 * `residence` is whether the case's DS of residence is the account's own (`canActOn(…, "amend")`): the CRPO
 * of the DS where it is built, when that is another DS, only sees it.
 */
export function amendRefusal(who: { role: Role; residence: boolean }, facts: AmendFacts): AmendRefusal | null {
  if (who.role !== "DS_OFFICER" || !who.residence) return "roleNotAllowed";
  // AMD-2: no exceptions, whoever asks.
  if (!AMENDABLE_STATUSES.includes(facts.status) || facts.paid) return "amendmentNotAllowed";
  if (facts.waiting) return "amendmentWaiting";
  return null;
}

export function canAmend(who: { role: Role; residence: boolean }, facts: AmendFacts): boolean {
  return amendRefusal(who, facts) === null;
}

/** AMD-8: the DS offices the new beneficiary may be built in. */
export type BuildOffices =
  /** Before the Ministry's letter: any active DS office. */
  | { kind: "any" }
  /** On a letter to a district: a DS office of that district. */
  | { kind: "district"; districtId: number }
  /** Released by the District to a DS office: that office. */
  | { kind: "office"; dsOfficeId: number };

/**
 * AMD-8: where the new beneficiary may be built, by how far the existing case has come, because the money
 * has already gone there: the Ministry's letter to the district where it is built, then the District's
 * release to that DS office.
 */
export function buildOfficesFor(existing: {
  status: CaseStatus;
  buildDsOffice: { id: number; districtId: number };
}): BuildOffices {
  switch (existing.status) {
    case "ALLOCATED_TO_DISTRICT":
      return { kind: "district", districtId: existing.buildDsOffice.districtId };
    case "ALLOCATION_RECEIVED":
      return { kind: "office", dsOfficeId: existing.buildDsOffice.id };
    default:
      return { kind: "any" };
  }
}

/** AMD-8: whether the new beneficiary may be built in this DS office. Whether it is active is checked apart. */
export function buildOfficeAllowed(limit: BuildOffices, office: { id: number; districtId: number }): boolean {
  switch (limit.kind) {
    case "any":
      return true;
    case "district":
      return office.districtId === limit.districtId;
    case "office":
      return office.id === limit.dsOfficeId;
  }
}
