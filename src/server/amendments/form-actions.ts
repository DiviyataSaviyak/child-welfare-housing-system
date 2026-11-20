import type { CaseFormState } from "@/components/forms/case-form";
import type { ProgressState } from "@/components/progress/types";
import { parseReason } from "@/lib/validation/decision";
import { RETURN_FIELDS, type ReturnField } from "@/lib/validation/progress";
import type { Actor } from "../cases/commands";
import { readCaseForm } from "../cases/form-data";
import { db } from "../db";
import { approveAmendment, rejectAmendment, submitAmendment } from "./commands";
import { askNomination, sendBackNomination } from "./nominations";

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

  const { id, version, dsOfficeId, buildDsOfficeId, values, documentIds } = read.input;
  // AMD-13: the District's nomination names the DS's request, its version and the DS of residence chosen.
  const nominationId = text(form, "nominationId");
  const nominationVersion = Number(text(form, "nominationVersion"));
  let nomination: { id: string; version: number; dsOfficeId: number } | null = null;
  if (nominationId !== "") {
    if (nominationId.length > 64 || !Number.isInteger(nominationVersion)) {
      return { ok: false, state: { errors: {}, error: "notFound", reasonError: null } };
    }
    if (dsOfficeId === null) return { ok: false, state: { errors: {}, error: "officeRequired", reasonError: null } };
    nomination = { id: nominationId, version: nominationVersion, dsOfficeId };
  }
  const result = await submitAmendment(db, actor, {
    id,
    caseId,
    caseVersion: version,
    buildDsOfficeId,
    values,
    reason,
    documentIds,
    nomination,
  });
  if (!result.ok) {
    return { ok: false, state: { errors: {}, error: result.error, reasonError: result.reasonError ?? null } };
  }
  return { ok: true, caseId: result.value.caseId };
}

/**
 * AMD-4: the Ministry's approve and reject forms on the amendment page: the amendment and its version, the
 * existing case's version, for an approval that sends the money back its return (AMD-11), and for a
 * rejection the reason. A refusal comes back to the pop-up; on success
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
  // AMD-11: the return's fields, sent only when the page asked for them.
  const returned =
    text(form, "returnAsked") === "1"
      ? (Object.fromEntries(RETURN_FIELDS.map((field) => [field, text(form, field)])) as Record<ReturnField, string>)
      : null;
  const result =
    decision === "approve"
      ? Number.isInteger(caseVersion)
        ? await approveAmendment(db, actor, { amendmentId, version, caseVersion, returned })
        : ({ ok: false, error: "notFound" } as const)
      : await rejectAmendment(db, actor, { amendmentId, version, reason: text(form, "reason") });
  return result.ok
    ? result
    : { ok: false, state: { error: result.error, errors: "errors" in result ? (result.errors ?? {}) : {} } };
}

/**
 * AMD-12, AMD-13: the "ask the District" pop-up on the DS's case page (the request's id made when the page
 * rendered, the case and its version, the reason) and the District's "send back" pop-up (the request, its
 * version, the reason). A refusal comes back to the pop-up; on success the caller moves on.
 */
export async function nominationForm(
  actor: Actor,
  form: FormData,
  step: "ask" | "sendBack",
): Promise<{ ok: true; caseId: string } | { ok: false; state: ProgressState }> {
  const id = text(form, "nominationId");
  const version = Number(text(form, "version"));
  const caseId = text(form, "caseId");
  if (id === "" || id.length > 64 || !Number.isInteger(version) || caseId === "" || caseId.length > 64) {
    return { ok: false, state: { error: "notFound", errors: {} } };
  }
  const result =
    step === "ask"
      ? await askNomination(db, actor, { id, caseId, caseVersion: version, reason: text(form, "reason") })
      : await sendBackNomination(db, actor, { nominationId: id, version, reason: text(form, "reason") });
  return result.ok ? { ok: true, caseId } : { ok: false, state: { error: result.error, errors: {} } };
}
