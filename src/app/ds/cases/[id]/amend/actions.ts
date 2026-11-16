"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CaseFormState } from "@/components/forms/case-form";
import { submitAmendmentForm } from "@/server/amendments/form-actions";
import { requireRole } from "@/server/context";

/**
 * AMD-1: a CRPO of the DS of residence submits an amendment to the Ministry, then goes back to the case page.
 * The office rules and AMD-2 and AMD-8 apply in the server layer.
 */
export async function submitAmendmentAction(_previous: CaseFormState, form: FormData): Promise<CaseFormState> {
  const actor = await requireRole("DS_OFFICER");
  const result = await submitAmendmentForm(actor, form);
  if (!result.ok) return result.state;

  revalidatePath("/ds");
  redirect(`/ds/cases/${result.caseId}?notice=amendmentSubmitted`);
}
