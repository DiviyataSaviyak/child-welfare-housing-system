import type { PrismaClient } from "@/generated/prisma/client";
import { parseReason, type ReasonErrorKey } from "@/lib/validation/decision";
import { writeAudit } from "../audit";
import type { Actor } from "../cases/commands";
import { isUniqueViolation, Refusal } from "../cases/refusal";
import { notifyDistrict, notifyOffice } from "../notifications/commands";
import { CASE_PLACES, canActOn, canSeeCase, caseScope } from "../permissions";
import { AMENDABLE_STATUSES, type AmendRefusal, amendRefusal, type NominateRefusal, nominateRefusal } from "./rules";

/**
 * AMD-12, AMD-13: a CRPO asks the District to nominate a new beneficiary from another DS division, and the
 * District sends a request back. Nominating is `submitAmendment` with its `nomination` (commands.ts).
 */

export type NominationError =
  /** The case or request doesn't exist or isn't the actor's to see (PRM-1). */
  | "notFound"
  | AmendRefusal
  | NominateRefusal
  /** The case or request changed after the page was shown (CASE-10, ERR-3). */
  | "conflict"
  | ReasonErrorKey;

export type NominationResult = { ok: true; id: string } | { ok: false; error: NominationError };

/**
 * AMD-12: a CRPO of the case's DS of residence asks the District where it is built to nominate a new
 * beneficiary, with a reason, whenever they could submit an amendment (AMD-1, AMD-2), and not while an
 * amendment or another request waits. The request holds the case as a waiting amendment does (AMD-3).
 * `id` is made when the page renders, so a pop-up sent twice asks once (ERR-8). In one transaction that
 * takes the case's row first, as `submitAmendment` does; the district's District officers are told.
 */
export async function askNomination(
  db: PrismaClient,
  actor: Actor,
  input: { id: string; caseId: string; caseVersion: number; reason: string },
): Promise<NominationResult> {
  if (caseScope(actor).kind === "none") return { ok: false, error: "notFound" };
  const existing = await db.case.findUnique({
    where: { id: input.caseId },
    select: {
      id: true,
      status: true,
      version: true,
      dsOfficeId: true,
      buildDsOfficeId: true,
      ...CASE_PLACES,
      installments: { where: { status: "RELEASED" }, take: 1, select: { id: true } },
      amendments: { where: { status: "WAITING" }, take: 1, select: { id: true } },
      nominations: { where: { status: "WAITING" }, take: 1, select: { id: true, askedById: true } },
    },
  });
  if (!existing || !canSeeCase(actor, existing)) return { ok: false, error: "notFound" };
  const sent = existing.nominations[0];
  // ERR-8: the same pop-up sent twice. The first one asked; this one changes nothing.
  if (sent?.id === input.id && sent.askedById === actor.userId) return { ok: true, id: input.id };

  const refusal = amendRefusal(
    { role: actor.role, residence: canActOn(actor, existing, "amend") },
    {
      status: existing.status,
      paid: existing.installments.length > 0,
      waiting: existing.amendments.length > 0 || sent !== undefined,
    },
  );
  if (refusal) return { ok: false, error: refusal };
  const reason = parseReason(input.reason);
  if (!reason.ok) return { ok: false, error: reason.error };
  if (existing.version !== input.caseVersion) return { ok: false, error: "conflict" };

  const now = new Date();
  const districtId = existing.buildDsOffice.districtId;
  try {
    await db.$transaction(async (tx) => {
      // Takes the case's row without changing it (AMD-3), as an amendment does.
      const locked = await tx.case.updateMany({
        where: { id: existing.id, version: existing.version, status: { in: [...AMENDABLE_STATUSES] } },
        data: { version: existing.version },
      });
      if (locked.count === 0) throw new Refusal("conflict");
      const [paid, waiting] = await Promise.all([
        tx.installment.count({ where: { caseId: existing.id, status: "RELEASED" } }),
        tx.amendment.count({ where: { caseId: existing.id, status: "WAITING" } }),
      ]);
      if (paid > 0) throw new Refusal("amendmentNotAllowed");
      if (waiting > 0) throw new Refusal("amendmentWaiting");
      await tx.nomination.create({
        data: {
          id: input.id,
          caseId: existing.id,
          dsOfficeId: existing.dsOfficeId,
          districtId,
          reason: reason.value,
          askedById: actor.userId,
          askedAt: now,
        },
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "nomination_asked",
        entityType: "nomination",
        entityId: input.id,
        caseId: existing.id,
        after: { reason: reason.value, districtId },
      });
      await notifyDistrict(tx, { districtId, caseId: existing.id, type: "NOMINATION_ASKED", at: now });
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.reason as NominationError };
    // A second request for the case at the same moment (the one-waiting index).
    if (isUniqueViolation(error)) return { ok: false, error: "amendmentWaiting" };
    throw error;
  }
  return { ok: true, id: input.id };
}

/**
 * AMD-13: a District officer of the district where the case is built sends a waiting request back, with a
 * reason. The case is no longer held; the CRPOs of the DS that asked are told, and the case pages show the
 * reason until the DS asks again or submits an amendment.
 */
export async function sendBackNomination(
  db: PrismaClient,
  actor: Actor,
  input: { nominationId: string; version: number; reason: string },
): Promise<NominationResult> {
  if (caseScope(actor).kind === "none") return { ok: false, error: "notFound" };
  const found = await db.nomination.findUnique({
    where: { id: input.nominationId },
    select: {
      id: true,
      status: true,
      version: true,
      caseId: true,
      case: { select: { dsOfficeId: true, ...CASE_PLACES } },
    },
  });
  if (!found || !canSeeCase(actor, found.case)) return { ok: false, error: "notFound" };
  const refusal = nominateRefusal(
    { role: actor.role, district: canActOn(actor, found.case, "nominate") },
    { status: found.status },
  );
  if (refusal) return { ok: false, error: refusal };
  if (found.version !== input.version) return { ok: false, error: "conflict" };
  const reason = parseReason(input.reason);
  if (!reason.ok) return { ok: false, error: reason.error };

  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      const changed = await tx.nomination.updateMany({
        where: { id: found.id, version: found.version, status: "WAITING" },
        data: {
          status: "SENT_BACK",
          sentBackReason: reason.value,
          sentBackById: actor.userId,
          sentBackAt: now,
          version: { increment: 1 },
        },
      });
      if (changed.count === 0) throw new Refusal("conflict");
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "nomination_sent_back",
        entityType: "nomination",
        entityId: found.id,
        caseId: found.caseId,
        after: { reason: reason.value },
      });
      await notifyOffice(tx, {
        dsOfficeIds: [found.case.dsOfficeId],
        caseId: found.caseId,
        type: "NOMINATION_SENT_BACK",
        at: now,
      });
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.reason as NominationError };
    throw error;
  }
  return { ok: true, id: found.id };
}
