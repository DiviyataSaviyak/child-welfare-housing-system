"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RELEASE_FIELDS, type ReleaseErrors, type ReleaseField } from "@/lib/validation/release";
import { type DecideError, decideCase, type Decision, isDecision } from "@/server/cases/decide";
import type { Queue } from "@/server/cases/queues";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { uploadLetterScan } from "@/server/files/uploads";
import { correctRelease, MAX_LETTER_CASES, recordLetter, type ReleaseCommandError } from "@/server/releases/commands";
import { positive } from "../cases/filters";
import { placeQuery, readPlace } from "./place";

/** Head Office's check and release actions (CHK-3, REL-2 to REL-4). Each checks the role first. */

export type DecisionState = { error: DecideError | null };
export type ReleaseState = { error: ReleaseCommandError | null; errors: ReleaseErrors };
/** The letter form's answer when it is refused; a saved letter goes on to the next page instead. */
export type LetterState = ReleaseState;

/** The notice each change leaves on the next page, by its key under "review.notices". */
const NOTICE: Record<Decision, string> = { verify: "verified", sendBack: "sentBack", reject: "rejected" };

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

/**
 * After a change: back to the queue it was made from, in the same district or DS office (CHK-4), with
 * the next case selected, or to the case's own page. The notice names the case by its id, never by
 * personal details (SEC-8).
 */
function goOn(form: FormData, queue: Queue, caseId: string, notice: string): never {
  // The menu's waiting counts live in the layout (NTF-1).
  revalidatePath("/ho", "layout");
  if (read(form, "from") === "case") redirect(`/ho/cases/${caseId}?notice=${notice}`);
  const query = new URLSearchParams({ notice, done: caseId });
  for (const [key, value] of placeQuery(readPlace((key) => read(form, key)))) query.set(key, value);
  redirect(`/ho/${queue}?${query}`);
}

export async function decideAction(_previous: DecisionState, form: FormData): Promise<DecisionState> {
  const actor = await requireRole("HO_OFFICER");
  const decision = read(form, "decision");
  const chosen = target(form);
  if (!chosen || !isDecision(decision)) return { error: "notFound" };

  const askAnotherName = decision === "reject" && read(form, "anotherName") === "1";
  const result = await decideCase(db, actor, { ...chosen, decision, reason: read(form, "reason"), askAnotherName });
  if (!result.ok) return { error: result.error };
  goOn(form, "check", chosen.caseId, askAnotherName ? "rejectedAskName" : NOTICE[decision]);
}

const releaseForm = (form: FormData) =>
  Object.fromEntries(RELEASE_FIELDS.map((field) => [field, read(form, field)])) as Record<ReleaseField, string>;

/** The letter's cases as the form sends them, "<case id>:<version>"; null if any is malformed. */
function letterCases(form: FormData): { id: string; version: number }[] | null {
  const sent = form.getAll("case");
  if (sent.length > MAX_LETTER_CASES) return null;
  const cases: { id: string; version: number }[] = [];
  for (const value of sent) {
    const [id, version, extra] = typeof value === "string" ? value.split(":") : [];
    if (!id || id.length > 64 || extra !== undefined || !/^\d+$/.test(version ?? "")) return null;
    cases.push({ id, version: Number(version) });
  }
  return cases;
}

/**
 * REL-2, REL-3: records a district's allocation letter, which releases every case ticked on it. The
 * page then shows the letter's notice by its id, never by names (SEC-8), and stays on the district.
 */
export async function recordLetterAction(_previous: LetterState, form: FormData): Promise<LetterState> {
  const actor = await requireRole("HO_OFFICER");
  const districtId = positive(read(form, "districtId"));
  const cases = letterCases(form);
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
  revalidatePath("/ho", "layout");
  redirect(
    `/ho/release?${new URLSearchParams({ notice: "letterRecorded", letter: result.letterId, districtId: String(districtId) })}`,
  );
}

/** Stores the scan of an allocation letter as soon as it is chosen (REL-2). */
export async function uploadLetterScanAction(form: FormData) {
  const actor = await requireRole("HO_OFFICER");
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "fileEmpty" as const };
  return uploadLetterScan(db, actor, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
}

export async function correctReleaseAction(_previous: ReleaseState, form: FormData): Promise<ReleaseState> {
  const actor = await requireRole("HO_OFFICER");
  const chosen = target(form);
  if (!chosen) return { error: "notFound", errors: {} };

  const result = await correctRelease(db, actor, { ...chosen, form: releaseForm(form) });
  if (!result.ok) return { error: result.error, errors: result.errors };
  revalidatePath(`/ho/cases/${chosen.caseId}`);
  redirect(`/ho/cases/${chosen.caseId}?notice=corrected`);
}
