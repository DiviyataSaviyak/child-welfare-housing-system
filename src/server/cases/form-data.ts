import { type CaseErrors, parseCaseForm, parseOfficeId } from "@/lib/validation/case";
import type { SaveCaseInput } from "./commands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads a sent case form into a save request. The values get the same checks as in the browser:
 * format only for "save", every required field too for "submit" (CASE-4, CASE-5). Anything malformed
 * that the form itself never sends (a bad id or version) reads as a case that doesn't exist.
 */
export function readCaseForm(
  form: FormData,
): { ok: true; input: SaveCaseInput } | { ok: false; errors: CaseErrors } | { ok: false; notFound: true } {
  const read = (field: string) => {
    const value = form.get(field);
    return typeof value === "string" ? value : "";
  };

  const id = read("id");
  const versionText = read("version");
  const version = versionText === "" ? null : Number(versionText);
  if (!UUID.test(id) || (version !== null && !Number.isInteger(version))) return { ok: false, notFound: true };

  const submit = read("intent") === "submit";
  const parsed = parseCaseForm(read, submit ? "submit" : "draft");
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  // CASE-11: sent only when the form asked; "" is no answer, "none" is "no", anything else a case id.
  const asked = form.get("replaces");
  const replaces = typeof asked !== "string" ? undefined : asked === "none" ? null : asked;
  if (typeof replaces === "string" && replaces.length > 64) return { ok: false, notFound: true };

  const documentIds = form
    .getAll("documentIds")
    .filter((value): value is string => typeof value === "string" && UUID.test(value));
  return {
    ok: true,
    input: {
      id,
      version,
      dsOfficeId: parseOfficeId(read("dsOfficeId")),
      values: parsed.value,
      documentIds,
      submit,
      replaces,
    },
  };
}
