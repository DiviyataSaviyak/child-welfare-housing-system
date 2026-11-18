import type { CaseStatus } from "@/generated/prisma/enums";
import type { Role } from "../auth/roles";

/**
 * Who may submit an amendment, and what building the new beneficiary elsewhere means for the money
 * (application spec, Amendments: AMD-1, AMD-2, AMD-8, AMD-11). Plain functions: the screens use them to show
 * or hide the action and to say where the money goes, and the commands to refuse it and to step the new case
 * back, again inside the transaction that locks the case.
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

/** AMD-11: how far the existing case's allocation goes back, if it does. */
export type ReturnedTo = "DISTRICT" | "MINISTRY";

/** AMD-5, AMD-11: the step the new case starts at, and how far the money goes back to get there. */
export type ReplacementStep = {
  status: Extract<CaseStatus, "AWAITING_ALLOCATION" | "ALLOCATED_TO_DISTRICT" | "ALLOCATION_RECEIVED">;
  /** Null when the money is already where the new beneficiary is built. */
  returnedTo: ReturnedTo | null;
};

/**
 * AMD-8, AMD-11: the new beneficiary may be built in any DS office (whether it is active is checked apart).
 * When that is outside the place the existing case's money has reached (the letter's district once it is
 * `ALLOCATED_TO_DISTRICT`, the District's DS office once it is `ALLOCATION_RECEIVED`), the new case goes back
 * to the step the money must take again, and the money goes back up as far as that:
 *
 * | Existing case          | Built in                        | New case                | Money goes back to |
 * | AWAITING_ALLOCATION    | any DS office                   | AWAITING_ALLOCATION     | (nothing to return) |
 * | ALLOCATED_TO_DISTRICT  | the same district               | ALLOCATED_TO_DISTRICT   | (nothing to return) |
 * | ALLOCATED_TO_DISTRICT  | another district                | AWAITING_ALLOCATION     | the Ministry       |
 * | ALLOCATION_RECEIVED    | the same DS office              | ALLOCATION_RECEIVED     | (nothing to return) |
 * | ALLOCATION_RECEIVED    | another DS office, same district | ALLOCATED_TO_DISTRICT | the District       |
 * | ALLOCATION_RECEIVED    | another district                | AWAITING_ALLOCATION     | the Ministry       |
 *
 * Any other status can't be amended (AMD-2); it is given as it is, with nothing to return.
 */
export function replacementStep(
  existing: { status: CaseStatus; buildDsOffice: { id: number; districtId: number } },
  built: { id: number; districtId: number },
): ReplacementStep {
  const sameDistrict = built.districtId === existing.buildDsOffice.districtId;
  switch (existing.status) {
    case "ALLOCATED_TO_DISTRICT":
      return sameDistrict
        ? { status: "ALLOCATED_TO_DISTRICT", returnedTo: null }
        : { status: "AWAITING_ALLOCATION", returnedTo: "MINISTRY" };
    case "ALLOCATION_RECEIVED":
      if (built.id === existing.buildDsOffice.id) return { status: "ALLOCATION_RECEIVED", returnedTo: null };
      return sameDistrict
        ? { status: "ALLOCATED_TO_DISTRICT", returnedTo: "DISTRICT" }
        : { status: "AWAITING_ALLOCATION", returnedTo: "MINISTRY" };
    default:
      return { status: "AWAITING_ALLOCATION", returnedTo: null };
  }
}
