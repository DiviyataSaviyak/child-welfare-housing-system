import { type CaseErrors, parseBuildAnswer, parseCaseForm, parseOfficeId } from "@/lib/validation/case";
import type { CaseCommandError, SaveCaseInput } from "./commands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads a sent case form into a save request. The values get the same checks as in the browser, every
 * required field included (CASE-5). Anything malformed that the form itself never sends (a bad id or
 * version) reads as a case that doesn't exist.
 */
export function readCaseForm(
  form: FormData,
):
  | { ok: true; input: SaveCaseInput }
  | { ok: false; errors: CaseErrors; error: CaseCommandError | null }
  | { ok: false; notFound: true } {
  const read = (field: string) => {
    const value = form.get(field);
    return typeof value === "string" ? value : "";
  };

  const id = read("id");
  const versionText = read("version");
  const version = versionText === "" ? null : Number(versionText);
  if (!UUID.test(id) || (version !== null && !Number.isInteger(version))) return { ok: false, notFound: true };

  const parsed = parseCaseForm(read);
  // CASE-13: "another DS division" needs the office.
  const build = parseBuildAnswer(read("built"), read("buildDsOfficeId"));
  const buildMissing = build.kind === "other" && build.dsOfficeId === null;
  if (!parsed.ok || buildMissing) {
    return {
      ok: false,
      errors: parsed.ok ? {} : parsed.errors,
      error: buildMissing ? "buildOfficeRequired" : null,
    };
  }

  const documentIds = form
    .getAll("documentIds")
    .filter((value): value is string => typeof value === "string" && UUID.test(value));
  return {
    ok: true,
    input: {
      id,
      version,
      dsOfficeId: parseOfficeId(read("dsOfficeId")),
      buildDsOfficeId: build.kind === "other" ? build.dsOfficeId : null,
      values: parsed.value,
      documentIds,
    },
  };
}
