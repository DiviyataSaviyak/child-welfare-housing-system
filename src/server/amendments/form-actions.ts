import type { CaseFormState } from "@/components/forms/case-form";
import type { ProgressState } from "@/components/progress/types";
import { parseReason } from "@/lib/validation/decision";
import type { Actor } from "../cases/commands";
import { readCaseForm } from "../cases/form-data";
import { db } from "../db";
import { approveAmendment, rejectAmendment, submitAmendment } from "./commands";

const text = (form: FormData, field: string) => {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
};

/**
 * AMD-1: reads the case form in `amend` mode and submits the amendment. The new beneficiary's details get
 * the same checks as a new case's (CASE-5); `id` is the amendment's own, `version` the existing case's
 * (CASE-10), and `caseId` and `reason` come with them. The role was checked by the caller (requireRole).
 */
export async function submitAmendmentForm(
  actor: Actor,
  form: FormData,
): Promise<{ ok: true; caseId: string } | { ok: false; state: CaseFormState }> {
  const caseId = text(form, "caseId");
  const reason = text(form, "reason");
  const read = readCaseForm(form);
  if (!read.ok || read.input.version === null || caseId === "" || caseId.length > 64) {
    const checked = parseReason(reason);
    const reasonError = checked.ok ? null : checked.error;
    if (read.ok || "notFound" in read) return { ok: false, state: { errors: {}, error: "notFound", reasonError } };
    return { ok: false, state: { errors: read.errors, error: read.error, reasonError } };
  }

  const { id, version, buildDsOfficeId, values, documentIds } = read.input;
  const result = await submitAmendment(db, actor, {
    id,
    caseId,
    caseVersion: version,
    buildDsOfficeId,
    values,
    reason,
    documentIds,
  });
  if (!result.ok) {
    return { ok: false, state: { errors: {}, error: result.error, reasonError: result.reasonError ?? null } };
  }
  return { ok: true, caseId: result.value.caseId };
}

/**
 * AMD-4: the Ministry's approve and reject forms on the amendment page: the amendment and its version, the
 * existing case's version, and for a rejection the reason. A refusal comes back to the pop-up; on success
 * the caller moves on.
 */
export async function decideAmendmentForm(
  actor: Actor,
  form: FormData,
  decision: "approve" | "reject",
): Promise<{ ok: true; caseId: string } | { ok: false; state: ProgressState }> {
  const amendmentId = text(form, "amendmentId");
  const version = Number(text(form, "version"));
  const caseVersion = Number(text(form, "caseVersion"));
  if (amendmentId === "" || amendmentId.length > 64 || !Number.isInteger(version)) {
    return { ok: false, state: { error: "notFound", errors: {} } };
  }
  const result =
    decision === "approve"
      ? Number.isInteger(caseVersion)
        ? await approveAmendment(db, actor, { amendmentId, version, caseVersion })
        : ({ ok: false, error: "notFound" } as const)
      : await rejectAmendment(db, actor, { amendmentId, version, reason: text(form, "reason") });
  return result.ok ? result : { ok: false, state: { error: result.error, errors: {} } };
}
