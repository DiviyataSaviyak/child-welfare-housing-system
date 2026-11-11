"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RELEASE_FIELDS, type ReleaseErrors, type ReleaseField } from "@/lib/validation/release";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { uploadLetterScan } from "@/server/files/uploads";
import { correctRelease, MAX_LETTER_CASES, recordLetter, type ReleaseCommandError } from "@/server/releases/commands";
import { positive } from "@/components/cases/list-filters";
import { tickedCases } from "@/lib/validation/ticked-cases";

/** The Ministry's letter actions (REL-2 to REL-4). Each checks the role first. */

export type ReleaseState = { error: ReleaseCommandError | null; errors: ReleaseErrors };
/** The letter form's answer when it is refused; a saved letter goes on to the next page instead. */
export type LetterState = ReleaseState;

const read = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
};

/** The case and the version the screen showed; anything else the form never sends reads as not found. */
function target(form: FormData): { caseId: string; version: number } | null {
  const caseId = read(form, "caseId");
  const version = Number(read(form, "version"));
  return caseId.length > 0 && caseId.length <= 64 && Number.isInteger(version) ? { caseId, version } : null;
}

const releaseForm = (form: FormData) =>
  Object.fromEntries(RELEASE_FIELDS.map((field) => [field, read(form, field)])) as Record<ReleaseField, string>;

/**
 * REL-2, REL-3: records a district's allocation letter, which allocates every case ticked on it to the
 * district. The page then shows the letter's notice by its id, never by names (SEC-8), and stays on the
 * district.
 */
export async function recordLetterAction(_previous: LetterState, form: FormData): Promise<LetterState> {
  const actor = await requireRole("MINISTRY_OFFICER");
  const districtId = positive(read(form, "districtId"));
  const cases = tickedCases(form.getAll("case"), MAX_LETTER_CASES);
  if (!districtId || !cases) return { error: "notFound", errors: {} };

  const scanId = read(form, "scanId");
  const result = await recordLetter(db, actor, {
    districtId,
    cases,
    form: releaseForm(form),
    scanId: scanId.length > 0 && scanId.length <= 64 ? scanId : null,
  });
  if (!result.ok) return { error: result.error, errors: result.errors };
  // The menu's waiting counts live in the layout (NTF-1).
  revalidatePath("/ministry", "layout");
  redirect(
    `/ministry/allocate?${new URLSearchParams({ notice: "letterRecorded", letter: result.letterId, districtId: String(districtId) })}`,
  );
}

/** Stores the scan of an allocation letter as soon as it is chosen (REL-2). */
export async function uploadLetterScanAction(form: FormData) {
  const actor = await requireRole("MINISTRY_OFFICER");
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "fileEmpty" as const };
  return uploadLetterScan(db, actor, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
}

export async function correctReleaseAction(_previous: ReleaseState, form: FormData): Promise<ReleaseState> {
  const actor = await requireRole("MINISTRY_OFFICER");
  const chosen = target(form);
  if (!chosen) return { error: "notFound", errors: {} };

  const result = await correctRelease(db, actor, { ...chosen, form: releaseForm(form) });
  if (!result.ok) return { error: result.error, errors: result.errors };
  revalidatePath(`/ministry/cases/${chosen.caseId}`);
  redirect(`/ministry/cases/${chosen.caseId}?notice=corrected`);
}
