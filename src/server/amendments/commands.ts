import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { colomboDay, dateToDay, dayToDate } from "@/lib/dates";
import { MAX_DOCUMENTS } from "@/lib/file-types";
import { RELEASE_AMOUNT } from "@/lib/money";
import { type CaseValues, completeValues } from "@/lib/validation/case";
import { parseReason, type ReasonErrorKey } from "@/lib/validation/decision";
import {
  parseReturnForm,
  type ProgressErrorKey,
  type ReturnField,
  type ReturnValues,
  returnLimits,
} from "@/lib/validation/progress";
import { writeAudit } from "../audit";
import { type Actor, applicationNumberTaken, centreProvincesKnown, insertCase } from "../cases/commands";
import { applicationKey } from "../cases/numbers";
import { isUniqueViolation, Refusal } from "../cases/refusal";
import { applyMove } from "../cases/transitions";
import { notifyDistrict, notifyOffice } from "../notifications/commands";
import { CASE_PLACES, canActOn, canSeeCase, caseScope, OFFICE_PLACE } from "../permissions";
import { makeInstallments } from "../releases/commands";
import { type AmendmentDetails, amendmentPerson, detailsJson, readDetails } from "./details";
import { AMENDABLE_STATUSES, type AmendRefusal, amendRefusal, replacementStep } from "./rules";

export type AmendmentError =
  /** The case doesn't exist or isn't the actor's to see (PRM-1); or the amendment id is someone else's. */
  | "notFound"
  | AmendRefusal
  /** The case changed after the form was opened (CASE-10, ERR-3). */
  | "conflict"
  /** A required detail of the new beneficiary is missing (CASE-5). */
  | "incomplete"
  /** The DS office named for the land takes no new cases (LST-3). */
  | "officeInactive"
  /** The form said another DS division and named none (CASE-13). */
  | "buildOfficeRequired"
  /** AMD-8, CASE-12: a case or another waiting amendment of the DS holds the Application Number. */
  | "applicationNumberTaken"
  /** More than 10 documents (CASE-2). */
  | "tooManyFiles"
  /** An upload to attach isn't the actor's, or is already on a case or amendment. */
  | "fileUnavailable";

export type SubmitAmendmentInput = {
  /** Made when the form page renders, so a form sent twice makes one amendment (ERR-8). */
  id: string;
  /** The case whose beneficiary is to be replaced. */
  caseId: string;
  /** The case's version when the form was opened (CASE-10). */
  caseVersion: number;
  /** CASE-13: another DS office for the land, or null for the DS of residence. */
  buildDsOfficeId: number | null;
  /** The new beneficiary, on the case form (AMD-1). */
  values: CaseValues;
  /** AMD-1: 5 to 1,000 characters. */
  reason: string;
  /** The new beneficiary's documents, uploaded from the form (CASE-2). */
  documentIds: string[];
};

export type SubmitAmendmentResult =
  | { ok: true; value: { id: string; caseId: string } }
  | { ok: false; error: AmendmentError | null; reasonError?: ReasonErrorKey };

const refused = (error: AmendmentError): SubmitAmendmentResult => ({ ok: false, error });

const CASE_SELECT = {
  id: true,
  status: true,
  version: true,
  dsOfficeId: true,
  buildDsOfficeId: true,
  ...CASE_PLACES,
  installments: { where: { status: "RELEASED" }, take: 1, select: { id: true } },
  amendments: { where: { status: "WAITING" }, take: 1, select: { id: true } },
} as const satisfies Prisma.CaseSelect;

/**
 * AMD-1: a CRPO of the case's DS of residence asks the Ministry to replace its beneficiary, with the new
 * beneficiary on the case form and the reason. The new beneficiary waits in the amendment until the
 * Ministry decides (AMD-4); the case itself doesn't change (AMD-3). Refused once an installment is paid
 * (AMD-2), while another amendment waits, or when the new beneficiary breaks AMD-8. In one transaction that
 * takes the case's row first, so a payment at the same moment either goes first and is seen, or finds the
 * amendment waiting (`claimCase`). Nothing is saved when anything is refused.
 */
export async function submitAmendment(
  db: PrismaClient,
  actor: Actor,
  input: SubmitAmendmentInput,
): Promise<SubmitAmendmentResult> {
  if (caseScope(actor).kind === "none") return refused("notFound");

  for (let attempt = 1; ; attempt += 1) {
    const existing = await db.case.findUnique({ where: { id: input.caseId }, select: CASE_SELECT });
    if (!existing || !canSeeCase(actor, existing)) return refused("notFound");

    // ERR-8: the same form sent twice. The first one made the amendment; this one changes nothing.
    const sent = await db.amendment.findUnique({
      where: { id: input.id },
      select: { caseId: true, submittedById: true },
    });
    if (sent) {
      return sent.caseId === input.caseId && sent.submittedById === actor.userId
        ? { ok: true, value: { id: input.id, caseId: input.caseId } }
        : refused("notFound");
    }

    const refusal = amendRefusal(
      { role: actor.role, residence: canActOn(actor, existing, "amend") },
      { status: existing.status, paid: existing.installments.length > 0, waiting: existing.amendments.length > 0 },
    );
    if (refusal) return refused(refusal);

    const reason = parseReason(input.reason);
    const values = completeValues(input.values);
    if (!values) return { ok: false, error: "incomplete", ...(reason.ok ? {} : { reasonError: reason.error }) };
    if (!reason.ok) return { ok: false, error: null, reasonError: reason.error };
    if (existing.version !== input.caseVersion) return refused("conflict");

    // AMD-8: a beneficiary of the same DS, built in any active DS office. Outside the place the money has
    // reached, the approval sends it back (AMD-11).
    const residence = existing.dsOfficeId;
    const built = input.buildDsOfficeId ?? residence;
    const office = await db.dsOffice.findUnique({ where: { id: built }, select: { districtId: true, active: true } });
    if (!office) return refused("buildOfficeRequired");
    // The office already holding the money stays allowed, whatever the admin did to it since.
    if (!office.active && built !== existing.buildDsOfficeId) return refused("officeInactive");
    if (!(await centreProvincesKnown(db, values.centres))) return refused("incomplete");
    if (await applicationNumberTaken(db, residence, values.applicationNumber, null)) {
      return refused("applicationNumberTaken");
    }

    const details: AmendmentDetails = { ...values, buildDsOfficeId: built };
    try {
      await db.$transaction(async (tx) => {
        // Takes the case's row without changing it (AMD-3): its version and status must be as read.
        const locked = await tx.case.updateMany({
          where: { id: existing.id, version: existing.version, status: { in: [...AMENDABLE_STATUSES] } },
          data: { version: existing.version },
        });
        if (locked.count === 0) throw new Refusal("conflict");
        // AMD-2: read again now that the row is held, so a payment that went first is seen.
        const paid = await tx.installment.count({ where: { caseId: existing.id, status: "RELEASED" } });
        if (paid > 0) throw new Refusal("amendmentNotAllowed");

        await tx.amendment.create({
          data: {
            id: input.id,
            caseId: existing.id,
            dsOfficeId: residence,
            applicationKey: applicationKey(values.applicationNumber),
            details: detailsJson(details),
            reason: reason.value,
            submittedById: actor.userId,
          },
        });
        const documentIds = await attachDocuments(tx, actor, input.id, input.documentIds);
        await writeAudit(tx, {
          actorId: actor.userId,
          action: "amendment_submitted",
          entityType: "amendment",
          entityId: input.id,
          caseId: existing.id,
          // As a new case's record holds its details (HIS-1), with the reason and the documents.
          after: {
            ...withoutEmpty(details),
            reason: reason.value,
            documentsAdded: documentIds,
          } as Prisma.InputJsonValue,
        });
      });
      return { ok: true, value: { id: input.id, caseId: existing.id } };
    } catch (error) {
      if (error instanceof Refusal) return refused(error.reason as AmendmentError);
      // The same form twice at once, a second amendment of the case, or the same Application Number in a
      // second amendment at the same moment: the next try finds which (ERR-8, AMD-3, AMD-8).
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
}

const withoutEmpty = (values: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0)),
  );

/** Puts the actor's own new uploads on the amendment, up to 10 (CASE-2). The approval moves them to the case. */
async function attachDocuments(
  tx: Prisma.TransactionClient,
  actor: Actor,
  amendmentId: string,
  ids: string[],
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  if (unique.length > MAX_DOCUMENTS) throw new Refusal("tooManyFiles");
  const attached = await tx.storedFile.updateMany({
    where: {
      id: { in: unique },
      kind: "DOCUMENT",
      caseId: null,
      amendmentId: null,
      removedAt: null,
      uploadedById: actor.userId,
    },
    data: { amendmentId },
  });
  if (attached.count !== unique.length) throw new Refusal("fileUnavailable");
  return unique;
}

export type DecisionError =
  /** The amendment doesn't exist, or its case isn't the actor's to see (PRM-1). */
  | "notFound"
  /** Only a Ministry officer decides an amendment (AMD-4, PRM-5). */
  | "roleNotAllowed"
  /** The amendment or its case changed after the page was shown (CASE-10, ERR-3). */
  | "conflict"
  /** Someone else has already approved or rejected it (AMD-4). */
  | "amendmentDecided"
  /** AMD-5 found the case paid, completed or replaced meanwhile (AMD-2). */
  | "amendmentNotAllowed"
  /** AMD-5: a required detail of the new beneficiary is missing, so it can't be a case (CASE-5). */
  | "incomplete"
  /** AMD-5: the DS office of residence, or the one named for the land, no longer takes new cases (LST-3). */
  | "officeInactive"
  /** AMD-5, CASE-12: a case of the DS now holds the new beneficiary's Application Number. */
  | "applicationNumberTaken"
  | ReasonErrorKey;

export type DecisionResult =
  | { ok: true; caseId: string }
  /** `errors` are the return's fields (AMD-11), with `error` null. */
  | { ok: false; error: DecisionError | null; errors?: Partial<Record<ReturnField, ProgressErrorKey>> };

export type DecisionInput = {
  amendmentId: string;
  /** The amendment's version when the page was shown (CASE-10). */
  version: number;
  /** The existing case's version when the page was shown: approving needs the beneficiary as it was seen. */
  caseVersion: number;
  /**
   * AMD-11: the return's fields as typed, when the page asked for them because the new beneficiary is built
   * outside the place the money has reached; null when it didn't.
   */
  returned?: Record<ReturnField, string> | null;
};

const AMENDMENT_SELECT = {
  id: true,
  status: true,
  version: true,
  details: true,
  reason: true,
  submittedById: true,
  case: {
    select: {
      id: true,
      status: true,
      version: true,
      applicationNumber: true,
      name: true,
      childName: true,
      dsOfficeId: true,
      buildDsOfficeId: true,
      ...CASE_PLACES,
      dsOffice: { select: { ...OFFICE_PLACE.select, active: true } },
      replacedBy: { select: { id: true } },
      release: {
        select: { id: true, letterId: true, releasedOn: true, dsReleaseId: true, dsReleasedOn: true },
      },
      installments: { where: { status: "RELEASED" }, take: 1, select: { id: true } },
    },
  },
} as const satisfies Prisma.AmendmentSelect;

type FoundAmendment = Prisma.AmendmentGetPayload<{ select: typeof AMENDMENT_SELECT }>;

/** The amendment, if it exists and the actor may see its case (AMD-4, PRM-1). */
async function findAmendment(db: PrismaClient, actor: Actor, id: string): Promise<FoundAmendment | null> {
  if (caseScope(actor).kind === "none") return null;
  const found = await db.amendment.findUnique({ where: { id }, select: AMENDMENT_SELECT });
  return found && canSeeCase(actor, found.case) ? found : null;
}

/** Who may decide, and whether it is still undecided and as the page showed it (AMD-4, CASE-10). */
function decisionRefusal(actor: Actor, found: FoundAmendment, version: number): DecisionError | null {
  if (actor.role !== "MINISTRY_OFFICER") return "roleNotAllowed";
  if (found.status !== "WAITING") return "amendmentDecided";
  if (found.version !== version) return "conflict";
  return null;
}

/**
 * AMD-5: the Ministry approves an amendment. Everything submitting it checked is checked again, against the
 * case as it is now, and the rule that fails refuses the approval, so the Ministry can reject it with that
 * reason. Then, in one transaction that takes the existing case's row first (the `replace` move): the new
 * beneficiary's case is created in the existing case's DS of residence and status, linked to it, with the
 * amendment's documents; the allocation (its `release` row) moves to it, and after the District's release it
 * gets its own installments by its kind; the existing case becomes `REPLACED`, keeping any unpaid
 * installment it had; the amendment is approved with the new case; the officers are told (AMD-10). When the
 * new beneficiary is built outside the place the money has reached, the new case steps back and the money
 * goes back as far as `replacementStep` says, with the return's date and reference typed in the approval
 * (AMD-11). Nothing changes when anything is refused.
 */
export async function approveAmendment(db: PrismaClient, actor: Actor, input: DecisionInput): Promise<DecisionResult> {
  for (let attempt = 1; ; attempt += 1) {
    const found = await findAmendment(db, actor, input.amendmentId);
    if (!found) return { ok: false, error: "notFound" };
    const refusal = decisionRefusal(actor, found, input.version);
    if (refusal) return { ok: false, error: refusal };
    const existing = found.case;
    if (existing.version !== input.caseVersion) return { ok: false, error: "conflict" };
    if (!AMENDABLE_STATUSES.includes(existing.status) || existing.installments.length > 0) {
      return { ok: false, error: "amendmentNotAllowed" };
    }

    const stored = readDetails(found.details);
    const values = stored && completeValues(stored.values);
    if (!stored || !values || !(await centreProvincesKnown(db, values.centres))) {
      return { ok: false, error: "incomplete" };
    }
    const built = stored.buildDsOfficeId;
    const office = await db.dsOffice.findUnique({ where: { id: built }, select: { districtId: true, active: true } });
    if (!office) return { ok: false, error: "incomplete" };
    const residence = existing.dsOfficeId;
    if (!existing.dsOffice.active || (!office.active && built !== existing.buildDsOfficeId)) {
      return { ok: false, error: "officeInactive" };
    }
    if (await applicationNumberTaken(db, residence, values.applicationNumber, null, found.id)) {
      return { ok: false, error: "applicationNumberTaken" };
    }

    const now = new Date();
    // AMD-5, AMD-11: with the case as it is now, where the new case starts and whether the money goes back.
    const { status, returnedTo } = replacementStep(existing, { id: built, districtId: office.districtId });
    const release = existing.release;
    let returned: ReturnValues | null = null;
    if (returnedTo) {
      // The page asked for no return: the letter or the District's release came after it was shown.
      if (!release || !input.returned) return { ok: false, error: "conflict" };
      const fields = input.returned;
      const parsed = parseReturnForm(
        (field) => fields[field] ?? "",
        returnLimits(
          colomboDay(now),
          dateToDay(release.releasedOn),
          release.dsReleasedOn && dateToDay(release.dsReleasedOn),
        ),
      );
      if (!parsed.ok) return { ok: false, error: null, errors: parsed.errors };
      returned = parsed.value;
    }

    const newCaseId = randomUUID();
    try {
      await db.$transaction(async (tx) => {
        // Takes the existing case first, as every payment does (claimCase): a payment at the same moment
        // either went first and is seen below, or finds the case replaced.
        await applyMove(tx, existing, "replace", {
          by: actor.role,
          actorId: actor.userId,
          at: now,
          checkVersion: true,
          auditAfter: {
            amendmentId: found.id,
            newCaseId,
            newApplicationNumber: values.applicationNumber,
            newName: values.name,
            newChildName: values.childName,
            allocationMoved: release !== null && returnedTo !== "MINISTRY",
            ...(returned && { returned: returnAudit(returnedTo, returned) }),
          },
        });
        const paid = await tx.installment.count({ where: { caseId: existing.id, status: "RELEASED" } });
        if (paid > 0) throw new Refusal("amendmentNotAllowed");

        await insertCase(tx, {
          id: newCaseId,
          values,
          dsOfficeId: residence,
          buildDsOfficeId: built,
          status,
          // The DS officer who entered the new beneficiary's details; the approval is the Ministry's record.
          createdById: found.submittedById,
          // A case linked by version 1 keeps that link (a case is replaced once); the amendment links them anyway.
          replacesCaseId: existing.replacedBy ? null : existing.id,
        });
        const moved = await tx.storedFile.findMany({ where: { amendmentId: found.id }, select: { id: true } });
        await tx.storedFile.updateMany({
          where: { amendmentId: found.id },
          data: { amendmentId: null, caseId: newCaseId },
        });
        // The whole Rs. 2,000,000 moves: no installment was paid (AMD-5). Built outside the place it has
        // reached, it goes back (AMD-11): to the District, which releases it again to the new DS office, or
        // to the Ministry, which allocates it again.
        if (release && returnedTo === "MINISTRY") {
          await tx.release.delete({ where: { id: release.id } });
        } else if (release) {
          await tx.release.update({
            where: { id: release.id },
            data: {
              caseId: newCaseId,
              ...(returnedTo === "DISTRICT" && { dsReleaseId: null, dsReleasedOn: null }),
            },
          });
        }
        if (release && returnedTo && returned) {
          await tx.allocationReturn.create({
            data: {
              id: randomUUID(),
              amendmentId: found.id,
              caseId: existing.id,
              newCaseId,
              letterId: release.letterId,
              dsReleaseId: release.dsReleaseId,
              districtId: existing.buildDsOffice.districtId,
              dsOfficeId: release.dsReleaseId ? existing.buildDsOfficeId : null,
              returnedTo,
              amount: RELEASE_AMOUNT,
              returnedOn: dayToDate(returned.returnedOn),
              referenceNumber: returned.referenceNumber,
              note: returned.note,
              byId: actor.userId,
              at: now,
            },
          });
        }
        if (status === "ALLOCATION_RECEIVED") await makeInstallments(tx, newCaseId, values.kind);

        const decided = await tx.amendment.updateMany({
          where: { id: found.id, version: found.version, status: "WAITING" },
          data: {
            status: "APPROVED",
            decidedById: actor.userId,
            decidedAt: now,
            newCaseId,
            version: { increment: 1 },
          },
        });
        if (decided.count === 0) throw new Refusal("conflict");

        await writeAudit(tx, {
          actorId: actor.userId,
          action: "amendment_approved",
          entityType: "amendment",
          entityId: found.id,
          caseId: newCaseId,
          // As a new case's record holds its details (HIS-1), with the case it replaces.
          after: {
            ...withoutEmpty({ ...values, dsOfficeId: residence, buildDsOfficeId: built }),
            status,
            reason: found.reason,
            replacesCaseId: existing.id,
            replacedApplicationNumber: existing.applicationNumber,
            replacedName: existing.name,
            replacedChildName: existing.childName,
            allocationMoved: release !== null && returnedTo !== "MINISTRY",
            ...(returned && { returned: returnAudit(returnedTo, returned) }),
            documentsAdded: moved.map((file) => file.id),
          } as Prisma.InputJsonValue,
        });
        // AMD-10: the CRPOs of the new case's two offices, and the District officers once the district holds
        // the money, because the District chose whom it funds.
        await notifyOffice(tx, {
          dsOfficeIds: [residence, built],
          caseId: newCaseId,
          type: "AMENDMENT_APPROVED",
          at: now,
        });
        if (status !== "AWAITING_ALLOCATION") {
          await notifyDistrict(tx, {
            districtId: office.districtId,
            caseId: newCaseId,
            type: "AMENDMENT_APPROVED",
            at: now,
          });
        }
        // AMD-10: where the money came back from, on the replaced case, which they still see; once only, for
        // anyone not already told about the new case.
        if (returnedTo) {
          const fromDistrict = existing.buildDsOffice.districtId;
          if (status === "AWAITING_ALLOCATION" || fromDistrict !== office.districtId) {
            await notifyDistrict(tx, {
              districtId: fromDistrict,
              caseId: existing.id,
              type: "AMENDMENT_APPROVED",
              at: now,
            });
          }
          const fromOffice = existing.buildDsOfficeId;
          if (release?.dsReleaseId && fromOffice !== residence && fromOffice !== built) {
            await notifyOffice(tx, {
              dsOfficeIds: [fromOffice],
              caseId: existing.id,
              type: "AMENDMENT_APPROVED",
              at: now,
            });
          }
        }
      });
      return { ok: true, caseId: newCaseId };
    } catch (error) {
      if (error instanceof Refusal) {
        const reason = error.reason as string;
        return { ok: false, error: reason === "notAllowedNow" ? "amendmentNotAllowed" : (reason as DecisionError) };
      }
      // Another case took the Application Number at the same moment: the next try finds it (CASE-12).
      if (isUniqueViolation(error) && attempt < 2) continue;
      throw error;
    }
  }
}

/** AMD-11: the return, as both cases' history records hold it. */
function returnAudit(returnedTo: string | null, returned: ReturnValues) {
  return {
    to: returnedTo,
    returnedOn: returned.returnedOn,
    referenceNumber: returned.referenceNumber,
    ...(returned.note && { note: returned.note }),
  };
}

/**
 * AMD-6: the Ministry rejects an amendment with a reason. The existing case stays as it was; the CRPOs of its
 * two offices are told (AMD-10), and the DS may submit another amendment.
 */
export async function rejectAmendment(
  db: PrismaClient,
  actor: Actor,
  input: { amendmentId: string; version: number; reason: string },
): Promise<DecisionResult> {
  const found = await findAmendment(db, actor, input.amendmentId);
  if (!found) return { ok: false, error: "notFound" };
  const refusal = decisionRefusal(actor, found, input.version);
  if (refusal) return { ok: false, error: refusal };
  const reason = parseReason(input.reason);
  if (!reason.ok) return { ok: false, error: reason.error };

  const existing = found.case;
  const person = amendmentPerson(found.details);
  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      const decided = await tx.amendment.updateMany({
        where: { id: found.id, version: found.version, status: "WAITING" },
        data: {
          status: "REJECTED",
          decidedById: actor.userId,
          decidedAt: now,
          rejectionReason: reason.value,
          version: { increment: 1 },
        },
      });
      if (decided.count === 0) throw new Refusal("conflict");
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "amendment_rejected",
        entityType: "amendment",
        entityId: found.id,
        caseId: existing.id,
        after: {
          reason: reason.value,
          applicationNumber: person.applicationNumber,
          name: person.name,
          childName: person.childName,
        },
      });
      await notifyOffice(tx, {
        dsOfficeIds: [existing.dsOfficeId, existing.buildDsOfficeId],
        caseId: existing.id,
        type: "AMENDMENT_REJECTED",
        at: now,
      });
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.reason as DecisionError };
    throw error;
  }
  return { ok: true, caseId: existing.id };
}
