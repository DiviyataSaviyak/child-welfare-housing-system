import type { Prisma } from "@/generated/prisma/client";
import type { CaseValues, CompleteCaseValues } from "@/lib/validation/case";

/**
 * What an amendment holds for its new beneficiary until the Ministry decides (`amendment.details`): the
 * case form's values, as `completeValues` gave them when it was submitted, with the centres, and the DS
 * office where they would be built (CASE-13; the DS of residence is the existing case's, AMD-8). The
 * documents are files of the amendment, not part of it. Personal data, like a case's (SEC-8).
 */
export type AmendmentDetails = CompleteCaseValues & { buildDsOfficeId: number };

export function detailsJson(details: AmendmentDetails): Prisma.InputJsonValue {
  return details as unknown as Prisma.InputJsonValue;
}

/** The new beneficiary's name, child's name and Application Number, for the lists and boxes that name them. */
export type AmendmentPerson = { name: string | null; childName: string | null; applicationNumber: string };

const textOrNull = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);

/**
 * Reads the names from a stored amendment's details. Only the command writes them, after its checks; this
 * reads defensively anyway, so a row written by hand can't break a page.
 */
export function amendmentPerson(details: Prisma.JsonValue): AmendmentPerson {
  const object = typeof details === "object" && details !== null && !Array.isArray(details) ? details : {};
  return {
    name: textOrNull(object.name),
    childName: textOrNull(object.childName),
    applicationNumber: textOrNull(object.applicationNumber) ?? "",
  };
}

/**
 * A stored amendment's details as the form's values and the DS office where the new beneficiary would be
 * built, or null when they aren't an object with that office. The approval runs `completeValues` on them
 * again before anything is saved (AMD-5).
 */
export function readDetails(details: Prisma.JsonValue): { values: CaseValues; buildDsOfficeId: number } | null {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return null;
  const { buildDsOfficeId, ...values } = details as Record<string, unknown>;
  if (typeof buildDsOfficeId !== "number" || !Number.isInteger(buildDsOfficeId)) return null;
  const centres = Array.isArray(values.centres) ? values.centres : [];
  const aid = Array.isArray(values.aid) ? values.aid : [];
  return { values: { ...(values as unknown as CaseValues), centres, aid }, buildDsOfficeId };
}
