import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { colomboDay, dateToDay, dayToDate } from "@/lib/dates";
import { INSTALLMENT_AMOUNT, INSTALLMENT_COUNT, RELEASE_AMOUNT } from "@/lib/money";
import {
  type DsReleaseErrors,
  type DsReleaseField,
  type DsReleaseValues,
  parseDsReleaseForm,
} from "@/lib/validation/ds-release";
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
import { notifyDistrict } from "../notifications/commands";
import { CASE_PLACES, canActOn, canSeeCase } from "../permissions";

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

/**
 * REL-2, REL-3: records the Ministry's allocation letter to one District Secretary, allocating
 * Rs. 2,000,000 for each case awaiting its allocation ticked on it, all of them built in that district
 * (CASE-13). In one transaction the letter is saved with its scan, each case moves to ALLOCATED_TO_DISTRICT
 * with its allocation (a `release` row on the letter's date, with no District release yet), the cases' DS
 * officers are told (transitions.ts), and the district's District officers get one notice for the letter.
 * No installments are made: the District's release makes them (REL-7). The amounts are never typed in.
 * If any case can't be allocated, nothing is.
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
        createdAt: true,
        ...CASE_PLACES,
      },
    }),
  ]);
  // CASE-13: the letter goes to the district where each case is built.
  const elsewhere = (c: (typeof found)[number]) =>
    !canSeeCase(actor, c) || c.buildDsOffice.districtId !== input.districtId;
  if (!district || found.length !== ids.length || found.some(elsewhere)) return refused("notFound");
  for (const c of found) {
    const refusal = moveRefusal(actor.role, "allocate", c.status);
    if (refusal) return refused(refusal);
  }

  const now = new Date();
  const limits = { earliest: latestDay(found.map((c) => colomboDay(c.createdAt))), today: colomboDay(now) };
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
        await applyMove(tx, c, "allocate", {
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
      }
      await notifyDistrict(tx, { districtId: district.id, caseId: ids[0], type: "DISTRICT_LETTER", at: now });
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
 * REL-4: the Ministry corrects the allocation letter of a case: its number, date, last valid day or note.
 * The change is for every case on the letter, so the REL-2 date rules apply to all of them, and the date
 * can't move past the District's release of any of them (REL-6), nor past an installment date already
 * recorded on one (INS-3, INS-4). A new date moves each of their allocations too. The old and new value
 * of every changed field is logged on each of the letter's cases.
 */
export async function correctRelease(db: PrismaClient, actor: Actor, input: ReleaseInput): Promise<ReleaseResult> {
  const found = await db.case.findUnique({
    where: { id: input.caseId },
    select: {
      id: true,
      dsOfficeId: true,
      ...CASE_PLACES,
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
                  dsReleasedOn: true,
                  case: {
                    select: {
                      id: true,
                      version: true,
                      createdAt: true,
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
  if (!found || !canSeeCase(actor, found)) return refused("notFound");
  if (actor.role !== "MINISTRY_OFFICER") return refused("roleNotAllowed");
  const current = found.release?.letter;
  if (!current) return refused("noRelease");
  const cases = current.releases.map((release) => release.case);
  const firstDsRelease = current.releases
    .flatMap((release) => (release.dsReleasedOn ? [dateToDay(release.dsReleasedOn)] : []))
    .sort()[0];

  const limits = {
    earliest: latestDay(cases.map((c) => colomboDay(c.createdAt))),
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
  if (firstDsRelease && next.letterDate > firstDsRelease) {
    return { ok: false, error: null, errors: { letterDate: "dateAfterDsRelease" } };
  }
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

export type DsReleaseCommandError = ReleaseCommandError | "noDsRelease";
export type DsReleaseResult =
  { ok: true; dsReleaseId: string } | { ok: false; error: DsReleaseCommandError | null; errors: DsReleaseErrors };
export type DsCorrectionResult =
  { ok: true } | { ok: false; error: DsReleaseCommandError | null; errors: DsReleaseErrors };

export type DsReleaseInput = {
  /** The DS office the cases are released to: where each of them is built (CASE-13). */
  dsOfficeId: number;
  /** The cases ticked on the release, each with its version when the form was shown (CASE-10). */
  cases: { id: string; version: number }[];
  /** The form as typed; it is checked here against the dates of the cases' Ministry letters. */
  form: Record<DsReleaseField, string>;
  /** The scan of the District's letter, uploaded beforehand by the actor, if any. */
  scanId: string | null;
};

const dsRefused = (error: DsReleaseCommandError) => ({ ok: false as const, error, errors: {} });

/**
 * REL-6, REL-7, REL-9: records a District officer's release to one DS office of the district, of cases the
 * Ministry allocated to the district, all of them built in that DS office (CASE-13). In one transaction the
 * release is saved with its scan, each case moves to ALLOCATION_RECEIVED (its DS offices are told,
 * transitions.ts), its allocation gets the release and its date, and its four NOT_STARTED installments are
 * made. The amounts are never typed in. If any case can't be released, nothing is.
 */
export async function recordDsRelease(db: PrismaClient, actor: Actor, input: DsReleaseInput): Promise<DsReleaseResult> {
  const ids = [...new Set(input.cases.map((c) => c.id))].sort();
  if (ids.length === 0) return dsRefused("noCases");
  if (ids.length !== input.cases.length || ids.length > MAX_LETTER_CASES) return dsRefused("notFound");
  const [office, found] = await Promise.all([
    db.dsOffice.findUnique({
      where: { id: input.dsOfficeId },
      select: { id: true, nameSi: true, districtId: true, district: { select: { nameSi: true } } },
    }),
    db.case.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        version: true,
        buildDsOfficeId: true,
        ...CASE_PLACES,
        release: { select: { id: true, releasedOn: true } },
      },
    }),
  ]);
  // REL-9, PRM-1: a case the actor doesn't see, or one built in another DS office, reads as not found.
  const elsewhere = (c: (typeof found)[number]) => !canSeeCase(actor, c) || c.buildDsOfficeId !== input.dsOfficeId;
  if (!office || found.length !== ids.length || found.some(elsewhere)) return dsRefused("notFound");
  for (const c of found) {
    const refusal = moveRefusal(actor.role, "release", c.status);
    if (refusal) return dsRefused(refusal);
  }
  // Only the District where it is built releases it; another district's officer who sees it doesn't (REL-9).
  if (found.some((c) => !canActOn(actor, c, "release"))) return dsRefused("roleNotAllowed");
  if (found.some((c) => !c.release)) return dsRefused("notAllowedNow");

  const now = new Date();
  const limits = {
    earliest: latestDay(found.map((c) => (c.release ? dateToDay(c.release.releasedOn) : null))),
    today: colomboDay(now),
  };
  const parsed = parseDsReleaseForm((field) => input.form[field], limits);
  if (!parsed.ok) return { ok: false, error: null, errors: parsed.errors };
  const shown = new Map(input.cases.map((c) => [c.id, c.version]));
  if (found.some((c) => c.version !== shown.get(c.id))) return dsRefused("conflict");
  const release = parsed.value;
  const dsReleaseId = randomUUID();
  const details = {
    dsReleaseId,
    referenceNumber: release.referenceNumber,
    releasedOn: release.releasedOn,
    office: office.nameSi,
    district: office.district.nameSi,
    cases: ids.length,
  };

  try {
    await db.$transaction(async (tx) => {
      await tx.dsRelease.create({
        data: {
          id: dsReleaseId,
          districtId: office.districtId,
          dsOfficeId: office.id,
          referenceNumber: release.referenceNumber,
          releasedOn: dayToDate(release.releasedOn),
          note: release.note,
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
            dsReleaseId: null,
            removedAt: null,
          },
          data: { dsReleaseId },
        });
        if (attached.count !== 1) throw new Refusal("scanUnavailable");
      }
      // In the order of their ids, so two releases of the same cases wait for each other, never deadlock.
      for (const c of found) {
        await applyMove(tx, c, "release", {
          by: actor.role,
          actorId: actor.userId,
          at: now,
          checkVersion: true,
          auditAfter: { amount: RELEASE_AMOUNT, ...details },
        });
        await tx.release.update({
          where: { id: c.release!.id },
          data: { dsReleaseId, dsReleasedOn: dayToDate(release.releasedOn) },
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
        action: "ds_release_recorded",
        entityType: "ds_release",
        entityId: dsReleaseId,
        after: { ...details, note: release.note, scanId: input.scanId, caseIds: ids },
      });
    });
  } catch (error) {
    if (error instanceof Refusal) return dsRefused(error.reason as DsReleaseCommandError);
    throw error;
  }
  return { ok: true, dsReleaseId };
}

/**
 * REL-8: the District officer corrects the District release of a case: its reference number, date or note.
 * The change is for every case on the release, so the REL-6 date rules apply to all of them, and the date
 * can't move past an installment date or a stage date already recorded on one (INS-3, INS-4, STG-1). A new
 * date moves each of their allocations' District release dates too. The old and new value of every
 * changed field is logged on each of the release's cases.
 */
export async function correctDsRelease(
  db: PrismaClient,
  actor: Actor,
  input: { caseId: string; version: number; form: Record<DsReleaseField, string> },
): Promise<DsCorrectionResult> {
  const found = await db.case.findUnique({
    where: { id: input.caseId },
    select: {
      id: true,
      version: true,
      ...CASE_PLACES,
      release: {
        select: {
          dsRelease: {
            select: {
              id: true,
              referenceNumber: true,
              releasedOn: true,
              note: true,
              releases: {
                select: {
                  releasedOn: true,
                  case: {
                    select: {
                      id: true,
                      version: true,
                      installments: { select: { expectedOn: true, releasedOn: true } },
                      stageUpdates: { select: { visitedOn: true } },
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
  if (!found || !canSeeCase(actor, found)) return dsRefused("notFound");
  if (actor.role !== "DISTRICT_OFFICER" || !canActOn(actor, found, "release")) return dsRefused("roleNotAllowed");
  const current = found.release?.dsRelease;
  if (!current) return dsRefused("noDsRelease");
  const cases = current.releases.map((release) => release.case);

  const limits = {
    earliest: latestDay(current.releases.map((release) => dateToDay(release.releasedOn))),
    today: colomboDay(new Date()),
  };
  const parsed = parseDsReleaseForm((field) => input.form[field], limits);
  if (!parsed.ok) return { ok: false, error: null, errors: parsed.errors };
  const next = parsed.value;
  const first = (dates: (Date | null)[]) => dates.flatMap((date) => (date ? [dateToDay(date)] : [])).sort()[0];
  const firstInstallmentDay = first(cases.flatMap((c) => c.installments).flatMap((i) => [i.expectedOn, i.releasedOn]));
  const firstStageDay = first(cases.flatMap((c) => c.stageUpdates).map((s) => s.visitedOn));
  if (firstInstallmentDay && next.releasedOn > firstInstallmentDay) {
    return { ok: false, error: null, errors: { releasedOn: "releaseAfterInstallment" } };
  }
  if (firstStageDay && next.releasedOn > firstStageDay) {
    return { ok: false, error: null, errors: { releasedOn: "releaseAfterStage" } };
  }
  if (found.version !== input.version) return dsRefused("conflict");

  const before: DsReleaseValues = {
    referenceNumber: current.referenceNumber,
    releasedOn: dateToDay(current.releasedOn),
    note: current.note,
  };
  const changed = (Object.keys(next) as (keyof DsReleaseValues)[]).filter((field) => next[field] !== before[field]);
  if (changed.length === 0) return { ok: true };
  const pick = (values: DsReleaseValues) => Object.fromEntries(changed.map((field) => [field, values[field]]));

  try {
    await db.$transaction(async (tx) => {
      // Every case on the release goes up a version, so a form opened before this correction can't
      // overwrite it, and one changed meanwhile refuses the correction (CASE-10).
      for (const c of [...cases].sort((a, b) => a.id.localeCompare(b.id))) {
        const updated = await tx.case.updateMany({
          where: { id: c.id, version: c.version },
          data: { version: { increment: 1 } },
        });
        if (updated.count === 0) throw new Refusal("conflict");
      }
      await tx.dsRelease.update({
        where: { id: current.id },
        data: {
          referenceNumber: next.referenceNumber,
          releasedOn: dayToDate(next.releasedOn),
          note: next.note,
        },
      });
      if (changed.includes("releasedOn")) {
        await tx.release.updateMany({
          where: { dsReleaseId: current.id },
          data: { dsReleasedOn: dayToDate(next.releasedOn) },
        });
      }
      for (const c of cases) {
        await writeAudit(tx, {
          actorId: actor.userId,
          action: "ds_release_corrected",
          entityType: "ds_release",
          entityId: current.id,
          caseId: c.id,
          before: pick(before),
          after: pick(next),
        });
      }
    });
  } catch (error) {
    if (error instanceof Refusal) return dsRefused("conflict");
    throw error;
  }
  return { ok: true };
}
