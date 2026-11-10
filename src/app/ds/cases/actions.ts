"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CaseFormState } from "@/components/forms/case-form";
import type { ProgressState } from "@/components/progress/types";
import { requireRole } from "@/server/context";
import {
  deleteCaseForm,
  nicMatchesFor,
  removeCaseDocument,
  saveCaseForm,
  uploadFromForm,
} from "@/server/cases/form-actions";

/** The DS officer's case actions. Each checks the role, then the office rules apply in the server layer. */

export async function saveCaseAction(_previous: CaseFormState, form: FormData): Promise<CaseFormState> {
  const actor = await requireRole("DS_OFFICER");
  const result = await saveCaseForm(actor, form);
  if (!result.ok) return result.state;

  revalidatePath("/ds");
  const { id, created } = result.saved;
  redirect(`/ds/cases/${id}?notice=${created ? "created" : "changed"}`);
}

export async function uploadDocumentAction(form: FormData) {
  return uploadFromForm(await requireRole("DS_OFFICER"), form);
}

export async function checkNicAction(nic: string, caseId: string, dsOfficeId: number | null) {
  return nicMatchesFor(await requireRole("DS_OFFICER"), nic, caseId, dsOfficeId);
}

export async function removeDocumentAction(caseId: string, fileId: string) {
  const result = await removeCaseDocument(await requireRole("DS_OFFICER"), caseId, fileId);
  if (!result.error) revalidatePath(`/ds/cases/${caseId}`);
  return result;
}

/** CASE-8: deletes a case awaiting its allocation, with a reason, then goes back to the list. */
export async function deleteCaseAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const refused = await deleteCaseForm(await requireRole("DS_OFFICER"), form);
  if (refused) return refused;
  revalidatePath("/ds");
  redirect("/ds?notice=deleted");
}
