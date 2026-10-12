"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProgressState } from "@/components/progress/types";
import { reopenCase, stopCase } from "@/server/cases/stop";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { undoInstallmentPayment } from "@/server/installments/commands";

/** Head Office's actions on a running case: stop and reopen (CLS-2, CLS-3), and undo a payment (INS-6). */

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
  revalidatePath("/ho", "layout");
  redirect(`/ho/cases/${caseId}?notice=${notice}`);
}

export async function stopAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const actor = await requireRole("HO_OFFICER");
  const chosen = target(form);
  if (!chosen) return { error: "notFound", errors: {} };
  const askAnotherName = read(form, "anotherName") === "1";
  const result = await stopCase(db, actor, { ...chosen, askAnotherName });
  if (!result.ok) return { error: result.error, errors: {} };
  done(chosen.caseId, askAnotherName ? "stoppedAskName" : "stopped");
}

export async function reopenAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const actor = await requireRole("HO_OFFICER");
  const chosen = target(form);
  if (!chosen) return { error: "notFound", errors: {} };
  const result = await reopenCase(db, actor, chosen);
  if (!result.ok) return { error: result.error, errors: {} };
  done(chosen.caseId, "reopened");
}

export async function undoInstallmentAction(_previous: ProgressState, form: FormData): Promise<ProgressState> {
  const actor = await requireRole("HO_OFFICER");
  const chosen = target(form);
  const number = Number(read(form, "number"));
  if (!chosen || !Number.isInteger(number)) return { error: "notFound", errors: {} };
  const result = await undoInstallmentPayment(db, actor, { ...chosen, number });
  if (!result.ok) return { error: result.error, errors: {} };
  done(chosen.caseId, "undone");
}
