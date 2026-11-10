import type { CaseStatus } from "@/generated/prisma/enums";
import type { Role } from "../auth/roles";

/**
 * Who may change a case's details, and when (application spec, Roles and permissions; Case statuses
 * and transitions). Office scope is checked separately, through the permission layer (`canActOn`); these
 * rules only look at the role and the case's status. Status changes themselves are in transitions.ts.
 */

/** CASE-8, CASE-9: until the Ministry's allocation, the DS of residence may still correct or delete it. */
const AWAITING: readonly CaseStatus[] = ["AWAITING_ALLOCATION"];

/** CASE-9: from the allocation until it is completed, only the Ministry changes its details. */
const RUNNING: readonly CaseStatus[] = [
  "AWAITING_ALLOCATION",
  "ALLOCATED_TO_DISTRICT",
  "ALLOCATION_RECEIVED",
  "IN_PROGRESS",
];

const EDITABLE: Record<Role, readonly CaseStatus[]> = {
  DS_OFFICER: AWAITING,
  DISTRICT_OFFICER: [],
  MINISTRY_OFFICER: RUNNING,
  VIEWER: [],
  ADMIN: [],
};

/**
 * CASE-9: while a case awaits its allocation, its DS of residence or the Ministry may change any of its
 * details; after that, only the Ministry, and every changed field is logged. A completed case can't be
 * changed (STS-2).
 */
export function canEditDetails(role: Role, status: CaseStatus): boolean {
  return EDITABLE[role].includes(status);
}

/** The statuses canEditDetails() allows a role, for a query that must not change anything else. */
export function editableStatuses(role: Role): readonly CaseStatus[] {
  return EDITABLE[role];
}

/** Who may start a case or save a case form at all; every other account only looks (PRM-5). */
export function canEnterCases(role: Role): boolean {
  return role === "DS_OFFICER" || role === "MINISTRY_OFFICER";
}

/** CASE-8: a case awaiting its allocation can be deleted, by its DS of residence or by the Ministry. */
export function canDeleteCase(role: Role, status: CaseStatus): boolean {
  return canEnterCases(role) && AWAITING.includes(status);
}

/**
 * CASE-3: only the Ministry chooses a case's DS office of residence, for a new case or one awaiting its
 * allocation. The Application Number is unique within that office (CASE-12), and the money follows the
 * office where it is built, so nothing else depends on it until then.
 */
export function canChangeOffice(role: Role, status: CaseStatus | null): boolean {
  return role === "MINISTRY_OFFICER" && (status === null || AWAITING.includes(status));
}

/**
 * CASE-13: the DS where it is built can change only while the case awaits its allocation, because the
 * Ministry's letter goes to that DS's district.
 */
export function canChangeBuildOffice(status: CaseStatus | null): boolean {
  return status === null || AWAITING.includes(status);
}
