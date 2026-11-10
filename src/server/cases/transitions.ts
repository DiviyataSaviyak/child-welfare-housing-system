import type { Prisma } from "@/generated/prisma/client";
import type { CaseStatus, NotificationType } from "@/generated/prisma/enums";
import type { Role } from "../auth/roles";
import { writeAudit } from "../audit";
import { notifyOffice } from "../notifications/commands";
import { Refusal } from "./refusal";

/**
 * The only place a case's status changes (application spec, Case statuses and transitions). Every
 * move in the table below is checked here on the server, whatever the screen showed (STS-1, ERR-7). A
 * move records its audit record and notices in the same transaction as the change. Nobody checks, sends
 * back, rejects, stops or reopens a case any more (change 0006), so no move needs a reason.
 */

/** Who makes a move: an officer, or the system itself (CLS-1). */
export type Mover = Role | "SYSTEM";

/**
 * Change 0006's moves: `save` (a new case), `allocate` (the Ministry's letter), `release` (the District's
 * release to the DS), and the system's `start` (installment 1 paid), `unstart` (that payment undone) and
 * `complete`. `releaseV1` is version 1's letter, kept until change 0006's task 6 records the Ministry's
 * allocation in its place.
 */
export type Move = "save" | "allocate" | "release" | "start" | "unstart" | "complete" | "releaseV1";

type MoveRule = {
  /** The statuses it moves from; null is a case not yet saved. */
  from: readonly (CaseStatus | null)[];
  /** Where the case goes. */
  to: CaseStatus;
  who: readonly Mover[];
  /** What the case's DS offices' officers are told (NTF-1). */
  notify: NotificationType | null;
  audit: string;
};

/** Application spec, Case statuses and transitions, row by row. */
export const MOVES: Record<Move, MoveRule> = {
  // A new case is saved straight into AWAITING_ALLOCATION once every rule passes (CASE-5). The case is
  // created rather than moved, so applyMove never makes this move; saveCase checks it with moveRefusal.
  save: {
    from: [null],
    to: "AWAITING_ALLOCATION",
    who: ["DS_OFFICER", "MINISTRY_OFFICER"],
    notify: null,
    audit: "case_created",
  },
  // The Ministry's allocation letter to the district where the case is built (REL-3).
  allocate: {
    from: ["AWAITING_ALLOCATION"],
    to: "ALLOCATED_TO_DISTRICT",
    who: ["MINISTRY_OFFICER"],
    notify: "ALLOCATED",
    audit: "case_allocated",
  },
  // The District's release to the DS where the case is built (REL-7).
  release: {
    from: ["ALLOCATED_TO_DISTRICT"],
    to: "ALLOCATION_RECEIVED",
    who: ["DISTRICT_OFFICER"],
    notify: "RELEASED",
    audit: "case_ds_released",
  },
  // Installment 1 paid (INS-5), in the payment's transaction.
  start: {
    from: ["ALLOCATION_RECEIVED"],
    to: "IN_PROGRESS",
    who: ["SYSTEM"],
    notify: null,
    audit: "case_started",
  },
  // The payment of installment 1 undone (INS-6), in the undo's transaction.
  unstart: {
    from: ["IN_PROGRESS"],
    to: "ALLOCATION_RECEIVED",
    who: ["SYSTEM"],
    notify: null,
    audit: "case_unstarted",
  },
  complete: {
    from: ["IN_PROGRESS"],
    to: "COMPLETED",
    who: ["SYSTEM"],
    notify: "COMPLETED",
    audit: "case_completed",
  },
  // Change 0006's bridge until its task 6: version 1's letter releases the money to the DS at once, from
  // awaiting the allocation straight to the work, as it released a verified case before.
  releaseV1: {
    from: ["AWAITING_ALLOCATION"],
    to: "IN_PROGRESS",
    who: ["MINISTRY_OFFICER"],
    notify: "RELEASED",
    audit: "case_released",
  },
};

export type MoveError =
  /** This role never makes this move. */
  | "roleNotAllowed"
  /** The case's status doesn't allow it, or no longer does (STS-1, STS-2). */
  | "notAllowedNow"
  /** The case changed after the screen showed it (CASE-10). */
  | "conflict";

/** Why a move can't be made, or null when it can. */
export function moveRefusal(by: Mover, move: Move, from: CaseStatus | null): "roleNotAllowed" | "notAllowedNow" | null {
  const rule = MOVES[move];
  if (!rule.who.includes(by)) return "roleNotAllowed";
  if (!rule.from.includes(from)) return "notAllowedNow";
  return null;
}

/** The moves that can take a case out of this status: none for a final one (STS-2). */
export function movesFrom(status: CaseStatus): Move[] {
  return (Object.keys(MOVES) as Move[]).filter((move) => MOVES[move].from.includes(status));
}

export type MovingCase = { id: string; status: CaseStatus; version: number };

export type MoveInput = {
  by: Mover;
  /** The signed-in user; null for the system. */
  actorId: string | null;
  at: Date;
  /** Other fields that change with the status, such as the completion time. */
  data?: Prisma.CaseUncheckedUpdateManyInput;
  /** Refuse the move if the case changed after the screen showed it (CASE-10). */
  checkVersion?: boolean;
  /** More detail for the audit record, such as the release's reference number. */
  auditAfter?: Record<string, Prisma.InputJsonValue | null>;
};

/**
 * Moves a case to its next status inside the caller's transaction, or throws a Refusal that rolls
 * the transaction back. The update happens only while the case still has the status the caller read,
 * so when two people decide the same case at once, only the first succeeds.
 */
export async function applyMove(
  tx: Prisma.TransactionClient,
  current: MovingCase,
  move: Move,
  input: MoveInput,
): Promise<CaseStatus> {
  const rule = MOVES[move];
  const to = rule.to;
  const refusal = moveRefusal(input.by, move, current.status);
  if (refusal) throw new Refusal<MoveError>(refusal);

  const updated = await tx.case.updateMany({
    where: { id: current.id, status: current.status, ...(input.checkVersion ? { version: current.version } : {}) },
    data: { ...input.data, status: to, version: { increment: 1 } },
  });
  if (updated.count === 0) throw new Refusal<MoveError>("conflict");

  await writeAudit(tx, {
    actorId: input.actorId,
    action: rule.audit,
    entityType: "case",
    entityId: current.id,
    caseId: current.id,
    before: { status: current.status },
    after: { status: to, ...input.auditAfter },
  });
  if (rule.notify) {
    // NTF-1, CASE-13: both of the case's offices hear of it, read after the update so they are current.
    const offices = await tx.case.findUniqueOrThrow({
      where: { id: current.id },
      select: { dsOfficeId: true, buildDsOfficeId: true },
    });
    await notifyOffice(tx, {
      dsOfficeIds: [offices.dsOfficeId, offices.buildDsOfficeId],
      caseId: current.id,
      type: rule.notify,
      at: input.at,
    });
  }
  return to;
}
