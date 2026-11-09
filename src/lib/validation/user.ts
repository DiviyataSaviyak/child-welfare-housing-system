import { z } from "zod";
import { isValidPhone, normalisePhone } from "@/lib/phone";
import {
  type Designation,
  designationsOf,
  isDesignation,
  OFFICE_TYPES,
  type OfficeType,
  placeOf,
  roleOf,
} from "@/server/auth/designations";
import type { Role } from "@/server/auth/roles";

/**
 * The account form (ADM-2, ADM-4, ADM-8), checked the same way in the browser and in the Server Action.
 * Error messages are keys under "users.form.errors" in messages/si.json.
 */

export type AccountErrorKey =
  | "required"
  | "tooShort"
  | "tooLong"
  | "mobile"
  | "email"
  | "officeType"
  | "designation"
  | "office"
  | "district"
  | "province";

const contactEmail = z
  .string()
  .trim()
  .max(254, { error: "tooLong" })
  .refine((value) => value === "" || z.email().safeParse(value).success, { error: "email" })
  .transform((value) => value || null);

/** The details an officer may change on their own profile page too. */
const personFields = {
  name: z.string().trim().min(1, { error: "required" }).min(2, { error: "tooShort" }).max(100, { error: "tooLong" }),
  mobile: z
    .string()
    .transform(normalisePhone)
    .pipe(z.string().min(1, { error: "required" }).refine(isValidPhone, { error: "mobile" })),
  contactEmail,
};

/** ADM-2: on the account form the name, mobile and email may all be left empty. An empty name is stored as "". */
const optionalPersonFields = {
  name: z
    .string()
    .trim()
    .refine((value) => value === "" || value.length >= 2, { error: "tooShort" })
    .refine((value) => value.length <= 100, { error: "tooLong" }),
  mobile: z
    .string()
    .transform(normalisePhone)
    .refine((value) => value === "" || isValidPhone(value), { error: "mobile" })
    .transform((value) => value || null),
  contactEmail,
};

const id = z
  .string()
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value === null || (Number.isInteger(value) && value > 0));

const PLACE_ERROR = { dsOffice: "office", district: "district", province: "province" } as const;
const PLACE_FIELD = { dsOffice: "dsOfficeId", district: "districtId", province: "provinceId" } as const;

export type AccountInput = {
  name: string;
  mobile: string | null;
  contactEmail: string | null;
  /** Null for an administrator. */
  designation: Designation | null;
  /** Always the designation's role (ADM-8); the form never sends one. */
  role: Role;
  /** Exactly the one place the office type belongs to; the others are null. */
  dsOfficeId: number | null;
  districtId: number | null;
  provinceId: number | null;
};

const designationOf = (officeType: OfficeType, value: string): Designation | null =>
  isDesignation(value) && designationsOf(officeType).includes(value) ? value : null;

export const accountSchema = z
  .object({
    ...optionalPersonFields,
    officeType: z.enum(OFFICE_TYPES, { error: "officeType" }),
    designation: z.string(),
    dsOfficeId: id,
    districtId: id,
    provinceId: id,
  })
  .superRefine((value, context) => {
    // ADM-8: a designation of another office type is refused; an administrator has none.
    if (value.officeType !== "ADMINISTRATOR" && designationOf(value.officeType, value.designation) === null) {
      context.addIssue({ code: "custom", path: ["designation"], message: "designation" });
    }
    const place = placeOf(value.officeType);
    if (place && value[PLACE_FIELD[place]] === null) {
      context.addIssue({ code: "custom", path: [PLACE_FIELD[place]], message: PLACE_ERROR[place] });
    }
  })
  .transform((value): AccountInput => {
    const designation =
      value.officeType === "ADMINISTRATOR" ? null : designationOf(value.officeType, value.designation);
    // Only the office type's own place is kept; a DS account's district only narrows the list of offices.
    const place = placeOf(value.officeType);
    const kept = (field: (typeof PLACE_FIELD)[keyof typeof PLACE_FIELD]) =>
      place && PLACE_FIELD[place] === field ? value[field] : null;
    return {
      name: value.name,
      mobile: value.mobile,
      contactEmail: value.contactEmail,
      designation,
      role: roleOf(designation),
      dsOfficeId: kept("dsOfficeId"),
      districtId: kept("districtId"),
      provinceId: kept("provinceId"),
    };
  });

export type AccountField =
  keyof typeof optionalPersonFields | "officeType" | "designation" | "dsOfficeId" | "districtId" | "provinceId";
export type AccountErrors = Partial<Record<AccountField, AccountErrorKey>>;

const FIELDS: AccountField[] = [
  "name",
  "mobile",
  "contactEmail",
  "officeType",
  "designation",
  "dsOfficeId",
  "districtId",
  "provinceId",
];

const PLACE_ERRORS: Partial<Record<AccountField, AccountErrorKey>> = {
  dsOfficeId: "office",
  districtId: "district",
  provinceId: "province",
};

/** Reads the account form. Missing fields count as empty. */
export function parseAccountForm(
  read: (field: AccountField) => string,
): { ok: true; value: AccountInput } | { ok: false; errors: AccountErrors } {
  const raw = Object.fromEntries(FIELDS.map((field) => [field, read(field)]));
  const result = accountSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };

  const errors: AccountErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as AccountField;
    // A place that isn't a number at all gets the same message as one left empty.
    errors[field] ??= PLACE_ERRORS[field] ?? (issue.message as AccountErrorKey);
  }
  return { ok: false, errors };
}

/**
 * The profile page, where signed-in users change their own details. The role, designation and place
 * stay with the admin (ADM-4), so they aren't on it.
 */
export const profileSchema = z.object(personFields);

export type ProfileInput = z.output<typeof profileSchema>;
export type ProfileField = keyof z.input<typeof profileSchema>;
export type ProfileErrors = Partial<Record<ProfileField, AccountErrorKey>>;

const PROFILE_FIELDS: ProfileField[] = ["name", "mobile", "contactEmail"];

/** Reads the profile form. Missing fields count as empty. */
export function parseProfileForm(
  read: (field: ProfileField) => string,
): { ok: true; value: ProfileInput } | { ok: false; errors: ProfileErrors } {
  const raw = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, read(field)]));
  const result = profileSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };

  const errors: ProfileErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as ProfileField;
    errors[field] ??= issue.message as AccountErrorKey;
  }
  return { ok: false, errors };
}
