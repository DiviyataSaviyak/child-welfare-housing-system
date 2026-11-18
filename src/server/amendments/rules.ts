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
  /**
   * An amendment of the case waits for the Ministry, or a request for a nomination waits for the District
   * (AMD-3, AMD-12).
   */
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
 * AMD-1 to AMD-3: why the account can't submit an amendment for the case now, or null when it can. Asking
 * the District to nominate a new beneficiary follows the same rules (AMD-12).
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

/** AMD-11: where the existing case's allocation goes back to, if it does: only ever its District. */
export type ReturnedTo = "DISTRICT";

/** AMD-5, AMD-11: the step the new case starts at, and whether the money goes back to get there. */
export type ReplacementStep = {
  status: Extract<CaseStatus, "AWAITING_ALLOCATION" | "ALLOCATED_TO_DISTRICT" | "ALLOCATION_RECEIVED">;
  /** Null when the money is already where the new beneficiary is built. */
  returnedTo: ReturnedTo | null;
};

/**
 * AMD-8, AMD-11: the new beneficiary may be built in any DS office before the Ministry's letter, and in a DS
 * office of the letter's district after it (whether it is active is checked apart); null for any other
 * place, which is refused (`buildOfficeNotAllowed`). When it is outside the DS office the money has reached
 * (`ALLOCATION_RECEIVED`), the new case goes back to the District, which releases it again:
 *
 * | Existing case          | Built in                         | New case               | Money goes back to |
 * | AWAITING_ALLOCATION    | any DS office                    | AWAITING_ALLOCATION    | (nothing to return) |
 * | ALLOCATED_TO_DISTRICT  | the same district                | ALLOCATED_TO_DISTRICT  | (nothing to return) |
 * | ALLOCATION_RECEIVED    | the same DS office               | ALLOCATION_RECEIVED    | (nothing to return) |
 * | ALLOCATION_RECEIVED    | another DS office, same district | ALLOCATED_TO_DISTRICT  | the District       |
 * | after the letter       | another district                 | (refused)              |                    |
 *
 * Until 18 Nov 2026 another district sent the money back to the Ministry (change 0009 task 4); the owner
 * then limited it to the letter's district. Any other status can't be amended (AMD-2); it is given as it is,
 * with nothing to return.
 */
export function replacementStep(
  existing: { status: CaseStatus; buildDsOffice: { id: number; districtId: number } },
  built: { id: number; districtId: number },
): ReplacementStep | null {
  const sameDistrict = built.districtId === existing.buildDsOffice.districtId;
  switch (existing.status) {
    case "ALLOCATED_TO_DISTRICT":
      return sameDistrict ? { status: "ALLOCATED_TO_DISTRICT", returnedTo: null } : null;
    case "ALLOCATION_RECEIVED":
      if (!sameDistrict) return null;
      return built.id === existing.buildDsOffice.id
        ? { status: "ALLOCATION_RECEIVED", returnedTo: null }
        : { status: "ALLOCATED_TO_DISTRICT", returnedTo: "DISTRICT" };
    default:
      return { status: "AWAITING_ALLOCATION", returnedTo: null };
  }
}

/** AMD-8: whether the letter has gone, so the new beneficiary must be built in its district. */
export const afterLetter = (status: CaseStatus) =>
  status === "ALLOCATED_TO_DISTRICT" || status === "ALLOCATION_RECEIVED";

export type NominateRefusal =
  /** Not a District officer of the district where the case is built (AMD-13, PRM-5). */
  | "roleNotAllowed"
  /** The request was nominated or sent back already. */
  | "nominationDecided";

/**
 * AMD-13: why the account can't nominate or send back a request now, or null when it can. `district` is
 * whether the case is built in the account's district (`canActOn(…, "nominate")`).
 */
export function nominateRefusal(
  who: { role: Role; district: boolean },
  request: { status: "WAITING" | "NOMINATED" | "SENT_BACK" },
): NominateRefusal | null {
  if (who.role !== "DISTRICT_OFFICER" || !who.district) return "roleNotAllowed";
  if (request.status !== "WAITING") return "nominationDecided";
  return null;
}
