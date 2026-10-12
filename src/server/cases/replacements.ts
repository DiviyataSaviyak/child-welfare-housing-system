import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import { officeFilter, type Viewer } from "../permissions";

/**
 * CASE-11: replacing a beneficiary. When Head Office rejects or stops a case it may ask the DS office
 * for another name in its place (`another_name_requested`). The new person is a new case that names
 * the old one (`replaces_case_id`, unique, so each case is replaced once).
 */

/** Only these statuses can be waiting for a replacement (a database check). */
export const CLOSED: readonly CaseStatus[] = ["REJECTED", "STOPPED"];

/** A case waiting for, or given, another name: what the form, the to-do panel and the case pages show. */
export type ReplacementRequest = {
  id: string;
  caseNumber: string | null;
  dsOfficeId: number;
  name: string | null;
  childName: string | null;
  status: CaseStatus;
  /** Head Office's rejection or stop that asked for it: the day and the reason. */
  decidedAt: Date | null;
  reason: string | null;
};

/** The decision that closed the case: its latest rejection or stop. */
const CLOSING_DECISION = {
  where: { type: { in: ["REJECT", "STOP"] } },
  orderBy: { at: "desc" },
  take: 1,
  select: { at: true, reason: true },
} as const satisfies Prisma.Case$decisionsArgs;

export const REQUEST_SELECT = {
  id: true,
  caseNumber: true,
  dsOfficeId: true,
  name: true,
  childName: true,
  status: true,
  decisions: CLOSING_DECISION,
} as const satisfies Prisma.CaseSelect;

export function toRequest({
  decisions,
  ...found
}: Prisma.CaseGetPayload<{ select: typeof REQUEST_SELECT }>): ReplacementRequest {
  return { ...found, decidedAt: decisions[0]?.at ?? null, reason: decisions[0]?.reason ?? null };
}

/**
 * The cases the viewer may see that wait for another name, oldest decision first (HOME-3, CASE-11).
 * `forCaseId` also keeps the one that case already replaces, so its form still offers it.
 */
export async function openRequests(
  db: PrismaClient,
  viewer: Viewer,
  options: { dsOfficeId?: number; forCaseId?: string } = {},
): Promise<ReplacementRequest[]> {
  const scope = officeFilter(viewer);
  if (!scope) return [];
  const found = await db.case.findMany({
    where: {
      ...scope,
      ...(options.dsOfficeId ? { dsOfficeId: options.dsOfficeId } : {}),
      anotherNameRequested: true,
      OR: [
        { replacedBy: { is: null } },
        ...(options.forCaseId ? [{ replacedBy: { is: { id: options.forCaseId } } }] : []),
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 200,
    select: REQUEST_SELECT,
  });
  return found.map(toRequest);
}

/**
 * Why `caseId` can't be entered in place of `targetId` within `dsOfficeId`, or null when it can: the
 * target must be a case of the same office that waits for another name, not yet taken by another case.
 */
export async function replacementRefusal(
  db: PrismaClient | Prisma.TransactionClient,
  input: { caseId: string; targetId: string; dsOfficeId: number },
): Promise<"replacementUnavailable" | null> {
  if (input.targetId === input.caseId) return "replacementUnavailable";
  const target = await db.case.findUnique({
    where: { id: input.targetId },
    select: { dsOfficeId: true, status: true, anotherNameRequested: true, replacedBy: { select: { id: true } } },
  });
  const open =
    target !== null &&
    target.dsOfficeId === input.dsOfficeId &&
    target.anotherNameRequested &&
    CLOSED.includes(target.status) &&
    (target.replacedBy === null || target.replacedBy.id === input.caseId);
  return open ? null : "replacementUnavailable";
}
