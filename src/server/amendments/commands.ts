import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { MAX_DOCUMENTS } from "@/lib/file-types";
import { type CaseValues, completeValues } from "@/lib/validation/case";
import { parseReason, type ReasonErrorKey } from "@/lib/validation/decision";
import { writeAudit } from "../audit";
import { type Actor, applicationNumberTaken, centreProvincesKnown } from "../cases/commands";
import { applicationKey } from "../cases/numbers";
import { isUniqueViolation, Refusal } from "../cases/refusal";
import { CASE_PLACES, canActOn, canSeeCase, caseScope } from "../permissions";
import { type AmendmentDetails, detailsJson } from "./details";
import { AMENDABLE_STATUSES, type AmendRefusal, amendRefusal, buildOfficeAllowed, buildOfficesFor } from "./rules";

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
  /** AMD-8: the money has already gone to a district or DS office, and the land isn't there. */
  | "buildOfficeNotAllowed"
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

    // AMD-8: a beneficiary of the same DS, built where the money has already gone.
    const residence = existing.dsOfficeId;
    const built = input.buildDsOfficeId ?? residence;
    const office = await db.dsOffice.findUnique({ where: { id: built }, select: { districtId: true, active: true } });
    if (!office) return refused("buildOfficeRequired");
    if (!buildOfficeAllowed(buildOfficesFor(existing), { id: built, districtId: office.districtId })) {
      return refused("buildOfficeNotAllowed");
    }
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
