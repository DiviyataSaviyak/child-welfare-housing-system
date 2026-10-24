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

export type Move = "submit" | "verify" | "sendBack" | "reject" | "release" | "complete" | "stop" | "reopen";

type MoveRule = {
  from: readonly CaseStatus[];
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
  submit: {
    from: ["DRAFT", "RETURNED"],
    to: ["SUBMITTED"],
    who: ["DS_OFFICER", "HO_OFFICER"],
    needsReason: false,
    decision: "SUBMIT",
    notify: null,
    audit: "case_submitted",
  },
  verify: {
    from: ["SUBMITTED"],
    to: ["VERIFIED"],
    who: ["HO_OFFICER"],
    needsReason: false,
    decision: "VERIFY",
    notify: "VERIFIED",
    audit: "case_verified",
  },
  sendBack: {
    from: ["SUBMITTED"],
    to: ["RETURNED"],
    who: ["HO_OFFICER"],
    needsReason: true,
    decision: "SEND_BACK",
    notify: "SENT_BACK",
    audit: "case_sent_back",
  },
  reject: {
    from: ["SUBMITTED"],
    to: ["REJECTED"],
    who: ["HO_OFFICER"],
    needsReason: true,
    decision: "REJECT",
    notify: "REJECTED",
    audit: "case_rejected",
  },
  release: {
    from: ["VERIFIED"],
    to: ["IN_PROGRESS"],
    who: ["HO_OFFICER"],
    needsReason: false,
    decision: null,
    notify: "RELEASED",
    audit: "case_released",
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
  stop: {
    from: ["VERIFIED", "IN_PROGRESS"],
    to: ["STOPPED"],
    who: ["HO_OFFICER"],
    needsReason: true,
    decision: "STOP",
    notify: "STOPPED",
    audit: "case_stopped",
  },
  reopen: {
    // Back to the status the case had before it was stopped (CLS-3); the caller says which.
    from: ["STOPPED"],
    to: ["VERIFIED", "IN_PROGRESS"],
    who: ["HO_OFFICER"],
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
  from: CaseStatus,
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

export type MovingCase = { id: string; status: CaseStatus; dsOfficeId: number; version: number };

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
    await notifyOffice(tx, { dsOfficeId: current.dsOfficeId, caseId: current.id, type: rule.notify, at: input.at });
  }
  return to;
}
