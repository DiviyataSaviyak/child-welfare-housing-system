import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { colomboDay, dateToDay, dayToDate } from "@/lib/dates";
import { MAX_PHOTOS } from "@/lib/file-types";
import { parseStageForm, type ProgressErrorKey, type StageField, stageLimits } from "@/lib/validation/progress";
import { writeAudit } from "../audit";
import { claimCase } from "../cases/claim";
import type { Actor } from "../cases/commands";
import { completeIfDone } from "../cases/complete";
import { Refusal } from "../cases/refusal";
import { PROGRESS_STATUSES, takesProgress } from "../cases/rules";
import { CASE_PLACES, canActOn, canSeeCase } from "../permissions";
import { getStageProgress } from "./queries";

export type StageError =
  | "notFound"
  | "roleNotAllowed"
  /** Stage updates are allowed only once the allocation is received, until the case is completed (STG-5). */
  | "caseNotRunning"
  | "conflict"
  /** More than 10 photos (STG-1). */
  | "tooManyPhotos"
  /** A photo to attach isn't the actor's own new upload. */
  | "photoUnavailable";

export type StageResult =
  | { ok: true; completed: boolean }
  | { ok: false; error: StageError | null; errors: Partial<Record<StageField, ProgressErrorKey>> };

export type StageInput = {
  caseId: string;
  /** The case's version when the page was shown (CASE-10). */
  version: number;
  form: Record<StageField, string>;
  /** The officer's own photo uploads to put on the update. */
  photoIds: string[];
};

const refused = (error: StageError): StageResult => ({ ok: false, error, errors: {} });

/**
 * STG-1 to STG-5: the DS office records building progress: a stage later than the current one, or a
 * note-only visit, on a day no later than today and on or after the District's release, with a note and up to
 * 10 photos. Choosing a stage further ahead marks the stages it skips as reached on the same day
 * (STG-2). A `LAND_AND_BUILD` case follows the new-house stages; `LAND_ONLY` and `LAND_WITH_HOUSE`, and a
 * renovation case with no stages defined, take note-only updates (STG-4). Reaching the last stage may
 * finish the case (CLS-1).
 */
export async function recordStageUpdate(db: PrismaClient, actor: Actor, input: StageInput): Promise<StageResult> {
  const found = await db.case.findUnique({
    where: { id: input.caseId },
    select: {
      id: true,
      status: true,
      dsOfficeId: true,
      ...CASE_PLACES,
      version: true,
      kind: true,
      release: { select: { dsReleasedOn: true } },
    },
  });
  if (!found || !canSeeCase(actor, found)) return refused("notFound");
  // CASE-13: only the DS where it is built records the stages; the DS of residence only sees them.
  if (actor.role !== "DS_OFFICER" || !canActOn(actor, found, "stage")) return refused("roleNotAllowed");
  // STG-5: from the District's release to the DS until it is completed; a stage never moves the status.
  const dsReleasedOn = found.release?.dsReleasedOn;
  if (!takesProgress(found.status) || !dsReleasedOn) return refused("caseNotRunning");

  const now = new Date();
  // Sinhala names for the audit record, which also keeps all three (UI-9).
  const progress = await getStageProgress(db, found.id, found.kind, "si");
  const limits = stageLimits(colomboDay(now), dateToDay(dsReleasedOn), progress.current?.reachedOn ?? null);
  const parsed = parseStageForm((field) => input.form[field], limits);
  if (!parsed.ok) return { ok: false, error: null, errors: parsed.errors };
  const { stageId, visitedOn, note } = parsed.value;

  // The chosen stage and the ones it skips (STG-2), in order; empty for a note-only visit.
  const chosenIndex = stageId === null ? -1 : progress.choices.findIndex((c) => c.id === stageId);
  if (stageId !== null && chosenIndex < 0) return { ok: false, error: null, errors: { stageId: "stageNotLater" } };
  const reaching = progress.choices.slice(0, chosenIndex + 1);

  const photoIds = [...new Set(input.photoIds)];
  if (photoIds.length > MAX_PHOTOS) return refused("tooManyPhotos");
  if (found.version !== input.version) return refused("conflict");

  try {
    const completed = await db.$transaction(async (tx) => {
      await claimCase(tx, found, PROGRESS_STATUSES);
      const day = dayToDate(visitedOn);
      // The skipped stages first, then the chosen one, which carries the note and photos.
      const rows = [
        ...reaching.slice(0, -1).map((stage) => ({ id: randomUUID(), stageId: stage.id, note: null })),
        { id: randomUUID(), stageId, note },
      ];
      for (const row of rows) {
        await tx.stageUpdate.create({
          data: { ...row, caseId: found.id, visitedOn: day, byId: actor.userId, at: now },
        });
      }
      const main = rows.at(-1)!;
      if (photoIds.length > 0) {
        const attached = await tx.storedFile.updateMany({
          where: { id: { in: photoIds }, kind: "PHOTO", caseId: null, uploadedById: actor.userId },
          data: { caseId: found.id, stageUpdateId: main.id },
        });
        if (attached.count !== photoIds.length) throw new Refusal("photoUnavailable");
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "stage_updated",
        entityType: "stage_update",
        entityId: main.id,
        caseId: found.id,
        before: { stageId: progress.current?.id ?? null },
        after: {
          stageIds: reaching.map((stage) => stage.id),
          // The names as they were, so the history still reads right after a stage is renamed: in
          // Sinhala as before, and in all three languages since 7 Oct 2026 (UI-9).
          stages: reaching.map((stage) => stage.name),
          stageNames: reaching.map((stage) => stage.names),
          visitedOn,
          note,
          photos: photoIds,
        },
      });
      if (reaching.length === 0) return false;
      return completeIfDone(tx, { ...found, version: found.version + 1 }, now);
    });
    return { ok: true, completed };
  } catch (error) {
    if (error instanceof Refusal) return refused(error.reason === "photoUnavailable" ? "photoUnavailable" : "conflict");
    throw error;
  }
}
