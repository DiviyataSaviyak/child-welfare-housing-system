import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import { MAX_DOCUMENTS } from "@/lib/file-types";
import { dateToDay, dayToDate } from "@/lib/dates";
import { nicKey } from "@/lib/nic";
import {
  CASE_FIELDS,
  type CaseValues,
  type CentreValues,
  type CompleteCaseValues,
  completeValues,
  type PartialDate,
} from "@/lib/validation/case";
import { parseReason, type ReasonErrorKey } from "@/lib/validation/decision";
import { writeAudit } from "../audit";
import { deleteStoredFile } from "../files/storage";
import { logError } from "../log";
import { CASE_PLACES, canActOn, canSeeCase, caseScope, type Viewer } from "../permissions";
import { applicationKey } from "./numbers";
import { isUniqueViolation, Refusal } from "./refusal";
import {
  canChangeBuildOffice,
  canChangeOffice,
  canDeleteCase,
  canEditDetails,
  canEnterCases,
  editableStatuses,
} from "./rules";
import { moveRefusal } from "./transitions";

/** The signed-in user making a change. */
export type Actor = Viewer & { userId: string };

export type CaseCommandError =
  /** It doesn't exist, or it isn't the actor's to see (PRM-1). */
  | "notFound"
  /** Its status, or the actor's office, doesn't allow this change (STS-1, CASE-9, CASE-13, ERR-7). */
  | "notEditable"
  /** Someone else saved it after this form was opened (CASE-10, ERR-3). */
  | "conflict"
  /** A required field is empty (CASE-5). */
  | "incomplete"
  /** The Ministry didn't choose a DS office (CASE-3). */
  | "officeRequired"
  /** The office is inactive and takes no new cases (LST-3). */
  | "officeInactive"
  /** The form said the house is built in another DS division, and named none that can take it (CASE-13). */
  | "buildOfficeRequired"
  /** Another case of the same DS office of residence has this Application Number (CASE-12). */
  | "applicationNumberTaken"
  /** More than 10 documents (CASE-2). */
  | "tooManyFiles"
  /** An upload to attach isn't the actor's, or is already on a case. */
  | "fileUnavailable"
  /** The case's status doesn't allow this step (STS-1). */
  | "notAllowedNow"
  /** The actor's role never takes this step (application spec, Roles and permissions). */
  | "roleNotAllowed"
  /** The kind of help decides the stages, so it stays once a stage is recorded (CASE-9, STG-4). */
  | "kindLocked";

type Result<T> = { ok: true; value: T } | { ok: false; error: CaseCommandError };

export type SaveCaseInput = {
  /** A new case's id is made when its form opens, so sending the form twice can't create two cases (ERR-8). */
  id: string;
  /** The version the form was opened with; null for a new case. */
  version: number | null;
  /** The office chosen on the form. Only the Ministry chooses (CASE-3); a DS officer's comes from their account. */
  dsOfficeId: number | null;
  /**
   * CASE-13: the DS office where the house is built or the land bought, when the form says it is another
   * DS division; null for the DS of residence itself.
   */
  buildDsOfficeId: number | null;
  values: CaseValues;
  /** Uploads to put on the case. */
  documentIds: string[];
};

/** A save whose required fields are all filled in. */
type CompleteInput = SaveCaseInput & { values: CompleteCaseValues };

/** `created` is false for a change to a saved case. */
export type SavedCase = { id: string; applicationNumber: string; status: CaseStatus; created: boolean };

/** A stored child development centre (CASE-14). */
export const CENTRE_SELECT = {
  name: true,
  provinceId: true,
  fromYear: true,
  fromMonth: true,
  fromDay: true,
  untilYear: true,
  untilMonth: true,
  untilDay: true,
} as const satisfies Prisma.CareCentreSelect;

type StoredCentre = Prisma.CareCentreGetPayload<{ select: typeof CENTRE_SELECT }>;

const partial = (year: number | null, month: number | null, day: number | null): PartialDate | null =>
  year === null ? null : { year, month, day };

/** A stored centre as the form's values: each date as precise as it was entered. */
export function centreValues(row: StoredCentre): CentreValues {
  return {
    name: row.name,
    provinceId: row.provinceId,
    from: partial(row.fromYear, row.fromMonth, row.fromDay),
    until: partial(row.untilYear, row.untilMonth, row.untilDay),
  };
}

/** A centre's row, at its place in the list (1 to 10). */
const centreRow = (caseId: string, centre: CentreValues, index: number): Prisma.CareCentreCreateManyInput => ({
  caseId,
  position: index + 1,
  name: centre.name,
  provinceId: centre.provinceId,
  fromYear: centre.from?.year ?? null,
  fromMonth: centre.from?.month ?? null,
  fromDay: centre.from?.day ?? null,
  untilYear: centre.until?.year ?? null,
  untilMonth: centre.until?.month ?? null,
  untilDay: centre.until?.day ?? null,
});

const CASE_SELECT = {
  id: true,
  dsOfficeId: true,
  buildDsOfficeId: true,
  ...CASE_PLACES,
  status: true,
  version: true,
  category: true,
  kind: true,
  applicationNumber: true,
  childName: true,
  name: true,
  nic: true,
  address: true,
  gnDivision: true,
  mobile1: true,
  mobile2: true,
  remark: true,
  careGroup: true,
  landGnDivision: true,
  dateOfBirth: true,
  relationship: true,
  relationshipOther: true,
  maritalStatus: true,
  familyMembers: true,
  disabledChildren: true,
  aid: true,
  aidOther: true,
  centres: { orderBy: { position: "asc" }, select: CENTRE_SELECT },
} as const satisfies Prisma.CaseSelect & Record<(typeof CASE_FIELDS)[number], true>;

type StoredCase = Prisma.CaseGetPayload<{ select: typeof CASE_SELECT }>;

/**
 * Saves the case form: a new case, which goes straight to `AWAITING_ALLOCATION` (CASE-5), or a change to
 * a saved one (CASE-9). Every required field is needed on every save: there are no drafts. Nothing is
 * saved when anything is refused.
 */
export async function saveCase(db: PrismaClient, actor: Actor, input: SaveCaseInput): Promise<Result<SavedCase>> {
  const scope = caseScope(actor);
  // Only an office's officers and the Ministry enter cases; any other account changes nothing (PRM-5).
  if (scope.kind === "none" || !canEnterCases(actor.role)) return { ok: false, error: "notFound" };
  const values = completeValues(input.values);
  if (!values) return { ok: false, error: "incomplete" };
  const complete: CompleteInput = { ...input, values };

  // The same new-case form sent twice at once, or two cases given one Application Number at once, meet
  // on a unique key; the next try finds the saved case, or the number taken (ERR-8, CASE-12).
  for (let attempt = 1; ; attempt += 1) {
    const current = await db.case.findUnique({ where: { id: input.id }, select: CASE_SELECT });
    if (current && !canSeeCase(actor, current)) return { ok: false, error: "notFound" };
    if (!current && input.version !== null) return { ok: false, error: "notFound" };
    // ERR-8: the same new-case form arrived twice. The first one saved the case; this one changes nothing.
    if (current && input.version === null) {
      return {
        ok: true,
        value: { id: current.id, applicationNumber: current.applicationNumber, status: current.status, created: true },
      };
    }

    // CASE-9, CASE-13: the DS where it is built sees the case but doesn't change its details.
    if (current && !canActOn(actor, current, "edit")) {
      return { ok: false, error: "notEditable" };
    }

    const office = scope.kind === "office" ? scope.dsOfficeId : (input.dsOfficeId ?? current?.dsOfficeId ?? null);
    if (office === null) return { ok: false, error: "officeRequired" };
    // "The same DS division" follows the case's office, wherever the Ministry moves it (CASE-13).
    const built = input.buildDsOfficeId ?? office;
    const problem = await checkSave(db, actor, current, complete, office, built);
    if (problem) return { ok: false, error: problem };

    try {
      const value = await db.$transaction((tx) => writeCase(tx, actor, current, complete, office, built));
      return { ok: true, value };
    } catch (error) {
      if (error instanceof Refusal) return { ok: false, error: error.reason as CaseCommandError };
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
}

async function checkSave(
  db: PrismaClient,
  actor: Actor,
  current: StoredCase | null,
  input: CompleteInput,
  office: number,
  built: number,
): Promise<CaseCommandError | null> {
  if (current) {
    if (!canEditDetails(actor.role, current.status)) return "notEditable";
    if (current.version !== input.version) return "conflict";
    if (office !== current.dsOfficeId && !canChangeOffice(actor.role, current.status)) return "notEditable";
    // CASE-13: from the allocation on, the money goes to the office where it is built, so that stays.
    if (built !== current.buildDsOfficeId && !canChangeBuildOffice(current.status)) return "notEditable";
    // The stages come from the kind of help (LST-4), so a case that has reached one keeps its kind.
    if (input.values.kind !== current.kind) {
      const reached = await db.stageUpdate.count({ where: { caseId: current.id, stageId: { not: null } } });
      if (reached > 0) return "kindLocked";
    }
  } else {
    const refusal = moveRefusal(actor.role, "save", null);
    if (refusal) return refusal;
  }

  // CASE-14: each centre's province is one of the list. The form offers nothing else.
  const provinceIds = [...new Set(input.values.centres.map((centre) => centre.provinceId))];
  if (provinceIds.length > 0) {
    const known = await db.province.count({ where: { id: { in: provinceIds } } });
    if (known !== provinceIds.length) return "incomplete";
  }

  // A new case, or one moving to another office, needs an active office (LST-3).
  if (!current || office !== current.dsOfficeId) {
    const found = await db.dsOffice.findUnique({ where: { id: office }, select: { active: true } });
    if (!found) return "notFound";
    if (!found.active) return "officeInactive";
  }
  // CASE-13: another active DS office; the DS of residence itself is "the same DS division".
  if (built !== office && (!current || built !== current.buildDsOfficeId)) {
    const found = await db.dsOffice.findUnique({ where: { id: built }, select: { active: true } });
    if (!found) return "buildOfficeRequired";
    if (!found.active) return "officeInactive";
  }
  // CASE-12: unique within the DS office of residence, without case or spaces.
  const taken = await db.case.count({
    where: {
      dsOfficeId: office,
      applicationKey: applicationKey(input.values.applicationNumber),
      id: { not: input.id },
    },
  });
  return taken > 0 ? "applicationNumberTaken" : null;
}

async function writeCase(
  tx: Prisma.TransactionClient,
  actor: Actor,
  current: StoredCase | null,
  input: CompleteInput,
  dsOfficeId: number,
  buildDsOfficeId: number,
): Promise<SavedCase> {
  const { centres, dateOfBirth, ...rest } = input.values;
  const fields = {
    ...rest,
    dateOfBirth: dayToDate(dateOfBirth),
    applicationKey: applicationKey(input.values.applicationNumber),
    nicKey: input.values.nic ? nicKey(input.values.nic) : null,
    dsOfficeId,
    buildDsOfficeId,
  };

  if (current) {
    const updated = await tx.case.updateMany({
      where: { id: current.id, version: current.version, status: { in: [...editableStatuses(actor.role)] } },
      data: { ...fields, version: { increment: 1 } },
    });
    if (updated.count === 0) throw new Refusal("conflict");
    // CASE-14: saving replaces the centres.
    await tx.careCentre.deleteMany({ where: { caseId: current.id } });
  } else {
    // CASE-5: saved straight into AWAITING_ALLOCATION; no draft, no check, no generated number.
    await tx.case.create({
      data: { id: input.id, ...fields, status: "AWAITING_ALLOCATION", createdById: actor.userId },
    });
  }
  if (centres.length > 0) {
    await tx.careCentre.createMany({ data: centres.map((centre, index) => centreRow(input.id, centre, index)) });
  }
  const documentIds = await attachDocuments(tx, actor, input.id, input.documentIds);

  // CASE-9, HIS-1: the old and new value of every field that changed, the centres as one field.
  const after: Record<Audited, unknown> = { ...input.values, dsOfficeId, buildDsOfficeId };
  const before: Record<Audited, unknown> | null = current && {
    ...current,
    dateOfBirth: current.dateOfBirth && dateToDay(current.dateOfBirth),
    centres: current.centres.map(centreValues),
  };
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changed = AUDITED.filter((field) => !before || !same(before[field], after[field]));
  const pick = (source: Record<string, unknown>) => Object.fromEntries(changed.map((f) => [f, source[f] ?? null]));
  if (!before) {
    await writeAudit(tx, {
      actorId: actor.userId,
      action: "case_created",
      entityType: "case",
      entityId: input.id,
      caseId: input.id,
      after: { ...withoutEmpty(pick(after)), status: "AWAITING_ALLOCATION", documentsAdded: documentIds },
    });
  } else if (changed.length > 0 || documentIds.length > 0) {
    await writeAudit(tx, {
      actorId: actor.userId,
      action: "case_updated",
      entityType: "case",
      entityId: input.id,
      caseId: input.id,
      before: pick(before),
      after: { ...pick(after), documentsAdded: documentIds },
    });
  }
  return {
    id: input.id,
    applicationNumber: input.values.applicationNumber,
    status: current?.status ?? "AWAITING_ALLOCATION",
    created: !current,
  };
}

/** The fields a save logs, with their old and new values (HIS-1). */
const AUDITED = ["dsOfficeId", "buildDsOfficeId", ...CASE_FIELDS, "centres"] as const;
type Audited = (typeof AUDITED)[number];

const withoutEmpty = (values: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0)),
  );

/** Puts the actor's own new uploads on the case, up to 10 documents in all (CASE-2). */
async function attachDocuments(
  tx: Prisma.TransactionClient,
  actor: Actor,
  caseId: string,
  ids: string[],
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const onCase = await tx.storedFile.count({ where: { caseId, kind: "DOCUMENT", removedAt: null } });
  if (onCase + unique.length > MAX_DOCUMENTS) throw new Refusal("tooManyFiles");
  const attached = await tx.storedFile.updateMany({
    where: { id: { in: unique }, kind: "DOCUMENT", caseId: null, uploadedById: actor.userId },
    data: { caseId },
  });
  if (attached.count !== unique.length) throw new Refusal("fileUnavailable");
  return unique;
}

/** Finds a case the actor may see, or nothing (PRM-1). */
async function findVisible(db: PrismaClient, actor: Actor, id: string) {
  const found = await db.case.findUnique({
    where: { id },
    select: { id: true, dsOfficeId: true, ...CASE_PLACES, status: true, version: true, applicationNumber: true },
  });
  return found && canSeeCase(actor, found) ? found : null;
}

export type DeleteCaseError = "notFound" | "notAllowedNow" | "conflict" | ReasonErrorKey;

/**
 * CASE-8: deletes a case awaiting its allocation, with its documents, for example one entered twice. It
 * needs a reason. The record of the deletion keeps the Application Number, the DS office and the reason,
 * without personal details; the earlier records of the case stay in the audit log, which can't be
 * changed (HIS-3).
 */
export async function deleteCase(
  db: PrismaClient,
  actor: Actor,
  input: { caseId: string; version: number; reason: string },
): Promise<{ ok: true } | { ok: false; error: DeleteCaseError }> {
  const found = await findVisible(db, actor, input.caseId);
  if (!found) return { ok: false, error: "notFound" };
  // CASE-8, CASE-13: only the DS of residence, or the Ministry, and only before the allocation.
  if (!canDeleteCase(actor.role, found.status) || !canActOn(actor, found, "delete")) {
    return { ok: false, error: "notAllowedNow" };
  }
  const reason = parseReason(input.reason);
  if (!reason.ok) return { ok: false, error: reason.error };
  if (found.version !== input.version) return { ok: false, error: "conflict" };

  let files: { id: string; storedName: string }[];
  try {
    files = await db.$transaction(async (tx) => {
      // Takes the row first, so a save or a letter at the same moment either goes first or finds it gone.
      const claimed = await tx.case.updateMany({
        where: { id: found.id, version: found.version, status: "AWAITING_ALLOCATION" },
        data: { version: { increment: 1 } },
      });
      if (claimed.count === 0) throw new Refusal("conflict");
      const onCase = await tx.storedFile.findMany({
        where: { caseId: found.id },
        select: { id: true, storedName: true },
      });
      await tx.storedFile.deleteMany({ where: { caseId: found.id } });
      // A case moved over from version 1 may still hold its decisions and notices.
      await tx.notification.deleteMany({ where: { caseId: found.id } });
      await tx.decision.deleteMany({ where: { caseId: found.id } });
      await tx.case.delete({ where: { id: found.id } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "case_deleted",
        entityType: "case",
        entityId: found.id,
        caseId: found.id,
        after: { applicationNumber: found.applicationNumber, dsOfficeId: found.dsOfficeId, reason: reason.value },
      });
      return onCase;
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.reason as DeleteCaseError };
    throw error;
  }
  for (const file of files) {
    await deleteStoredFile(file.storedName).catch((error: unknown) =>
      logError("file_delete_failed", error, { fileId: file.id }),
    );
  }
  return { ok: true };
}

/**
 * Takes a document off a case that can still be edited (CASE-2). The file itself is kept, because nothing
 * on a case is deleted (application spec, Data model); it no longer shows or opens.
 */
export async function removeDocument(
  db: PrismaClient,
  actor: Actor,
  caseId: string,
  fileId: string,
): Promise<Result<null>> {
  const found = await findVisible(db, actor, caseId);
  if (!found) return { ok: false, error: "notFound" };
  if (!canEditDetails(actor.role, found.status) || !canActOn(actor, found, "edit")) {
    return { ok: false, error: "notEditable" };
  }

  try {
    await db.$transaction(async (tx) => {
      const removed = await tx.storedFile.updateMany({
        where: { id: fileId, caseId, kind: "DOCUMENT", removedAt: null },
        data: { removedAt: new Date(), removedById: actor.userId },
      });
      if (removed.count === 0) throw new Refusal("notFound");
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "document_removed",
        entityType: "file",
        entityId: fileId,
        caseId,
      });
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.reason as CaseCommandError };
    throw error;
  }
  return { ok: true, value: null };
}
