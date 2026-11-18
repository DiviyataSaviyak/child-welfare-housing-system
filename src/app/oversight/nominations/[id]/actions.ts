"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CaseFormState } from "@/components/forms/case-form";
import type { ProgressState } from "@/components/progress/types";
import { nominationForm, submitAmendmentForm } from "@/server/amendments/form-actions";
import { nicMatchesFor, uploadFromForm } from "@/server/cases/form-actions";
import { requireRole } from "@/server/context";

/**
 * AMD-13: the District officer's actions on a DS's request for a nomination. Each checks the role; the
 * district, the request and AMD-2 and AMD-8 are checked in the server layer.
 */

/** Nominates the new beneficiary on the amendment form, then goes to the case page. */
export async function nominateAction(_previous: CaseFormState, form: FormData): Promise<CaseFormState> {
  const result = await submitAmendmentForm(await requireRole("DISTRICT_OFFICER"), form);
  if (!result.ok) return result.state;
  revalidatePath("/oversight", "layout");
  redirect(`/oversight/cases/${result.caseId}?notice=nominated`);
}

/** Sends the request back with a reason, then goes to the case page. */
export async function sendBackNominationAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const result = await nominationForm(await requireRole("DISTRICT_OFFICER"), form, "sendBack");
  if (!result.ok) return result.state;
  revalidatePath("/oversight", "layout");
  redirect(`/oversight/cases/${result.caseId}?notice=nominationSentBack`);
}

export async function uploadNominationDocumentAction(form: FormData) {
  return uploadFromForm(await requireRole("DISTRICT_OFFICER"), form);
}

export async function checkNominationNicAction(nic: string, caseId: string, dsOfficeId: number | null) {
  return nicMatchesFor(await requireRole("DISTRICT_OFFICER"), nic, caseId, dsOfficeId);
}

/** A nomination's form has no saved documents to remove: its uploads are removed in the browser. */
export async function removeNominationDocumentAction() {
  await requireRole("DISTRICT_OFFICER");
  return { error: "notFound" as const };
}
