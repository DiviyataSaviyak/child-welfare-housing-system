"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProgressState } from "@/components/progress/types";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { undoInstallmentPayment } from "@/server/installments/commands";

/** The Ministry's action on a running case: undo a payment (INS-6). */

const read = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
};

function target(form: FormData): { caseId: string; version: number; reason: string } | null {
  const caseId = read(form, "caseId");
  const version = Number(read(form, "version"));
  if (caseId.length === 0 || caseId.length > 64 || !Number.isInteger(version)) return null;
  return { caseId, version, reason: read(form, "reason") };
}

/** Back to the case page with a notice. The menu's counts and the lists change too. */
function done(caseId: string, notice: string): never {
  revalidatePath("/ministry", "layout");
  redirect(`/ministry/cases/${caseId}?notice=${notice}`);
}

export async function undoInstallmentAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const actor = await requireRole("MINISTRY_OFFICER");
  const chosen = target(form);
  const number = Number(read(form, "number"));
  if (!chosen || !Number.isInteger(number)) return { error: "notFound", errors: {} };
  const result = await undoInstallmentPayment(db, actor, { ...chosen, number });
  if (!result.ok) return { error: result.error, errors: {} };
  done(chosen.caseId, "undone");
}
