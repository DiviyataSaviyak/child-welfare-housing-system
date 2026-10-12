import type { PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import { parseReason, type ReasonErrorKey } from "@/lib/validation/decision";
import { canSeeOffice } from "../permissions";
import type { Actor } from "./commands";
import { Refusal, type Result } from "./refusal";
import { applyMove, type Move, type MoveError, moveRefusal } from "./transitions";

/** Head Office's three answers to a case it checks (CHK-3). */
export const DECISIONS = ["verify", "sendBack", "reject"] as const satisfies readonly Move[];
export type Decision = (typeof DECISIONS)[number];

export const isDecision = (value: unknown): value is Decision =>
  typeof value === "string" && (DECISIONS as readonly string[]).includes(value);

export type DecideError = "notFound" | MoveError | ReasonErrorKey;

/**
 * CHK-3: verifies a submitted case, sends it back to its DS office for correction, or rejects it.
 * Sending back and rejecting need a reason of 5 to 1,000 characters. Rejecting can also ask the DS
 * office for another name in the case's place (CASE-11). The decision, its audit record
 * and the notices to the DS office's officers are saved with the status change (transitions.ts).
 * `version` is the one the check view showed, so a case resubmitted in the meantime isn't decided
 * on details nobody has seen (CASE-10).
 */
export async function decideCase(
  db: PrismaClient,
  actor: Actor,
  input: { caseId: string; version: number; decision: Decision; reason: string | null; askAnotherName?: boolean },
): Promise<Result<CaseStatus, DecideError>> {
  const found = await db.case.findUnique({
    where: { id: input.caseId },
    select: { id: true, status: true, dsOfficeId: true, version: true },
  });
  if (!found || !canSeeOffice(actor, found.dsOfficeId)) return { ok: false, error: "notFound" };
  const refusal = moveRefusal(actor.role, input.decision, found.status);
  if (refusal) return { ok: false, error: refusal };

  let reason: string | null = null;
  if (input.decision !== "verify") {
    const parsed = parseReason(input.reason ?? "");
    if (!parsed.ok) return { ok: false, error: parsed.error };
    reason = parsed.value;
  }
  if (found.version !== input.version) return { ok: false, error: "conflict" };

  const now = new Date();
  const askAnotherName = input.decision === "reject" && input.askAnotherName === true;
  try {
    const status = await db.$transaction((tx) =>
      applyMove(tx, found, input.decision, {
        by: actor.role,
        actorId: actor.userId,
        at: now,
        reason,
        checkVersion: true,
        data:
          input.decision === "verify"
            ? { verifiedAt: now }
            : askAnotherName
              ? { anotherNameRequested: true }
              : undefined,
        auditAfter: askAnotherName ? { anotherNameRequested: true } : undefined,
      }),
    );
    return { ok: true, value: status };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.reason as MoveError };
    throw error;
  }
}
