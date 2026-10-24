import type { PrismaClient } from "@/generated/prisma/client";
import { colomboDay, dateToDay, dayToDate } from "@/lib/dates";
import { parseReason, type ReasonErrorKey } from "@/lib/validation/decision";
import {
  type PaidField,
  paidLimits,
  parsePaidForm,
  parseStartForm,
  type ProgressErrorKey,
  type StartField,
  startLimits,
} from "@/lib/validation/progress";
import { writeAudit } from "../audit";
import { claimCase } from "../cases/claim";
import type { Actor } from "../cases/commands";
import { completeIfDone } from "../cases/complete";
import { Refusal } from "../cases/refusal";
import { canSeeOffice } from "../permissions";
import { lastPaid, previousPaidOn, type StepRefusal, stepRefusal } from "./rules";

export type InstallmentError =
  | "notFound"
  | "roleNotAllowed"
  /** Installments change only while the case is in progress: never while stopped or finished (INS-5). */
  | "caseNotRunning"
  /** Someone changed the case after the page showed it (CASE-10). */
  | "conflict"
  /** INS-6: no installment has been paid. */
  | "nothingToUndo"
  | Exclude<StepRefusal, "noSuchInstallment">
  | ReasonErrorKey;

/** A refusal for the whole form (`error`), or for its fields (`errors`), which the form shows next to each. */
export type InstallmentResult<F extends string = string> =
  | { ok: true; completed: boolean }
  | { ok: false; error: InstallmentError | null; errors: Partial<Record<F, ProgressErrorKey>> };

type Target = {
  caseId: string;
  /** The case's version when the page was shown (CASE-10). */
  version: number;
  /** 1 to 4. */
  number: number;
};

const refused = (error: InstallmentError) => ({ ok: false as const, error, errors: {} });

/** The case with its release and installments, if the actor may see it (PRM-1). */
async function load(db: PrismaClient, actor: Actor, caseId: string) {
  const found = await db.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      status: true,
      dsOfficeId: true,
      version: true,
      kind: true,
      release: { select: { releasedOn: true } },
      installments: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, status: true, expectedOn: true, releasedOn: true, note: true },
      },
    },
  });
  if (!found || !canSeeOffice(actor, found.dsOfficeId)) return null;
  return {
    ...found,
    releasedOn: found.release && dateToDay(found.release.releasedOn),
    installments: found.installments.map((i) => ({
      ...i,
      expectedOn: i.expectedOn && dateToDay(i.expectedOn),
      releasedOn: i.releasedOn && dateToDay(i.releasedOn),
    })),
  };
}

/**
 * Checks what every DS installment step shares: the case is the officer's to see (PRM-1), only its DS
 * office changes installments (application spec, Roles and permissions), the case is in progress
 * (INS-5), and the installment is the next one and in the right state (INS-2). Gives the case, or the
 * refusal.
 */
async function prepareStep(db: PrismaClient, actor: Actor, target: Target, step: "start" | "pay") {
  const found = await load(db, actor, target.caseId);
  if (!found) return { refusal: refused("notFound") };
  if (actor.role !== "DS_OFFICER") return { refusal: refused("roleNotAllowed") };
  if (found.status !== "IN_PROGRESS" || !found.releasedOn) return { refusal: refused("caseNotRunning") };
  const refusal = stepRefusal(found.installments, target.number, step);
  if (refusal === "noSuchInstallment") return { refusal: refused("notFound") };
  if (refusal) return { refusal: refused(refusal) };
  const installment = found.installments.find((i) => i.number === target.number);
  if (!installment) return { refusal: refused("notFound") };
  return { found: { ...found, releasedOn: found.releasedOn }, installment };
}

/**
 * INS-3: the DS office starts the next installment's payment, with the day it expects to pay, on or
 * after the release. The purpose and note are optional.
 */
export async function startInstallment(
  db: PrismaClient,
  actor: Actor,
  input: Target & { form: Record<StartField, string> },
): Promise<InstallmentResult<StartField>> {
  const prepared = await prepareStep(db, actor, input, "start");
  if (prepared.refusal) return prepared.refusal;
  const { found, installment } = prepared;

  const parsed = parseStartForm((field) => input.form[field], startLimits(found.releasedOn));
  if (!parsed.ok) return { ok: false, error: null, errors: parsed.errors };
  if (found.version !== input.version) return refused("conflict");
  const values = parsed.value;

  try {
    await db.$transaction(async (tx) => {
      await claimCase(tx, found, ["IN_PROGRESS"]);
      const changed = await tx.installment.updateMany({
        where: { id: installment.id, status: "NOT_STARTED" },
        data: {
          status: "PROCESSING",
          expectedOn: dayToDate(values.expectedOn),
          purpose: values.purpose,
          note: values.note,
        },
      });
      if (changed.count === 0) throw new Refusal("conflict");
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "installment_started",
        entityType: "installment",
        entityId: installment.id,
        caseId: found.id,
        before: { number: installment.number, status: "NOT_STARTED" },
        after: { number: installment.number, status: "PROCESSING", ...values },
      });
    });
  } catch (error) {
    if (error instanceof Refusal) return refused("conflict");
    throw error;
  }
  return { ok: true, completed: false };
}

/**
 * INS-4: the DS office marks the next installment paid, on a day no later than today, on or after the
 * release, and on or after the previous installment's day paid. A stage never blocks it (INS-5).
 * Paying the fourth may finish the case (CLS-1).
 */
export async function markInstallmentPaid(
  db: PrismaClient,
  actor: Actor,
  input: Target & { form: Record<PaidField, string> },
): Promise<InstallmentResult<PaidField>> {
  const prepared = await prepareStep(db, actor, input, "pay");
  if (prepared.refusal) return prepared.refusal;
  const { found, installment } = prepared;

  const now = new Date();
  const limits = paidLimits(colomboDay(now), found.releasedOn, previousPaidOn(found.installments, input.number));
  const parsed = parsePaidForm((field) => input.form[field], limits);
  if (!parsed.ok) return { ok: false, error: null, errors: parsed.errors };
  if (found.version !== input.version) return refused("conflict");
  const values = parsed.value;

  try {
    const completed = await db.$transaction(async (tx) => {
      await claimCase(tx, found, ["IN_PROGRESS"]);
      const changed = await tx.installment.updateMany({
        where: { id: installment.id, status: "PROCESSING" },
        data: { status: "RELEASED", releasedOn: dayToDate(values.releasedOn), note: values.note },
      });
      if (changed.count === 0) throw new Refusal("conflict");
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "installment_paid",
        entityType: "installment",
        entityId: installment.id,
        caseId: found.id,
        before: { number: installment.number, status: "PROCESSING", note: installment.note },
        after: { number: installment.number, status: "RELEASED", ...values },
      });
      return completeIfDone(tx, { ...found, status: "IN_PROGRESS", version: found.version + 1 }, now);
    });
    return { ok: true, completed };
  } catch (error) {
    if (error instanceof Refusal) return refused("conflict");
    throw error;
  }
}

/**
 * INS-6: to correct a mistake, Head Office moves the most recently released installment back to
 * PROCESSING, with a reason. Its expected day stays; its day paid is cleared. Only while the case is
 * in progress: a finished case stays finished (STS-2).
 */
export async function undoInstallmentPayment(
  db: PrismaClient,
  actor: Actor,
  input: Target & { reason: string },
): Promise<InstallmentResult> {
  const found = await load(db, actor, input.caseId);
  if (!found) return refused("notFound");
  if (actor.role !== "HO_OFFICER") return refused("roleNotAllowed");
  if (found.status !== "IN_PROGRESS") return refused("caseNotRunning");
  const target = lastPaid(found.installments);
  if (!target) return refused("nothingToUndo");
  if (target.number !== input.number) return refused("conflict");
  const reason = parseReason(input.reason);
  if (!reason.ok) return refused(reason.error);
  if (found.version !== input.version) return refused("conflict");

  try {
    await db.$transaction(async (tx) => {
      await claimCase(tx, found, ["IN_PROGRESS"]);
      const changed = await tx.installment.updateMany({
        where: { id: target.id, status: "RELEASED" },
        data: { status: "PROCESSING", releasedOn: null },
      });
      if (changed.count === 0) throw new Refusal("conflict");
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "installment_payment_undone",
        entityType: "installment",
        entityId: target.id,
        caseId: found.id,
        before: { number: target.number, status: "RELEASED", releasedOn: target.releasedOn },
        after: { number: target.number, status: "PROCESSING", reason: reason.value },
      });
    });
  } catch (error) {
    if (error instanceof Refusal) return refused("conflict");
    throw error;
  }
  return { ok: true, completed: false };
}
