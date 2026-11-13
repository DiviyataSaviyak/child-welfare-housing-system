import { z } from "zod";
import { colomboDay, parseDay } from "@/lib/dates";
import { isValidNic, normaliseNic } from "@/lib/nic";
import { isValidPhone, normalisePhone } from "@/lib/phone";

/**
 * The case form (CASE-1, CASE-2, CASE-14 to CASE-17), checked the same way in the browser and in the Server
 * Action. Error messages are keys under "cases.form.errors" in messages/si.json.
 */
export const CATEGORIES = ["CARE_LEAVER", "CHILD_AT_RISK"] as const;
export type CategoryValue = (typeof CATEGORIES)[number];

/**
 * The kinds of help (CASE-17), in two groups that are paid differently: the house kinds in four
 * installments of Rs. 500,000 (INS-1), the land kinds in up to four of the amounts the purchase needs
 * (INS-7). Every rule that depends on the group uses these, never a list of its own.
 */
export const HOUSE_KINDS = ["NEW_HOUSE", "RENOVATION"] as const;
export type HouseKind = (typeof HOUSE_KINDS)[number];

export const LAND_KINDS = ["LAND_ONLY", "LAND_AND_BUILD", "LAND_WITH_HOUSE"] as const;
export type LandKind = (typeof LAND_KINDS)[number];

/** Every kind, the house kinds first, as the form and the filters offer them. */
export const KINDS = [...HOUSE_KINDS, ...LAND_KINDS] as const;
export type KindValue = (typeof KINDS)[number];

export function isHouseKind(kind: KindValue): kind is HouseKind {
  return (HOUSE_KINDS as readonly KindValue[]).includes(kind);
}

/**
 * The stage list a kind follows (STG-4, LST-4): a house kind its own, `LAND_AND_BUILD` the new-house one,
 * and the other land kinds none, so they take only note-only updates.
 */
export function stageKind(kind: KindValue): HouseKind | null {
  if (isHouseKind(kind)) return kind;
  return kind === "LAND_AND_BUILD" ? "NEW_HOUSE" : null;
}

/** A care leaver's group (CASE-14). */
export const CARE_GROUPS = ["IN_CARE", "LEFT_CARE"] as const;
export type CareGroupValue = (typeof CARE_GROUPS)[number];

/** A care leaver's marital status (CASE-14). */
export const MARITAL_STATUSES = ["UNMARRIED", "MARRIED"] as const;
export type MaritalStatusValue = (typeof MARITAL_STATUSES)[number];

/** How the parent or guardian is related to a child at risk (CASE-15); `OTHER` is typed. */
export const RELATIONSHIPS = ["MOTHER", "FATHER", "OTHER"] as const;
export type RelationshipValue = (typeof RELATIONSHIPS)[number];

/** The aid a family receives (CASE-16), in the form's order; `OTHER` is typed. */
export const AIDS = ["ARTHA", "KIDNEY", "SAMURDHI", "ASWESUMA", "ELDERLY", "DISABILITY", "OTHER"] as const;
export type AidValue = (typeof AIDS)[number];

/** The form's fields, in the order the form and its list of errors show them. Each is a column of `case`. */
export const CASE_FIELDS = [
  "category",
  "careGroup",
  "kind",
  "landGnDivision",
  "applicationNumber",
  "childName",
  "name",
  "dateOfBirth",
  "relationship",
  "relationshipOther",
  "maritalStatus",
  "nic",
  "address",
  "gnDivision",
  "mobile1",
  "mobile2",
  "remark",
  "familyMembers",
  "disabledChildren",
  "aid",
  "aidOther",
] as const;
export type CaseField = (typeof CASE_FIELDS)[number];

/** A child development centre's fields on the form (CASE-14), sent as `centres[0].name` and so on. */
export const CENTRE_FIELDS = [
  "name",
  "provinceId",
  "fromYear",
  "fromMonth",
  "fromDay",
  "untilYear",
  "untilMonth",
  "untilDay",
] as const;
export type CentreField = (typeof CENTRE_FIELDS)[number];

/** The parts of a centre an error points at: a date is checked as a whole. */
export const CENTRE_PARTS = ["name", "provinceId", "from", "until"] as const;
export type CentrePart = (typeof CENTRE_PARTS)[number];

/** A centre's field as the form sends it. */
export const centreInput = (index: number, field: CentreField): string => `centres[${index}].${field}`;

/** The most centres a care leaver may have (CASE-14). */
export const MAX_CENTRES = 10;
/** The earliest year a centre's date may have (CASE-14). */
export const EARLIEST_CENTRE_YEAR = 1950;
/** The largest family (CASE-16). */
export const MAX_FAMILY = 30;
/** A date of birth may be at most this many years ago (CASE-2). */
export const OLDEST_AGE = 100;

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
  | "tooLong"
  | "careGroupRequired"
  | "dateOfBirthRequired"
  | "maritalStatusRequired"
  | "relationshipRequired"
  | "relationshipOtherRequired"
  | "familyMembersRequired"
  | "familyMembersInvalid"
  | "disabledChildrenRequired"
  | "aidOtherRequired"
  | "centresRequired"
  | "tooManyCentres"
  | "centreNameRequired"
  | "centreProvinceRequired"
  | "dateInvalid"
  | "dateInFuture"
  | "dateTooOld"
  | "dateTooEarly"
  | "monthNeedsYear"
  | "dayNeedsMonth"
  | "untilBeforeFrom";

/** An error's place: a field, the centres as a whole, or one part of one centre (by its place on the form). */
export type CentreErrorField = `centres.${number}.${CentrePart}`;
export type CaseErrorField = CaseField | "centres" | CentreErrorField;
export type CaseErrors = Partial<Record<CaseErrorField, CaseErrorKey>>;

export const centreError = (index: number, part: CentrePart): CentreErrorField => `centres.${index}.${part}`;

/**
 * A date known in part (CASE-14): a year, a year and a month, or a full day. What is stored is exactly what
 * was known.
 */
export type PartialDate = { year: number; month: number | null; day: number | null };

/** One child development centre a care leaver lived in (CASE-14). */
export type CentreValues = { name: string; provinceId: number; from: PartialDate | null; until: PartialDate | null };

export type CaseValues = {
  category: CategoryValue | null;
  /** Care leavers only (CASE-14). */
  careGroup: CareGroupValue | null;
  kind: KindValue | null;
  /** The GN division where the land is (CASE-17), as typed. */
  landGnDivision: string | null;
  /** CASE-12: as typed from the paper application, without spaces at either end. */
  applicationNumber: string | null;
  childName: string | null;
  name: string | null;
  /** "YYYY-MM-DD": the care leaver's, or the child's (CASE-14, CASE-15). */
  dateOfBirth: string | null;
  /** Children at risk only (CASE-15). */
  relationship: RelationshipValue | null;
  /** Only with `relationship` OTHER. */
  relationshipOther: string | null;
  /** Care leavers only (CASE-14). */
  maritalStatus: MaritalStatusValue | null;
  nic: string | null;
  address: string | null;
  gnDivision: string | null;
  mobile1: string | null;
  mobile2: string | null;
  remark: string | null;
  familyMembers: number | null;
  disabledChildren: boolean | null;
  /** None ticked is an empty list (CASE-16). */
  aid: AidValue[];
  /** Only with `OTHER` in `aid`. */
  aidOther: string | null;
  /** Care leavers only, in the order they lived in them (CASE-14). */
  centres: CentreValues[];
};

/** The values of a case that passes `missingRequired`: what is stored (CASE-2, CASE-12). */
export type CompleteCaseValues = CaseValues & {
  category: CategoryValue;
  kind: KindValue;
  applicationNumber: string;
  dateOfBirth: string;
  familyMembers: number;
  disabledChildren: boolean;
};

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

const phone = z
  .string()
  .transform(normalisePhone)
  .refine((value) => value === "" || isValidPhone(value), { error: "mobileInvalid" })
  .transform((value) => value || null);

/** The schema of each field, given today in Colombo ("YYYY-MM-DD") for the date of birth. */
function fieldSchemas(today: string): { [F in CaseField]: z.ZodType<CaseValues[F], string> } {
  return {
    category: choice(CATEGORIES),
    careGroup: choice(CARE_GROUPS),
    kind: choice(KINDS),
    landGnDivision: text(1, 100),
    applicationNumber: text(1, APPLICATION_NUMBER_MAX),
    childName: text(2, 100),
    name: text(2, 100),
    dateOfBirth: z
      .string()
      .trim()
      .refine((value) => value === "" || parseDay(value) !== null, { error: "dateInvalid" })
      .refine((value) => parseDay(value) === null || value <= today, { error: "dateInFuture" })
      .refine((value) => parseDay(value) === null || value >= oldestBirthDay(today), { error: "dateTooOld" })
      .transform((value) => value || null),
    relationship: choice(RELATIONSHIPS),
    relationshipOther: text(2, 50),
    maritalStatus: choice(MARITAL_STATUSES),
    nic: z
      .string()
      .transform(normaliseNic)
      .refine((value) => value === "" || isValidNic(value), { error: "nicInvalid" })
      .transform((value) => value || null),
    address: text(1, 300),
    gnDivision: text(1, 100),
    mobile1: phone,
    mobile2: phone,
    remark: text(1, 1000),
    familyMembers: z
      .string()
      .trim()
      .refine((value) => value === "" || /^\d{1,2}$/.test(value), { error: "familyMembersInvalid" })
      .transform((value) => (value === "" ? null : Number(value)))
      .refine((value) => value === null || (value >= 1 && value <= MAX_FAMILY), { error: "familyMembersInvalid" }),
    disabledChildren: z.string().transform((value) => (value === "yes" ? true : value === "no" ? false : null)),
    // Sent as the ticked codes joined by commas; kept in the list's order, each once.
    aid: z.string().transform((value) => {
      const ticked = new Set(value.split(","));
      return AIDS.filter((aid) => ticked.has(aid));
    }),
    aidOther: text(2, 200),
  };
}

/** The earliest date of birth the form takes: 100 years before today (CASE-2). */
function oldestBirthDay(today: string): string {
  return `${String(Number(today.slice(0, 4)) - OLDEST_AGE).padStart(4, "0")}${today.slice(4)}`;
}

/** Whole years from a date of birth to today, both "YYYY-MM-DD" (CASE-14, CASE-15). Never stored. */
export function ageOn(dateOfBirth: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return today.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/**
 * CASE-14: a centre's "from" or "until", typed as a year, a month (1–12) and a day (1–31), each optional.
 * Null when all three are empty. A month needs a year and a day needs a month; the date must exist, not be in
 * the future (at its own precision) and not be before 1950.
 */
export function parsePartialDate(
  yearText: string,
  monthText: string,
  dayText: string,
  today: string,
): { ok: true; value: PartialDate | null } | { ok: false; error: CaseErrorKey } {
  const [y, m, d] = [yearText.trim(), monthText.trim(), dayText.trim()];
  if (y === "" && m === "" && d === "") return { ok: true, value: null };
  if (y === "" && m !== "") return { ok: false, error: "monthNeedsYear" };
  if (m === "" && d !== "") return { ok: false, error: "dayNeedsMonth" };
  if (!/^\d{4}$/.test(y) || (m !== "" && !/^\d{1,2}$/.test(m)) || (d !== "" && !/^\d{1,2}$/.test(d))) {
    return { ok: false, error: "dateInvalid" };
  }
  const value: PartialDate = { year: Number(y), month: m === "" ? null : Number(m), day: d === "" ? null : Number(d) };
  if (value.month !== null && (value.month < 1 || value.month > 12)) return { ok: false, error: "dateInvalid" };
  if (value.day !== null && !parseDay(partialKey(value))) return { ok: false, error: "dateInvalid" };
  if (value.year < EARLIEST_CENTRE_YEAR) return { ok: false, error: "dateTooEarly" };
  const key = partialKey(value);
  if (key > today.slice(0, key.length)) return { ok: false, error: "dateInFuture" };
  return { ok: true, value };
}

/** "YYYY", "YYYY-MM" or "YYYY-MM-DD": compares as a string with a day of the same precision. */
function partialKey(date: PartialDate): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    String(date.year).padStart(4, "0"),
    date.month === null ? null : pad(date.month),
    date.day === null ? null : pad(date.day),
  ]
    .filter((part) => part !== null)
    .join("-");
}

/**
 * Whether "until" comes before "from", compared to the precision both have (CASE-14): from `2015.03` until
 * `2015` is accepted, from `2015.03` until `2015.02` is not.
 */
export function untilBeforeFrom(from: PartialDate, until: PartialDate): boolean {
  const a = partialKey(from);
  const b = partialKey(until);
  const length = Math.min(a.length, b.length);
  return b.slice(0, length) < a.slice(0, length);
}

/** A partial date as precisely as it was entered (UI-3): `2015`, `2015.03` or `2015.03.12`. */
export function formatPartialDate(date: PartialDate): string {
  return partialKey(date).replaceAll("-", ".");
}

/**
 * Drops what doesn't belong to the chosen category, and the "other" texts whose "other" isn't chosen, so
 * switching the category or unticking "other" keeps no hidden value (CASE-14, CASE-15, CASE-16). The database
 * checks refuse anything a caller forgot to drop.
 */
export function withoutOtherCategory(values: CaseValues): CaseValues {
  const tidy = { ...values };
  if (tidy.category === "CARE_LEAVER") {
    tidy.childName = null;
    tidy.relationship = null;
  }
  if (tidy.category === "CHILD_AT_RISK") {
    tidy.careGroup = null;
    tidy.maritalStatus = null;
    tidy.centres = [];
  }
  if (tidy.relationship !== "OTHER") tidy.relationshipOther = null;
  if (!tidy.aid.includes("OTHER")) tidy.aidOther = null;
  return tidy;
}

/**
 * The required fields that are still empty (CASE-2, CASE-12, CASE-14 to CASE-16). Every save needs none
 * (CASE-5, CASE-9): there are no drafts, and a case entered before change 0007 asks for its new details on
 * its next save. The NIC, address, GN divisions and phone numbers are optional: some beneficiaries and
 * guardians have none.
 */
export function missingRequired(values: CaseValues): CaseErrors {
  const atRisk = values.category === "CHILD_AT_RISK";
  const careLeaver = values.category === "CARE_LEAVER";
  const errors: CaseErrors = {};
  if (!values.category) errors.category = "categoryRequired";
  if (careLeaver && !values.careGroup) errors.careGroup = "careGroupRequired";
  if (!values.kind) errors.kind = "kindRequired";
  if (!values.applicationNumber) errors.applicationNumber = "applicationNumberRequired";
  if (atRisk && !values.childName) errors.childName = "childNameRequired";
  if (!values.name) errors.name = atRisk ? "guardianNameRequired" : "nameRequired";
  if (!values.dateOfBirth) errors.dateOfBirth = "dateOfBirthRequired";
  if (atRisk && !values.relationship) errors.relationship = "relationshipRequired";
  if (atRisk && values.relationship === "OTHER" && !values.relationshipOther) {
    errors.relationshipOther = "relationshipOtherRequired";
  }
  if (careLeaver && !values.maritalStatus) errors.maritalStatus = "maritalStatusRequired";
  if (careLeaver && values.centres.length === 0) errors.centres = "centresRequired";
  if (values.familyMembers === null) errors.familyMembers = "familyMembersRequired";
  if (values.disabledChildren === null) errors.disabledChildren = "disabledChildrenRequired";
  if (values.aid.includes("OTHER") && !values.aidOther) errors.aidOther = "aidOtherRequired";
  return errors;
}

/** The values, tidied for their category, when no required field is empty; otherwise null. */
export function completeValues(values: CaseValues): CompleteCaseValues | null {
  const tidy = withoutOtherCategory(values);
  return Object.keys(missingRequired(tidy)).length === 0 ? (tidy as CompleteCaseValues) : null;
}

/**
 * The centres as sent (CASE-14). A box left wholly empty is skipped, so an added box nobody filled in
 * stops nothing; errors name each box by its place on the form.
 */
function readCentres(read: (field: string) => string, today: string): { centres: CentreValues[]; errors: CaseErrors } {
  const centres: CentreValues[] = [];
  const errors: CaseErrors = {};
  let filled = 0;
  // One more than the most, to notice too many.
  for (let index = 0; index <= MAX_CENTRES; index += 1) {
    const field = (name: CentreField) => read(centreInput(index, name)).trim();
    if (CENTRE_FIELDS.every((name) => field(name) === "")) continue;
    filled += 1;

    const name = text(2, 150).safeParse(field("name"));
    if (!name.success) errors[centreError(index, "name")] = name.error.issues[0]?.message as CaseErrorKey;
    else if (!name.data) errors[centreError(index, "name")] = "centreNameRequired";

    const provinceId = Number(field("provinceId"));
    const provinceOk = /^\d+$/.test(field("provinceId")) && provinceId > 0;
    if (!provinceOk) errors[centreError(index, "provinceId")] = "centreProvinceRequired";

    const from = parsePartialDate(field("fromYear"), field("fromMonth"), field("fromDay"), today);
    const until = parsePartialDate(field("untilYear"), field("untilMonth"), field("untilDay"), today);
    if (!from.ok) errors[centreError(index, "from")] = from.error;
    if (!until.ok) errors[centreError(index, "until")] = until.error;
    else if (from.ok && from.value && until.value && untilBeforeFrom(from.value, until.value)) {
      errors[centreError(index, "until")] = "untilBeforeFrom";
    }

    if (name.success && name.data && provinceOk && from.ok && until.ok) {
      centres.push({ name: name.data, provinceId, from: from.value, until: until.value });
    }
  }
  if (filled > MAX_CENTRES) errors.centres = "tooManyCentres";
  return { centres, errors };
}

/**
 * Reads the case form, with every required field (CASE-5). Missing fields count as empty. `today` is the
 * day in Colombo ("YYYY-MM-DD") that dates are checked against (ARC-6).
 */
export function parseCaseForm(
  read: (field: string) => string,
  today: string = colomboDay(new Date()),
): { ok: true; value: CaseValues } | { ok: false; errors: CaseErrors } {
  const schemas = fieldSchemas(today);
  const values: Record<string, unknown> = {};
  const errors: CaseErrors = {};
  for (const field of CASE_FIELDS) {
    const result = (schemas[field] as z.ZodType<unknown, string>).safeParse(read(field));
    values[field] = result.success ? result.data : field === "aid" ? [] : null;
    if (!result.success) errors[field] = result.error.issues[0]?.message as CaseErrorKey;
  }
  const centres = readCentres(read, today);
  Object.assign(errors, centres.errors);
  const value = withoutOtherCategory({ ...(values as Omit<CaseValues, "centres">), centres: centres.centres });

  // What doesn't belong to the category, or to an "other" not chosen, is dropped with its errors.
  const dropped: CaseErrorField[] = [];
  if (value.category === "CARE_LEAVER") dropped.push("childName", "relationship");
  if (value.relationship !== "OTHER") dropped.push("relationshipOther");
  if (!value.aid.includes("OTHER")) dropped.push("aidOther");
  for (const field of dropped) delete errors[field];
  if (value.category === "CHILD_AT_RISK") {
    delete errors.careGroup;
    delete errors.maritalStatus;
    for (const key of Object.keys(errors)) if (key.startsWith("centres")) delete errors[key as CaseErrorField];
  }

  // A lone phone number goes first.
  if (!value.mobile1 && !errors.mobile1 && value.mobile2) [value.mobile1, value.mobile2] = [value.mobile2, null];
  for (const [field, key] of Object.entries(missingRequired(value))) errors[field as CaseErrorField] ??= key;
  return Object.keys(errors).length === 0 ? { ok: true, value } : { ok: false, errors };
}

/** What the form holds while it is filled in: every field as typed. */
export type CaseFormValues = Record<CaseField, string>;
export type CentreFormValues = Record<CentreField, string>;

/** A reader over the form's own state, for `parseCaseForm` in the browser. */
export function formReader(values: CaseFormValues, centres: CentreFormValues[]): (field: string) => string {
  return (field) => {
    const centre = /^centres\[(\d+)\]\.(\w+)$/.exec(field);
    if (centre) return centres[Number(centre[1])]?.[centre[2] as CentreField] ?? "";
    return (values as Record<string, string>)[field] ?? "";
  };
}

/** A DS office chosen on the form (CASE-3, CASE-13), or null when none is. */
export function parseOfficeId(raw: string): number | null {
  const id = Number(raw);
  return raw !== "" && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * CASE-13, CASE-17: the form's answer to "where is the land?" (or the house, for a renovation). `same` is
 * the DS division where the beneficiary lives, the default; `other` names the DS office, or null when none
 * was chosen yet.
 */
export type BuildAnswer = { kind: "same" } | { kind: "other"; dsOfficeId: number | null };

/** Reads the answer as the form sends it: `built` ("same" or "other") and `buildDsOfficeId`. */
export function parseBuildAnswer(built: string, buildDsOfficeId: string): BuildAnswer {
  return built === "other" ? { kind: "other", dsOfficeId: parseOfficeId(buildDsOfficeId) } : { kind: "same" };
}
