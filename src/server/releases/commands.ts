import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { colomboDay, dateToDay, dayToDate } from "@/lib/dates";
import { INSTALLMENT_AMOUNT, INSTALLMENT_COUNT, RELEASE_AMOUNT } from "@/lib/money";
import {
  latestDay,
  parseReleaseForm,
  type ReleaseErrors,
  type ReleaseField,
  type ReleaseValues,
} from "@/lib/validation/release";
import { writeAudit } from "../audit";
import type { Actor } from "../cases/commands";
import { Refusal } from "../cases/refusal";
import { applyMove, type MoveError, moveRefusal } from "../cases/transitions";
import { canSeeOffice, OFFICE_PLACE } from "../permissions";

export type ReleaseCommandError =
  | "notFound"
  | MoveError
  | "noRelease"
  /** No case is ticked on the letter. */
  | "noCases"
  /** The scan isn't the actor's own new upload. */
  | "scanUnavailable";

/** A refusal for the whole form (`error`), or for its fields (`errors`), which the form shows next to each. */
export type ReleaseResult = { ok: true } | { ok: false; error: ReleaseCommandError | null; errors: ReleaseErrors };
export type LetterResult =
  { ok: true; letterId: string } | { ok: false; error: ReleaseCommandError | null; errors: ReleaseErrors };

/** At most this many cases on one letter: more than any district has waiting at once. */
export const MAX_LETTER_CASES = 500;

export type LetterInput = {
  districtId: number;
  /** The cases ticked on the letter, each with its version when the form was shown (CASE-10). */
  cases: { id: string; version: number }[];
  /** The form as typed; it is checked here against the cases' own dates. */
  form: Record<ReleaseField, string>;
  /** The letter's scan, uploaded beforehand by the actor, if any. */
  scanId: string | null;
};

const refused = (error: ReleaseCommandError) => ({ ok: false as const, error, errors: {} });
const verifiedDay = (verifiedAt: Date | null) => verifiedAt && colomboDay(verifiedAt);

/**
 * REL-2, REL-3: records one allocation letter to a District Secretary, releasing Rs. 2,000,000 for each
 * verified case ticked on it, all of them in that district. In one transaction the letter is saved with
 * its scan, and each case moves to IN_PROGRESS with its release and four NOT_STARTED installments of
 * Rs. 500,000, and its DS office's officers are notified (transitions.ts). The amounts are never typed
 * in. If any case can't be released, nothing is.
 */
export async function recordLetter(db: PrismaClient, actor: Actor, input: LetterInput): Promise<LetterResult> {
  const ids = [...new Set(input.cases.map((c) => c.id))].sort();
  if (ids.length === 0) return refused("noCases");
  if (ids.length !== input.cases.length || ids.length > MAX_LETTER_CASES) return refused("notFound");
  const [district, found] = await Promise.all([
    db.district.findUnique({ where: { id: input.districtId }, select: { id: true, nameSi: true } }),
    db.case.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        dsOfficeId: true,
        version: true,
        verifiedAt: true,
        dsOffice: OFFICE_PLACE,
      },
    }),
  ]);
  const elsewhere = (c: (typeof found)[number]) =>
    !canSeeOffice(actor, c.dsOffice) || c.dsOffice.districtId !== input.districtId;
  if (!district || found.length !== ids.length || found.some(elsewhere)) return refused("notFound");
  for (const c of found) {
    const refusal = moveRefusal(actor.role, "releaseV1", c.status);
    if (refusal) return refused(refusal);
  }

  const now = new Date();
  const limits = { earliest: latestDay(found.map((c) => verifiedDay(c.verifiedAt))), today: colomboDay(now) };
  const parsed = parseReleaseForm((field) => input.form[field], limits);
  if (!parsed.ok) return { ok: false, error: null, errors: parsed.errors };
  const shown = new Map(input.cases.map((c) => [c.id, c.version]));
  if (found.some((c) => c.version !== shown.get(c.id))) return refused("conflict");
  const letter = parsed.value;
  const letterId = randomUUID();
  const details = {
    letterId,
    letterNumber: letter.letterNumber,
    letterDate: letter.letterDate,
    validUntil: letter.validUntil,
    district: district.nameSi,
    cases: ids.length,
  };

  try {
    await db.$transaction(async (tx) => {
      await tx.releaseLetter.create({
        data: {
          id: letterId,
          districtId: district.id,
          letterNumber: letter.letterNumber,
          letterDate: dayToDate(letter.letterDate),
          validUntil: dayToDate(letter.validUntil),
          note: letter.note,
          byId: actor.userId,
          at: now,
        },
      });
      if (input.scanId) {
        const attached = await tx.storedFile.updateMany({
          where: {
            id: input.scanId,
            kind: "LETTER",
            uploadedById: actor.userId,
            caseId: null,
            letterId: null,
            removedAt: null,
          },
          data: { letterId },
        });
        if (attached.count !== 1) throw new Refusal("scanUnavailable");
      }
      // In the order of their ids, so two letters for the same cases wait for each other, never deadlock.
      for (const c of found) {
        await applyMove(tx, c, "releaseV1", {
          by: actor.role,
          actorId: actor.userId,
          at: now,
          checkVersion: true,
          auditAfter: { amount: RELEASE_AMOUNT, ...details },
        });
        await tx.release.create({
          data: {
            id: randomUUID(),
            caseId: c.id,
            letterId,
            releasedOn: dayToDate(letter.letterDate),
            amount: RELEASE_AMOUNT,
            byId: actor.userId,
            at: now,
          },
        });
        await tx.installment.createMany({
          data: Array.from({ length: INSTALLMENT_COUNT }, (_, index) => ({
            id: randomUUID(),
            caseId: c.id,
            number: index + 1,
            amount: INSTALLMENT_AMOUNT,
          })),
        });
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "letter_recorded",
        entityType: "release_letter",
        entityId: letterId,
        after: { ...details, note: letter.note, scanId: input.scanId, caseIds: ids },
      });
    });
  } catch (error) {
    if (error instanceof Refusal) return refused(error.reason as ReleaseCommandError);
    throw error;
  }
  return { ok: true, letterId };
}

export type ReleaseInput = {
  caseId: string;
  /** The case's version when the form was shown (CASE-10). */
  version: number;
  /** The form as typed; it is checked here against the letter's cases. */
  form: Record<ReleaseField, string>;
};

/**
 * REL-4: Head Office corrects the allocation letter of a case's release: its number, date, last valid
 * day or note. The change is for every case on the letter, so the REL-2 date rules apply to all of
 * them, and the date can't move past an installment date already recorded on any of them (INS-3,
 * INS-4). A new date moves each of their releases too. The old and new value of every changed field is
 * logged on each of the letter's cases.
 */
export async function correctRelease(db: PrismaClient, actor: Actor, input: ReleaseInput): Promise<ReleaseResult> {
  const found = await db.case.findUnique({
    where: { id: input.caseId },
    select: {
      id: true,
      dsOfficeId: true,
      dsOffice: OFFICE_PLACE,
      version: true,
      release: {
        select: {
          letter: {
            select: {
              id: true,
              letterNumber: true,
              letterDate: true,
              validUntil: true,
              note: true,
              releases: {
                select: {
                  case: {
                    select: {
                      id: true,
                      version: true,
                      verifiedAt: true,
                      installments: { select: { expectedOn: true, releasedOn: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!found || !canSeeOffice(actor, found.dsOffice)) return refused("notFound");
  if (actor.role !== "MINISTRY_OFFICER") return refused("roleNotAllowed");
  const current = found.release?.letter;
  if (!current) return refused("noRelease");
  const cases = current.releases.map((release) => release.case);

  const limits = {
    earliest: latestDay(cases.map((c) => verifiedDay(c.verifiedAt))),
    today: colomboDay(new Date()),
  };
  const parsed = parseReleaseForm((field) => input.form[field], limits);
  if (!parsed.ok) return { ok: false, error: null, errors: parsed.errors };
  const next = parsed.value;
  const firstInstallmentDay = cases
    .flatMap((c) => c.installments)
    .flatMap((i) => [i.expectedOn, i.releasedOn])
    .flatMap((date) => (date ? [dateToDay(date)] : []))
    .sort()[0];
  if (firstInstallmentDay && next.letterDate > firstInstallmentDay) {
    return { ok: false, error: null, errors: { letterDate: "dateAfterInstallment" } };
  }
  if (found.version !== input.version) return refused("conflict");

  const before: ReleaseValues = {
    letterNumber: current.letterNumber,
    letterDate: dateToDay(current.letterDate),
    validUntil: dateToDay(current.validUntil),
    note: current.note,
  };
  const changed = (Object.keys(next) as (keyof ReleaseValues)[]).filter((field) => next[field] !== before[field]);
  if (changed.length === 0) return { ok: true };
  const pick = (values: ReleaseValues) => Object.fromEntries(changed.map((field) => [field, values[field]]));

  try {
    await db.$transaction(async (tx) => {
      // Every case on the letter goes up a version, so a form opened before this correction can't
      // overwrite it, and one changed meanwhile refuses the correction.
      for (const c of [...cases].sort((a, b) => a.id.localeCompare(b.id))) {
        const updated = await tx.case.updateMany({
          where: { id: c.id, version: c.version },
          data: { version: { increment: 1 } },
        });
        if (updated.count === 0) throw new Refusal("conflict");
      }
      await tx.releaseLetter.update({
        where: { id: current.id },
        data: {
          letterNumber: next.letterNumber,
          letterDate: dayToDate(next.letterDate),
          validUntil: dayToDate(next.validUntil),
          note: next.note,
        },
      });
      if (changed.includes("letterDate")) {
        await tx.release.updateMany({
          where: { letterId: current.id },
          data: { releasedOn: dayToDate(next.letterDate) },
        });
      }
      for (const c of cases) {
        await writeAudit(tx, {
          actorId: actor.userId,
          action: "release_corrected",
          entityType: "release_letter",
          entityId: current.id,
          caseId: c.id,
          before: pick(before),
          after: pick(next),
        });
      }
    });
  } catch (error) {
    if (error instanceof Refusal) return refused("conflict");
    throw error;
  }
  return { ok: true };
}
