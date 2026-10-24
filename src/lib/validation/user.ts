import { z } from "zod";
import { isValidPhone, normalisePhone } from "@/lib/phone";
import { ROLES } from "@/server/auth/roles";

/**
 * The account form (ADM-2, ADM-4), checked the same way in the browser and in the Server Action.
 * Error messages are keys under "users.form.errors" in messages/si.json.
 */
export type AccountErrorKey = "required" | "tooShort" | "tooLong" | "mobile" | "email" | "role" | "office";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: "tooLong" })
    .transform((value) => value || null);

/** The details an officer may change on their own profile page too. */
const personFields = {
  name: z.string().trim().min(1, { error: "required" }).min(2, { error: "tooShort" }).max(100, { error: "tooLong" }),
  designation: optionalText(100),
  mobile: z
    .string()
    .transform(normalisePhone)
    .pipe(z.string().min(1, { error: "required" }).refine(isValidPhone, { error: "mobile" })),
  contactEmail: z
    .string()
    .trim()
    .max(254, { error: "tooLong" })
    .refine((value) => value === "" || z.email().safeParse(value).success, { error: "email" })
    .transform((value) => value || null),
};

export const accountSchema = z
  .object({
    ...personFields,
    role: z.enum(ROLES, { error: "role" }),
    dsOfficeId: z
      .string()
      .transform((value) => (value === "" ? null : Number(value)))
      .refine((value) => value === null || (Number.isInteger(value) && value > 0), { error: "office" }),
  })
  .superRefine((value, context) => {
    if (value.role === "DS_OFFICER" && value.dsOfficeId === null) {
      context.addIssue({ code: "custom", path: ["dsOfficeId"], message: "office" });
    }
  })
  // Only DS officers belong to an office (application spec, Roles and permissions).
  .transform((value) => ({ ...value, dsOfficeId: value.role === "DS_OFFICER" ? value.dsOfficeId : null }));

export type AccountInput = z.output<typeof accountSchema>;
export type AccountField = keyof z.input<typeof accountSchema>;
export type AccountErrors = Partial<Record<AccountField, AccountErrorKey>>;

const FIELDS: AccountField[] = ["name", "designation", "mobile", "contactEmail", "role", "dsOfficeId"];

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
    errors[field] ??= issue.message as AccountErrorKey;
  }
  return { ok: false, errors };
}

/**
 * The profile page, where signed-in users change their own details. The role, district and DS office
 * stay with the admin (ADM-4), so they aren't on it.
 */
export const profileSchema = z.object(personFields);

export type ProfileInput = z.output<typeof profileSchema>;
export type ProfileField = keyof z.input<typeof profileSchema>;
export type ProfileErrors = Partial<Record<ProfileField, AccountErrorKey>>;

const PROFILE_FIELDS: ProfileField[] = ["name", "designation", "mobile", "contactEmail"];

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
