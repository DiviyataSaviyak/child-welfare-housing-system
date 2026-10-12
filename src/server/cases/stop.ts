import type { PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import { balance } from "@/lib/money";
import { parseReason, type ReasonErrorKey } from "@/lib/validation/decision";
import { canSeeOffice } from "../permissions";
import type { Actor } from "./commands";
import { Refusal, type Result } from "./refusal";
import { applyMove, type MoveError, moveRefusal } from "./transitions";

export type StopError =
  | "notFound"
  | MoveError
  | ReasonErrorKey
  /** Another case was entered in this one's place, so it can't be reopened (CASE-11, CLS-3). */
  | "replaced";

type Input = {
  caseId: string;
  version: number;
  reason: string;
  /** Stopping only: also ask the DS office for another name in the case's place (CASE-11). */
  askAnotherName?: boolean;
};

/**
 * The status a stopped case goes back to (CLS-3). A case stopped before Phase 6 may have none
 * recorded; it then goes back to in progress if its money was released, otherwise to verified.
 */
export function statusToReopen(stopped: { statusBeforeStop: CaseStatus | null; hasRelease: boolean }): CaseStatus {
  return stopped.statusBeforeStop ?? (stopped.hasRelease ? "IN_PROGRESS" : "VERIFIED");
}

async function load(db: PrismaClient, actor: Actor, caseId: string) {
  const found = await db.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      status: true,
      dsOfficeId: true,
      version: true,
      statusBeforeStop: true,
      anotherNameRequested: true,
      replacedBy: { select: { id: true } },
      release: { select: { amount: true } },
      installments: { select: { amount: true, status: true } },
    },
  });
  return found && canSeeOffice(actor, found.dsOfficeId) ? found : null;
}

/**
 * CLS-2: Head Office stops a verified or running case that can't go ahead, with a reason of 5 to
 * 1,000 characters, and may ask the DS office for another name in its place (CASE-11). The case
 * remembers its status, for reopening (CLS-3). While stopped, its details,
 * installments and stages can't change (CASE-9, INS-5, STG-5). The DS office is told (NTF-1).
 */
export async function stopCase(db: PrismaClient, actor: Actor, input: Input): Promise<Result<CaseStatus, StopError>> {
  const found = await load(db, actor, input.caseId);
  if (!found) return { ok: false, error: "notFound" };
  const refusal = moveRefusal(actor.role, "stop", found.status);
  if (refusal) return { ok: false, error: refusal };
  const reason = parseReason(input.reason);
  if (!reason.ok) return { ok: false, error: reason.error };
  if (found.version !== input.version) return { ok: false, error: "conflict" };

  try {
    const status = await db.$transaction((tx) =>
      applyMove(tx, found, "stop", {
        by: actor.role,
        actorId: actor.userId,
        at: new Date(),
        reason: reason.value,
        checkVersion: true,
        data: { statusBeforeStop: found.status, ...(input.askAnotherName ? { anotherNameRequested: true } : {}) },
        auditAfter: {
          balance: balance(found.release, found.installments),
          ...(input.askAnotherName ? { anotherNameRequested: true } : {}),
        },
      }),
    );
    return { ok: true, value: status };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.reason as MoveError };
    throw error;
  }
}

/**
 * CLS-3: Head Office reopens a stopped case, with a reason. It goes back to the status it had before,
 * and any request for another name is withdrawn; once a case has taken its place, it can't be reopened
 * (CASE-11).
 */
export async function reopenCase(db: PrismaClient, actor: Actor, input: Input): Promise<Result<CaseStatus, StopError>> {
  const found = await load(db, actor, input.caseId);
  if (!found) return { ok: false, error: "notFound" };
  const to = statusToReopen({ statusBeforeStop: found.statusBeforeStop, hasRelease: found.release !== null });
  const refusal = moveRefusal(actor.role, "reopen", found.status, to);
  if (refusal) return { ok: false, error: refusal };
  if (found.replacedBy) return { ok: false, error: "replaced" };
  const reason = parseReason(input.reason);
  if (!reason.ok) return { ok: false, error: reason.error };
  if (found.version !== input.version) return { ok: false, error: "conflict" };

  try {
    const status = await db.$transaction((tx) =>
      applyMove(tx, found, "reopen", {
        by: actor.role,
        actorId: actor.userId,
        at: new Date(),
        to,
        reason: reason.value,
        checkVersion: true,
        data: { statusBeforeStop: null, anotherNameRequested: false },
        auditAfter: found.anotherNameRequested ? { anotherNameWithdrawn: true } : undefined,
      }),
    );
    return { ok: true, value: status };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.reason as MoveError };
    throw error;
  }
}
