import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { CaseStatus, DecisionType, NotificationType } from "@/generated/prisma/enums";
import type { Role } from "../auth/roles";
import { writeAudit } from "../audit";
import { notifyOffice } from "../notifications/commands";
import { Refusal } from "./refusal";

/**
 * The only place a case's status changes (application spec, Case statuses and transitions). Every
 * move in the table below is checked here on the server, whatever the screen showed (STS-1, ERR-7). A
 * move records its decision, audit record and notices in the same transaction as the change.
 */

/** Who makes a move: an officer, or the system itself (CLS-1). */
export type Mover = Role | "SYSTEM";

/**
 * Change 0006's moves: `save` (a new case), `allocate` (the Ministry's letter), `release` (the District's
 * release to the DS), and the system's `start` (installment 1 paid), `unstart` (that payment undone) and
 * `complete`. The others are version 1's, kept only while the code for drafts, the check, stopping and
 * version 1's letter is still there (change 0006, tasks 4 to 6).
 */
export type Move =
  | "save"
  | "allocate"
  | "release"
  | "start"
  | "unstart"
  | "complete"
  | "submit"
  | "verify"
  | "sendBack"
  | "reject"
  | "releaseV1"
  | "stop"
  | "reopen";

type MoveRule = {
  /** The statuses it moves from; null is a case not yet saved. */
  from: readonly (CaseStatus | null)[];
  /** Where the case goes. Reopening chooses one of two. */
  to: readonly CaseStatus[];
  who: readonly Mover[];
  /** A reason is required (CHK-3, CLS-2, CLS-3). */
  needsReason: boolean;
  decision: DecisionType | null;
  /** What the DS office's officers are told (NTF-1). */
  notify: NotificationType | null;
  audit: string;
};

/** Application spec, Case statuses and transitions, row by row. */
export const MOVES: Record<Move, MoveRule> = {
  // A new case is saved straight into AWAITING_ALLOCATION once every rule passes (CASE-5). The case is
  // created rather than moved, so applyMove never makes this move; saveCase checks it with moveRefusal.
  save: {
    from: [null],
    to: ["AWAITING_ALLOCATION"],
    who: ["DS_OFFICER", "MINISTRY_OFFICER"],
    needsReason: false,
    decision: null,
    notify: null,
    audit: "case_created",
  },
  // The Ministry's allocation letter to the district where the case is built (REL-3).
  allocate: {
    from: ["AWAITING_ALLOCATION"],
    to: ["ALLOCATED_TO_DISTRICT"],
    who: ["MINISTRY_OFFICER"],
    needsReason: false,
    decision: null,
    notify: "ALLOCATED",
    audit: "case_allocated",
  },
  // The District's release to the DS where the case is built (REL-7).
  release: {
    from: ["ALLOCATED_TO_DISTRICT"],
    to: ["ALLOCATION_RECEIVED"],
    who: ["DISTRICT_OFFICER"],
    needsReason: false,
    decision: null,
    notify: "RELEASED",
    audit: "case_ds_released",
  },
  // Installment 1 paid (INS-5), in the payment's transaction.
  start: {
    from: ["ALLOCATION_RECEIVED"],
    to: ["IN_PROGRESS"],
    who: ["SYSTEM"],
    needsReason: false,
    decision: null,
    notify: null,
    audit: "case_started",
  },
  // The payment of installment 1 undone (INS-6), in the undo's transaction.
  unstart: {
    from: ["IN_PROGRESS"],
    to: ["ALLOCATION_RECEIVED"],
    who: ["SYSTEM"],
    needsReason: false,
    decision: null,
    notify: null,
    audit: "case_unstarted",
  },
  complete: {
    from: ["IN_PROGRESS"],
    to: ["COMPLETED"],
    who: ["SYSTEM"],
    needsReason: false,
    decision: null,
    notify: "COMPLETED",
    audit: "case_completed",
  },
  // Version 1's moves, until change 0006's tasks 4 to 6 remove the code that makes them.
  submit: {
    from: ["DRAFT", "RETURNED"],
    to: ["SUBMITTED"],
    who: ["DS_OFFICER", "MINISTRY_OFFICER"],
    needsReason: false,
    decision: "SUBMIT",
    notify: null,
    audit: "case_submitted",
  },
  verify: {
    from: ["SUBMITTED"],
    to: ["VERIFIED"],
    who: ["MINISTRY_OFFICER"],
    needsReason: false,
    decision: "VERIFY",
    notify: "VERIFIED",
    audit: "case_verified",
  },
  sendBack: {
    from: ["SUBMITTED"],
    to: ["RETURNED"],
    who: ["MINISTRY_OFFICER"],
    needsReason: true,
    decision: "SEND_BACK",
    notify: "SENT_BACK",
    audit: "case_sent_back",
  },
  reject: {
    from: ["SUBMITTED"],
    to: ["REJECTED"],
    who: ["MINISTRY_OFFICER"],
    needsReason: true,
    decision: "REJECT",
    notify: "REJECTED",
    audit: "case_rejected",
  },
  releaseV1: {
    from: ["VERIFIED"],
    to: ["IN_PROGRESS"],
    who: ["MINISTRY_OFFICER"],
    needsReason: false,
    decision: null,
    notify: "RELEASED",
    audit: "case_released",
  },
  stop: {
    from: ["VERIFIED", "IN_PROGRESS"],
    to: ["STOPPED"],
    who: ["MINISTRY_OFFICER"],
    needsReason: true,
    decision: "STOP",
    notify: "STOPPED",
    audit: "case_stopped",
  },
  reopen: {
    // Back to the status the case had before it was stopped (CLS-3); the caller says which.
    from: ["STOPPED"],
    to: ["VERIFIED", "IN_PROGRESS"],
    who: ["MINISTRY_OFFICER"],
    needsReason: true,
    decision: "REOPEN",
    notify: "REOPENED",
    audit: "case_reopened",
  },
};

export type MoveError =
  /** This role never makes this move. */
  | "roleNotAllowed"
  /** The case's status doesn't allow it, or no longer does (STS-1, STS-2). */
  | "notAllowedNow"
  /** The move needs a reason and none was given. */
  | "reasonRequired"
  /** The case changed after the screen showed it (CASE-10). */
  | "conflict";

/**
 * Why a move can't be made, or null when it can. `to` matters only for a move with more than one
 * target; by default it is the first.
 */
export function moveRefusal(
  by: Mover,
  move: Move,
  from: CaseStatus | null,
  to?: CaseStatus,
): "roleNotAllowed" | "notAllowedNow" | null {
  const rule = MOVES[move];
  if (!rule.who.includes(by)) return "roleNotAllowed";
  if (!rule.from.includes(from) || !rule.to.includes(to ?? rule.to[0])) return "notAllowedNow";
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
  /** Only for a move with more than one target. */
  to?: CaseStatus;
  reason?: string | null;
  /** Other fields that change with the status, such as the submit time. */
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
  const to = input.to ?? rule.to[0];
  const refusal = moveRefusal(input.by, move, current.status, to);
  if (refusal) throw new Refusal<MoveError>(refusal);
  const reason = input.reason?.trim() || null;
  if (rule.needsReason && !reason) throw new Refusal<MoveError>("reasonRequired");
  // A decision always has a person behind it; only the system's own moves (CLS-1) have none.
  if (rule.decision && !input.actorId) throw new Refusal<MoveError>("roleNotAllowed");

  const updated = await tx.case.updateMany({
    where: { id: current.id, status: current.status, ...(input.checkVersion ? { version: current.version } : {}) },
    data: { ...input.data, status: to, version: { increment: 1 } },
  });
  if (updated.count === 0) throw new Refusal<MoveError>("conflict");

  if (rule.decision && input.actorId) {
    await tx.decision.create({
      data: {
        id: randomUUID(),
        caseId: current.id,
        type: rule.decision,
        reason: rule.needsReason ? reason : null,
        byId: input.actorId,
        at: input.at,
      },
    });
  }
  await writeAudit(tx, {
    actorId: input.actorId,
    action: rule.audit,
    entityType: "case",
    entityId: current.id,
    caseId: current.id,
    before: { status: current.status },
    after: { status: to, ...(rule.needsReason ? { reason } : {}), ...input.auditAfter },
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
