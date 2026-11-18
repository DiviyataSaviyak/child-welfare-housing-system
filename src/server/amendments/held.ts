import type { Prisma } from "@/generated/prisma/client";

/**
 * AMD-3, AMD-12: a case is held while an amendment of it waits for the Ministry, or while its DS's request
 * for a nomination waits for the District: no installment can start or be paid, no stage be recorded, and
 * no other amendment or request be made. These are the pieces every query and command that checks it uses.
 */

/** Selects the waiting amendment, if any (`amendments: WAITING_ONE`, `nominations: WAITING_ONE`). */
export const WAITING_ONE = { where: { status: "WAITING" }, take: 1, select: { id: true } } as const;

/** A case selected with both `WAITING_ONE`s: whether it is held. */
export const isHeld = (found: { amendments: unknown[]; nominations: unknown[] }) =>
  found.amendments.length > 0 || found.nominations.length > 0;

/** A `where` for the cases that are not held. */
export const NOT_HELD = {
  amendments: { none: { status: "WAITING" } },
  nominations: { none: { status: "WAITING" } },
} as const satisfies Prisma.CaseWhereInput;

/** Reads, inside a transaction that holds the case's row, whether the case is held. */
export async function heldNow(tx: Prisma.TransactionClient, caseId: string): Promise<boolean> {
  const [amendments, nominations] = await Promise.all([
    tx.amendment.count({ where: { caseId, status: "WAITING" } }),
    tx.nomination.count({ where: { caseId, status: "WAITING" } }),
  ]);
  return amendments + nominations > 0;
}
