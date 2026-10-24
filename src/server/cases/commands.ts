import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import { colomboYear } from "@/lib/dates";
import { MAX_DOCUMENTS } from "@/lib/file-types";
import { nicKey } from "@/lib/nic";
import { CASE_FIELDS, type CaseValues, missingRequired } from "@/lib/validation/case";
import { writeAudit } from "../audit";
import { deleteStoredFile } from "../files/storage";
import { logError } from "../log";
import { canSeeOffice, caseScope, type Viewer } from "../permissions";
import { nextCaseNumber } from "./numbers";
import { isUniqueViolation, Refusal } from "./refusal";
import { CLOSED, replacementRefusal } from "./replacements";
import { canChangeOffice, canDeleteDraft, canEditDetails, editableStatuses, mustStayComplete } from "./rules";
import { applyMove, moveRefusal } from "./transitions";

/** The signed-in user making a change. */
export type Actor = Viewer & { userId: string };

export type CaseCommandError =
  /** It doesn't exist, or it isn't the actor's to see (PRM-1). */
  | "notFound"
  /** Its status doesn't allow this change (STS-1, STS-3, ERR-7). */
  | "notEditable"
  /** Someone else saved it after this form was opened (CASE-10, ERR-3). */
  | "conflict"
  /** A required field is empty, so it can't be submitted (CASE-5). */
  | "incomplete"
  /** Head Office didn't choose a DS office (CASE-3). */
  | "officeRequired"
  /** The office is inactive and takes no new cases (LST-3). */
  | "officeInactive"
  /** More than 10 documents (CASE-2). */
  | "tooManyFiles"
  /** An upload to attach isn't the actor's, or is already on a case. */
  | "fileUnavailable"
  /** The case's status doesn't allow this step (STS-1). */
  | "notAllowedNow"
  /** The actor's role never takes this step (application spec, Roles and permissions). */
  | "roleNotAllowed"
  /** The kind of help decides the stages, so it stays once a stage is recorded (CASE-9, STG-4). */
  | "kindLocked"
  /** The form asked whether the person is in place of another case, and got no answer (CASE-11). */
  | "replacementRequired"
  /** The case chosen to replace no longer waits for another name, or another case took its place (CASE-11). */
  | "replacementUnavailable";

type Result<T> = { ok: true; value: T } | { ok: false; error: CaseCommandError };

export type SaveCaseInput = {
  /** A new case's id is made when its form opens, so sending the form twice can't create two cases (ERR-8). */
  id: string;
  /** The version the form was opened with; null for a new case. */
  version: number | null;
  /** The office chosen on the form. Only Head Office chooses (CASE-3); a DS officer's comes from their account. */
  dsOfficeId: number | null;
  values: CaseValues;
  /** Uploads to put on the case. */
  documentIds: string[];
  /** Also send the case to Head Office (CASE-5). */
  submit: boolean;
  /**
   * The answer to "is this person in place of another case?" (CASE-11): undefined when the form didn't
   * ask, "" when it asked and got no answer, null for "no", or the id of the case replaced.
   */
  replaces?: string | null;
};

export type SavedCase = { id: string; caseNumber: string | null; status: CaseStatus };

const CASE_SELECT = {
  id: true,
  dsOfficeId: true,
  status: true,
  caseNumber: true,
  version: true,
  category: true,
  kind: true,
  childName: true,
  name: true,
  nic: true,
  address: true,
  gnDivision: true,
  mobile1: true,
  mobile2: true,
  remark: true,
  replacesCaseId: true,
} as const satisfies Prisma.CaseSelect & Record<(typeof CASE_FIELDS)[number], true>;

type StoredCase = Prisma.CaseGetPayload<{ select: typeof CASE_SELECT }>;

/**
 * Saves the case form: a new case, or a change to a draft or a returned case (CASE-1 to CASE-7).
 * With `submit`, the case also goes to Head Office in the same transaction, and gets its number on its
 * first submit (CASE-5). Nothing is saved when anything is refused.
 */
export async function saveCase(db: PrismaClient, actor: Actor, input: SaveCaseInput): Promise<Result<SavedCase>> {
  const scope = caseScope(actor);
  if (scope.kind === "none") return { ok: false, error: "notFound" };
  if (input.submit && Object.keys(missingRequired(input.values)).length > 0) return { ok: false, error: "incomplete" };

  // A first submit in a new year can meet another one at the counter; one try again is enough.
  for (let attempt = 1; ; attempt += 1) {
    const current = await db.case.findUnique({ where: { id: input.id }, select: CASE_SELECT });
    if (current && !canSeeOffice(actor, current.dsOfficeId)) return { ok: false, error: "notFound" };
    if (!current && input.version !== null) return { ok: false, error: "notFound" };
    // ERR-8: the same new-case form arrived twice. The first one saved the case; this one changes nothing.
    if (current && input.version === null) {
      return { ok: true, value: { id: current.id, caseNumber: current.caseNumber, status: current.status } };
    }

    const office = scope.kind === "office" ? scope.dsOfficeId : (input.dsOfficeId ?? current?.dsOfficeId ?? null);
    const problem = await checkSave(db, actor, current, input, office);
    if (problem) return { ok: false, error: problem };

    try {
      const value = await db.$transaction((tx) => writeCase(tx, actor, current, input, office as number));
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
  input: SaveCaseInput,
  office: number | null,
): Promise<CaseCommandError | null> {
  if (office === null) return "officeRequired";
  if (current) {
    if (!canEditDetails(actor.role, current.status)) return "notEditable";
    if (current.version !== input.version) return "conflict";
    if (office !== current.dsOfficeId && !canChangeOffice(actor.role, current.status)) return "notEditable";
    // CASE-9: a verified case keeps every required field, whichever button sent the form.
    if (mustStayComplete(current.status) && Object.keys(missingRequired(input.values)).length > 0) return "incomplete";
    // The stages come from the kind of help (LST-4), so a case that has reached one keeps its kind.
    if (input.values.kind !== current.kind) {
      const reached = await db.stageUpdate.count({ where: { caseId: current.id, stageId: { not: null } } });
      if (reached > 0) return "kindLocked";
    }
  }
  if (input.submit) {
    const refusal = moveRefusal(actor.role, "submit", current?.status ?? "DRAFT");
    if (refusal) return refusal;
    if (input.replaces === "") return "replacementRequired";
  }
  // CASE-11: a new link, or a linked draft moving to another office, must still find its case waiting.
  const link = linkAfterSave(current, input);
  if (link && (link !== current?.replacesCaseId || office !== current?.dsOfficeId)) {
    const refusal = await replacementRefusal(db, { caseId: input.id, targetId: link, dsOfficeId: office });
    if (refusal) return refusal;
  }
  // A new case, or a draft moving to another office, needs an active office (LST-3).
  if (!current || office !== current.dsOfficeId) {
    const found = await db.dsOffice.findUnique({ where: { id: office }, select: { active: true } });
    if (!found) return "notFound";
    if (!found.active) return "officeInactive";
  }
  return null;
}

async function writeCase(
  tx: Prisma.TransactionClient,
  actor: Actor,
  current: StoredCase | null,
  input: SaveCaseInput,
  dsOfficeId: number,
): Promise<SavedCase> {
  const now = new Date();
  const replacesCaseId = linkAfterSave(current, input);
  const fields = {
    ...input.values,
    nicKey: input.values.nic ? nicKey(input.values.nic) : null,
    dsOfficeId,
    replacesCaseId,
  };

  if (replacesCaseId && replacesCaseId !== (current?.replacesCaseId ?? null)) {
    await claimReplaced(tx, replacesCaseId, dsOfficeId);
  }
  if (!current) await tx.case.create({ data: { id: input.id, ...fields, createdById: actor.userId } });
  const documentIds = await attachDocuments(tx, actor, input.id, input.documentIds);

  // CASE-9, HIS-1: the old and new value of every field that changed.
  const changed = (["dsOfficeId", ...CASE_FIELDS, "replacesCaseId"] as const).filter(
    (field) => current?.[field] !== fields[field],
  );
  const pick = (source: Record<string, unknown>) => Object.fromEntries(changed.map((f) => [f, source[f] ?? null]));
  if (!current) {
    await writeAudit(tx, {
      actorId: actor.userId,
      action: "case_created",
      entityType: "case",
      entityId: input.id,
      caseId: input.id,
      after: { ...withoutEmpty(pick(fields)), documentsAdded: documentIds },
    });
  } else if (changed.length > 0 || documentIds.length > 0) {
    await writeAudit(tx, {
      actorId: actor.userId,
      action: "case_updated",
      entityType: "case",
      entityId: input.id,
      caseId: input.id,
      before: pick(current),
      after: { ...pick(fields), documentsAdded: documentIds },
    });
  }

  if (!input.submit) {
    if (current) {
      const updated = await tx.case.updateMany({
        where: { id: current.id, version: current.version, status: { in: [...editableStatuses(actor.role)] } },
        data: { ...fields, version: { increment: 1 } },
      });
      if (updated.count === 0) throw new Refusal("conflict");
      return { id: input.id, caseNumber: current.caseNumber, status: current.status };
    }
    return { id: input.id, caseNumber: null, status: "DRAFT" };
  }

  // CASE-5: the number is given on the first submit only. A new case was created as a draft above, so
  // its history reads "created", then "submitted"; a saved one changes its fields with the move.
  const caseNumber = current?.caseNumber ?? (await nextCaseNumber(tx, dsOfficeId, colomboYear(now)));
  await applyMove(
    tx,
    current
      ? { id: current.id, status: current.status, dsOfficeId: current.dsOfficeId, version: current.version }
      : { id: input.id, status: "DRAFT", dsOfficeId, version: 1 },
    "submit",
    {
      by: actor.role,
      actorId: actor.userId,
      at: now,
      checkVersion: true,
      data: { ...(current ? fields : {}), submittedAt: now, caseNumber },
      auditAfter: { caseNumber },
    },
  );
  return { id: input.id, caseNumber, status: "SUBMITTED" };
}

/**
 * The case this one replaces once saved (CASE-11): the form's answer, or the link it has when the form
 * didn't answer. A case Head Office has verified keeps its link.
 */
function linkAfterSave(current: StoredCase | null, input: SaveCaseInput): string | null {
  const kept = current?.replacesCaseId ?? null;
  if (input.replaces === undefined || input.replaces === "") return kept;
  if (current && mustStayComplete(current.status)) return kept;
  return input.replaces;
}

/**
 * Takes the replaced case's row for this transaction and moves its version on, so reopening it at the
 * same moment (CLS-3) is refused as a conflict instead of reopening a case that now has a replacement.
 */
async function claimReplaced(tx: Prisma.TransactionClient, id: string, dsOfficeId: number): Promise<void> {
  const claimed = await tx.case.updateMany({
    where: { id, dsOfficeId, anotherNameRequested: true, status: { in: [...CLOSED] } },
    data: { version: { increment: 1 } },
  });
  if (claimed.count === 0) throw new Refusal("replacementUnavailable");
}

const withoutEmpty = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));

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
  const found = await db.case.findUnique({ where: { id }, select: { id: true, dsOfficeId: true, status: true } });
  return found && canSeeOffice(actor, found.dsOfficeId) ? found : null;
}

/**
 * CASE-8: deletes a draft with its documents. The record of the deletion holds no personal details;
 * the earlier records of the draft stay in the audit log, which can't be changed (HIS-3).
 */
export async function deleteDraft(db: PrismaClient, actor: Actor, id: string): Promise<Result<null>> {
  const found = await findVisible(db, actor, id);
  if (!found) return { ok: false, error: "notFound" };
  if (!canDeleteDraft(actor.role, found.status)) return { ok: false, error: "notEditable" };

  let files: { id: string; storedName: string }[];
  try {
    files = await db.$transaction(async (tx) => {
      const onCase = await tx.storedFile.findMany({ where: { caseId: id }, select: { id: true, storedName: true } });
      await tx.storedFile.deleteMany({ where: { caseId: id } });
      // Submitted by someone else in the meantime: it is no longer a draft.
      const deleted = await tx.case.deleteMany({ where: { id, status: "DRAFT" } });
      if (deleted.count === 0) throw new Refusal("notEditable");
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "case_draft_deleted",
        entityType: "case",
        entityId: id,
        caseId: id,
        after: { dsOfficeId: found.dsOfficeId },
      });
      return onCase;
    });
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.reason as CaseCommandError };
    throw error;
  }
  for (const file of files) {
    await deleteStoredFile(file.storedName).catch((error: unknown) =>
      logError("file_delete_failed", error, { fileId: file.id }),
    );
  }
  return { ok: true, value: null };
}

/**
 * Takes a document off a draft or a returned case. The file itself is kept, because nothing on a
 * case is deleted (application spec, Data model); it no longer shows or opens.
 */
export async function removeDocument(
  db: PrismaClient,
  actor: Actor,
  caseId: string,
  fileId: string,
): Promise<Result<null>> {
  const found = await findVisible(db, actor, caseId);
  if (!found) return { ok: false, error: "notFound" };
  if (!canEditDetails(actor.role, found.status)) return { ok: false, error: "notEditable" };

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
