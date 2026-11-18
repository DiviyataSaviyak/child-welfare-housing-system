import type { Prisma } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import { heldNow } from "../amendments/held";
import { Refusal } from "./refusal";

/**
 * Takes a case for a change made from its page (CASE-10, ERR-3). Its version goes up by one, but only
 * while it still has the version the page showed and a status that allows the change; otherwise the
 * change is refused with "conflict" and the caller's transaction rolls back. The case's row then stays
 * locked until the transaction ends, so two changes to one case take turns. The case's last update
 * moves to now, which is how the "no update for 30 days" lists see it (HOME-3, DSH-1).
 *
 * Every installment and stage change goes through it, so it also refuses a case whose amendment waits for
 * the Ministry, or whose request for a nomination waits for the District, with "amendmentWaiting" (AMD-3,
 * AMD-12, INS-5, STG-5). It reads that after taking the row, so an amendment or request made at the same
 * moment either went first and is seen, or waits for this change.
 */
export async function claimCase(
  tx: Prisma.TransactionClient,
  current: { id: string; version: number },
  statuses: readonly CaseStatus[],
): Promise<void> {
  const claimed = await tx.case.updateMany({
    where: { id: current.id, version: current.version, status: { in: [...statuses] } },
    data: { version: { increment: 1 } },
  });
  if (claimed.count === 0) throw new Refusal("conflict");
  if (await heldNow(tx, current.id)) throw new Refusal("amendmentWaiting");
}
