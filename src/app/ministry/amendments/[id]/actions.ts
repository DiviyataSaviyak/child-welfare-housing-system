"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProgressState } from "@/components/progress/types";
import { decideAmendmentForm } from "@/server/amendments/form-actions";
import { requireRole } from "@/server/context";

/**
 * AMD-4: the Ministry approves or rejects an amendment, then comes back to its page with a notice. Only a
 * Ministry officer; the server layer checks the area and AMD-5 again.
 */

async function decide(form: FormData, decision: "approve" | "reject"): Promise<ProgressState> {
  const actor = await requireRole("MINISTRY_OFFICER");
  const result = await decideAmendmentForm(actor, form, decision);
  if (!result.ok) return result.state;
  // The cases, their counts and the menu's figures change with an approval.
  revalidatePath("/ministry", "layout");
  redirect(
    `/ministry/amendments/${String(form.get("amendmentId"))}?notice=${decision === "approve" ? "approved" : "rejected"}`,
  );
}

export async function approveAmendmentAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  return decide(form, "approve");
}

export async function rejectAmendmentAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  return decide(form, "reject");
}
