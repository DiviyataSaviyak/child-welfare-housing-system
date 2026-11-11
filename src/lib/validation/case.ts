import { z } from "zod";
import { isValidNic, normaliseNic } from "@/lib/nic";
import { isValidPhone, normalisePhone } from "@/lib/phone";

/**
 * The case form (CASE-1, CASE-2), checked the same way in the browser and in the Server Action.
 * Error messages are keys under "cases.form.errors" in messages/si.json.
 */
export const CATEGORIES = ["CARE_LEAVER", "CHILD_AT_RISK"] as const;
export type CategoryValue = (typeof CATEGORIES)[number];

export const KINDS = ["NEW_HOUSE", "RENOVATION"] as const;
export type KindValue = (typeof KINDS)[number];

/** The form's fields, in the order the form and its list of errors show them. */
export const CASE_FIELDS = [
  "category",
  "kind",
  "applicationNumber",
  "childName",
  "name",
  "nic",
  "address",
  "gnDivision",
  "mobile1",
  "mobile2",
  "remark",
] as const;
export type CaseField = (typeof CASE_FIELDS)[number];

export type CaseErrorKey =
  | "categoryRequired"
  | "kindRequired"
  | "applicationNumberRequired"
  | "childNameRequired"
  | "nameRequired"
  | "guardianNameRequired"
  | "nicInvalid"
  | "mobileInvalid"
  | "tooShort"
  | "tooLong";

export type CaseValues = {
  category: CategoryValue | null;
  kind: KindValue | null;
  /** CASE-12: as typed from the paper application, without spaces at either end. */
  applicationNumber: string | null;
  childName: string | null;
  name: string | null;
  nic: string | null;
  address: string | null;
  gnDivision: string | null;
  mobile1: string | null;
  mobile2: string | null;
  remark: string | null;
};
export type CaseErrors = Partial<Record<CaseField, CaseErrorKey>>;

/** The values of a case that passes `missingRequired`: what is stored (CASE-2, CASE-12). */
export type CompleteCaseValues = CaseValues & { category: CategoryValue; kind: KindValue; applicationNumber: string };

/** CASE-12: the longest Application Number, as typed from the paper application. */
export const APPLICATION_NUMBER_MAX = 30;

/** Free text: empty becomes null; when filled in, `min` to `max` characters. */
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: "tooLong" })
    .refine((value) => value === "" || value.length >= min, { error: "tooShort" })
    .transform((value) => value || null);

/** One of a fixed list; anything else counts as not chosen. */
const choice = <T extends string>(values: readonly T[]) =>
  z.string().transform((value) => (values.includes(value as T) ? (value as T) : null));

const FIELD_SCHEMAS: Record<CaseField, z.ZodType<string | null, string>> = {
  category: choice(CATEGORIES),
  kind: choice(KINDS),
  applicationNumber: text(1, APPLICATION_NUMBER_MAX),
  childName: text(2, 100),
  name: text(2, 100),
  nic: z
    .string()
    .transform(normaliseNic)
    .refine((value) => value === "" || isValidNic(value), { error: "nicInvalid" })
    .transform((value) => value || null),
  address: text(1, 300),
  gnDivision: text(1, 100),
  mobile1: z
    .string()
    .transform(normalisePhone)
    .refine((value) => value === "" || isValidPhone(value), { error: "mobileInvalid" })
    .transform((value) => value || null),
  mobile2: z
    .string()
    .transform(normalisePhone)
    .refine((value) => value === "" || isValidPhone(value), { error: "mobileInvalid" })
    .transform((value) => value || null),
  remark: text(1, 1000),
};

/**
 * The required fields that are still empty (CASE-2, CASE-12). Every save needs none (CASE-5, CASE-9):
 * there are no drafts. The NIC, address, GN division and phone numbers are optional: some beneficiaries
 * and guardians have none.
 */
export function missingRequired(values: CaseValues): CaseErrors {
  const atRisk = values.category === "CHILD_AT_RISK";
  const errors: CaseErrors = {};
  if (!values.category) errors.category = "categoryRequired";
  if (!values.kind) errors.kind = "kindRequired";
  if (!values.applicationNumber) errors.applicationNumber = "applicationNumberRequired";
  if (atRisk && !values.childName) errors.childName = "childNameRequired";
  if (!values.name) errors.name = atRisk ? "guardianNameRequired" : "nameRequired";
  return errors;
}

/** The values, when no required field is empty; otherwise null. */
export function completeValues(values: CaseValues): CompleteCaseValues | null {
  return Object.keys(missingRequired(values)).length === 0 ? (values as CompleteCaseValues) : null;
}

/** Reads the case form, with every required field (CASE-5). Missing fields count as empty. */
export function parseCaseForm(
  read: (field: CaseField) => string,
): { ok: true; value: CaseValues } | { ok: false; errors: CaseErrors } {
  const values = {} as Record<CaseField, string | null>;
  const errors: CaseErrors = {};
  for (const field of CASE_FIELDS) {
    const result = FIELD_SCHEMAS[field].safeParse(read(field));
    values[field] = result.success ? result.data : null;
    if (!result.success) errors[field] = result.error.issues[0]?.message as CaseErrorKey;
  }
  const value = values as CaseValues;

  // A care leaver has no child's name on the case, even if one was typed before the category changed.
  if (value.category === "CARE_LEAVER") {
    value.childName = null;
    delete errors.childName;
  }
  // A lone phone number goes first.
  if (!value.mobile1 && !errors.mobile1 && value.mobile2) [value.mobile1, value.mobile2] = [value.mobile2, null];
  for (const [field, key] of Object.entries(missingRequired(value))) errors[field as CaseField] ??= key;
  return Object.keys(errors).length === 0 ? { ok: true, value } : { ok: false, errors };
}

/** A DS office chosen on the form (CASE-3, CASE-13), or null when none is. */
export function parseOfficeId(raw: string): number | null {
  const id = Number(raw);
  return raw !== "" && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * CASE-13: the form's answer to "is the house built, or the land bought, in the DS division where the
 * beneficiary lives?". `same` is "yes", the default; `other` names the DS office where it is built, or
 * null when none was chosen yet.
 */
export type BuildAnswer = { kind: "same" } | { kind: "other"; dsOfficeId: number | null };

/** Reads the answer as the form sends it: `built` ("same" or "other") and `buildDsOfficeId`. */
export function parseBuildAnswer(built: string, buildDsOfficeId: string): BuildAnswer {
  return built === "other" ? { kind: "other", dsOfficeId: parseOfficeId(buildDsOfficeId) } : { kind: "same" };
}
