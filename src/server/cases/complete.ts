import type { Prisma } from "@/generated/prisma/client";
import type { InstallmentStatus, Kind } from "@/generated/prisma/enums";
import { INSTALLMENT_COUNT, paidOut, RELEASE_AMOUNT } from "@/lib/money";
import { isHouseKind, stageKind } from "@/lib/validation/case";
import { applyMove, type MovingCase } from "./transitions";

type PaidRow = { number: number; status: InstallmentStatus; amount: number };

/**
 * Whether the money of CLS-1 is all paid: for a house kind, installment 4 is released; for a land kind,
 * the released installments add up to the Rs. 2,000,000, in however many of them (INS-7).
 */
export function paidInFull(kind: Kind, installments: readonly PaidRow[]): boolean {
  if (isHouseKind(kind)) {
    return installments.some((i) => i.number === INSTALLMENT_COUNT && i.status === "RELEASED");
  }
  return paidOut(installments) >= RELEASE_AMOUNT;
}

/**
 * CLS-1: a case is finished when its money is paid in full (`paidInFull`) and it has reached the last
 * active stage of the list its kind follows (`stageKind`). A kind with no active stages needs only the
 * money: renovation until its stages are defined, and `LAND_ONLY` and `LAND_WITH_HOUSE`, which follow no
 * list (STG-4). `LAND_AND_BUILD` needs the last new-house stage too.
 */
export function isComplete(input: {
  kind: Kind;
  installments: readonly PaidRow[];
  lastActiveStageId: number | null;
  reachedStageIds: readonly number[];
}): boolean {
  if (!paidInFull(input.kind, input.installments)) return false;
  return input.lastActiveStageId === null || input.reachedStageIds.includes(input.lastActiveStageId);
}

/**
 * Runs the completion rule after an installment, stage or kind change, inside the same transaction, and
 * moves a finished case to COMPLETED as the system (transitions.ts), which also tells the DS office
 * (NTF-1). `current` is the case as it is now inside the transaction. Returns whether it finished.
 */
export async function completeIfDone(
  tx: Prisma.TransactionClient,
  current: MovingCase & { kind: Kind },
  at: Date,
): Promise<boolean> {
  if (current.status !== "IN_PROGRESS") return false;
  const installments = await tx.installment.findMany({
    where: { caseId: current.id },
    select: { number: true, status: true, amount: true },
  });
  const list = stageKind(current.kind);
  const lastStage = list
    ? await tx.stageDefinition.findFirst({
        where: { kind: list, active: true },
        orderBy: { sortOrder: "desc" },
        select: { id: true },
      })
    : null;
  const reached = lastStage
    ? await tx.stageUpdate.findMany({ where: { caseId: current.id, stageId: lastStage.id }, select: { stageId: true } })
    : [];
  const done = isComplete({
    kind: current.kind,
    installments,
    lastActiveStageId: lastStage?.id ?? null,
    reachedStageIds: reached.flatMap((r) => (r.stageId === null ? [] : [r.stageId])),
  });
  if (!done) return false;
  await applyMove(tx, current, "complete", { by: "SYSTEM", actorId: null, at, data: { completedAt: at } });
  return true;
}
