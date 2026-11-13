"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MAX_PHOTOS } from "@/lib/file-types";
import {
  PAID_FIELDS,
  type PaidField,
  STAGE_FIELDS,
  type StageField,
  START_FIELDS,
  type StartField,
} from "@/lib/validation/progress";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { type PhotoUploadError, type UploadedFile, uploadPhoto } from "@/server/files/uploads";
import { correctInstallment, markInstallmentPaid, startInstallment } from "@/server/installments/commands";
import { recordStageUpdate } from "@/server/stages/commands";
import type { ProgressState } from "@/components/progress/types";

/** The DS office's installment and building-progress actions (INS-3, INS-4, STG-1). Each checks the role first. */

const read = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
};

/** The case and the version the page showed; anything else the form never sends reads as not found. */
function target(form: FormData): { caseId: string; version: number } | null {
  const caseId = read(form, "caseId");
  const version = Number(read(form, "version"));
  return caseId.length > 0 && caseId.length <= 64 && Number.isInteger(version) ? { caseId, version } : null;
}

const fields = <F extends string>(form: FormData, names: readonly F[]) =>
  Object.fromEntries(names.map((name) => [name, read(form, name)])) as Record<F, string>;

/** Back to the case page with a notice. The DS home's lists and to-do panel change too. */
function done(caseId: string, notice: string): never {
  revalidatePath("/ds");
  redirect(`/ds/cases/${caseId}?notice=${notice}`);
}

export async function startInstallmentAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const actor = await requireRole("DS_OFFICER");
  const chosen = target(form);
  const number = Number(read(form, "number"));
  if (!chosen || !Number.isInteger(number)) return { error: "notFound", errors: {} };

  const result = await startInstallment(db, actor, { ...chosen, number, form: fields<StartField>(form, START_FIELDS) });
  if (!result.ok) return { error: result.error, errors: result.errors };
  done(chosen.caseId, "started");
}

/** INS-8: a land case's installment being paid, corrected by the DS where it is built. */
export async function correctInstallmentAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const actor = await requireRole("DS_OFFICER");
  const chosen = target(form);
  const number = Number(read(form, "number"));
  if (!chosen || !Number.isInteger(number)) return { error: "notFound", errors: {} };

  const result = await correctInstallment(db, actor, {
    ...chosen,
    number,
    form: fields<StartField>(form, START_FIELDS),
  });
  if (!result.ok) return { error: result.error, errors: result.errors };
  done(chosen.caseId, "corrected");
}

export async function payInstallmentAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const actor = await requireRole("DS_OFFICER");
  const chosen = target(form);
  const number = Number(read(form, "number"));
  if (!chosen || !Number.isInteger(number)) return { error: "notFound", errors: {} };

  const result = await markInstallmentPaid(db, actor, {
    ...chosen,
    number,
    form: fields<PaidField>(form, PAID_FIELDS),
  });
  if (!result.ok) return { error: result.error, errors: result.errors };
  done(chosen.caseId, result.completed ? "completed" : "paid");
}

export async function stageUpdateAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const actor = await requireRole("DS_OFFICER");
  const chosen = target(form);
  if (!chosen) return { error: "notFound", errors: {} };
  const photoIds = form
    .getAll("photoId")
    .filter((id): id is string => typeof id === "string" && id.length <= 64)
    .slice(0, MAX_PHOTOS + 1);

  const result = await recordStageUpdate(db, actor, {
    ...chosen,
    form: fields<StageField>(form, STAGE_FIELDS),
    photoIds,
  });
  if (!result.ok) return { error: result.error, errors: result.errors };
  done(chosen.caseId, result.completed ? "completed" : "stage");
}

/** STG-1, STG-3: one photo per request, uploaded as soon as it is chosen, like the case's documents. */
export async function uploadPhotoAction(
  form: FormData,
): Promise<{ ok: true; value: UploadedFile } | { ok: false; error: PhotoUploadError }> {
  const actor = await requireRole("DS_OFFICER");
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "fileEmpty" };
  return uploadPhoto(db, actor, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
}
