"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { positive } from "@/components/cases/list-filters";
import { DS_RELEASE_FIELDS, type DsReleaseErrors, type DsReleaseField } from "@/lib/validation/ds-release";
import { tickedCases } from "@/lib/validation/ticked-cases";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { uploadLetterScan } from "@/server/files/uploads";
import {
  correctDsRelease,
  type DsReleaseCommandError,
  MAX_LETTER_CASES,
  recordDsRelease,
} from "@/server/releases/commands";

/** The District officer's release actions (REL-6 to REL-9). Each checks the role first. */

export type DsReleaseState = { error: DsReleaseCommandError | null; errors: DsReleaseErrors };

const read = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
};

const releaseForm = (form: FormData) =>
  Object.fromEntries(DS_RELEASE_FIELDS.map((field) => [field, read(form, field)])) as Record<DsReleaseField, string>;

/**
 * REL-6, REL-7: records the District's release to one DS office of the cases ticked on it. The page then
 * shows the release's notice by its id, never by names (SEC-8).
 */
export async function recordDsReleaseAction(_previous: DsReleaseState, form: FormData): Promise<DsReleaseState> {
  const actor = await requireRole("DISTRICT_OFFICER");
  const dsOfficeId = positive(read(form, "dsOfficeId"));
  const cases = tickedCases(form.getAll("case"), MAX_LETTER_CASES);
  if (!dsOfficeId || !cases) return { error: "notFound", errors: {} };

  const scanId = read(form, "scanId");
  const result = await recordDsRelease(db, actor, {
    dsOfficeId,
    cases,
    form: releaseForm(form),
    scanId: scanId.length > 0 && scanId.length <= 64 ? scanId : null,
  });
  if (!result.ok) return { error: result.error, errors: result.errors };
  // The menu's waiting count lives in the layout (NTF-1).
  revalidatePath("/oversight", "layout");
  redirect(`/oversight/release?${new URLSearchParams({ notice: "released", release: result.dsReleaseId })}`);
}

/** Stores the scan of the District's letter as soon as it is chosen (REL-6). */
export async function uploadDsReleaseScanAction(form: FormData) {
  const actor = await requireRole("DISTRICT_OFFICER");
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "fileEmpty" as const };
  return uploadLetterScan(db, actor, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
}

/** REL-8: corrects the District release behind a case, for every case on it. */
export async function correctDsReleaseAction(_previous: DsReleaseState, form: FormData): Promise<DsReleaseState> {
  const actor = await requireRole("DISTRICT_OFFICER");
  const caseId = read(form, "caseId");
  const version = Number(read(form, "version"));
  if (caseId.length === 0 || caseId.length > 64 || !Number.isInteger(version)) return { error: "notFound", errors: {} };

  const result = await correctDsRelease(db, actor, { caseId, version, form: releaseForm(form) });
  if (!result.ok) return { error: result.error, errors: result.errors };
  revalidatePath(`/oversight/cases/${caseId}`);
  redirect(`/oversight/cases/${caseId}?notice=dsCorrected`);
}
