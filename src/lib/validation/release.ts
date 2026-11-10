import { z } from "zod";
import { parseDay } from "@/lib/dates";

/** Error messages are keys under "review.errors" in messages/si.json. */
export type ReleaseErrorKey =
  | "numberRequired"
  | "numberTooLong"
  | "dateRequired"
  | "dateInvalid"
  | "dateInFuture"
  | "dateBeforeEntered"
  | "dateAfterInstallment"
  | "dateAfterDsRelease"
  | "untilRequired"
  | "untilInvalid"
  | "untilBeforeDate"
  | "noteTooLong";

/** The allocation letter's own fields (REL-2). Its cases and scan are chosen beside them. */
export const RELEASE_FIELDS = ["letterNumber", "letterDate", "validUntil", "note"] as const;
export type ReleaseField = (typeof RELEASE_FIELDS)[number];
export type ReleaseErrors = Partial<Record<ReleaseField, ReleaseErrorKey>>;

export type ReleaseValues = {
  letterNumber: string;
  /** A calendar day, "YYYY-MM-DD". */
  letterDate: string;
  /** A calendar day, "YYYY-MM-DD": the letter's "valid only until" day. */
  validUntil: string;
  note: string | null;
};

/**
 * The days a letter's date must fall between (REL-2): from the latest day one of its cases was entered to
 * today, in Colombo. With no case there is no earliest day.
 */
export type ReleaseDateLimits = { earliest: string | null; today: string };

/** A new letter is valid until the end of the year, as the Ministry's letters are, unless it says otherwise. */
export const defaultValidUntil = (today: string) => `${today.slice(0, 4)}-12-31`;

const day = (required: ReleaseErrorKey, invalid: ReleaseErrorKey) =>
  z
    .string()
    .trim()
    .min(1, { error: required })
    .refine((value) => parseDay(value) !== null, { error: invalid, abort: true });

const schema = ({ earliest, today }: ReleaseDateLimits) =>
  z
    .object({
      letterNumber: z.string().trim().min(1, { error: "numberRequired" }).max(50, { error: "numberTooLong" }),
      letterDate: day("dateRequired", "dateInvalid")
        .refine((value) => value <= today, { error: "dateInFuture" })
        .refine((value) => earliest === null || value >= earliest, { error: "dateBeforeEntered" }),
      validUntil: day("untilRequired", "untilInvalid"),
      note: z
        .string()
        .trim()
        .max(500, { error: "noteTooLong" })
        .transform((value) => value || null),
    })
    .superRefine((value, context) => {
      if (value.validUntil < value.letterDate) {
        context.addIssue({ code: "custom", path: ["validUntil"], message: "untilBeforeDate" });
      }
    });

/**
 * REL-2: the allocation letter's number, date, last valid day and note, checked the same way in the
 * browser and on the server. The amount is not on the form; it is Rs. 2,000,000 for each case ticked.
 */
export function parseReleaseForm(
  read: (field: ReleaseField) => string,
  limits: ReleaseDateLimits,
): { ok: true; value: ReleaseValues } | { ok: false; errors: ReleaseErrors } {
  const raw = Object.fromEntries(RELEASE_FIELDS.map((field) => [field, read(field)]));
  const result = schema(limits).safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const errors: ReleaseErrors = {};
  for (const issue of result.error.issues) errors[issue.path[0] as ReleaseField] ??= issue.message as ReleaseErrorKey;
  return { ok: false, errors };
}

/** The latest of the cases' verification days: a letter can't be dated before any of them (REL-2). */
export function latestDay(days: readonly (string | null)[]): string | null {
  return days.reduce<string | null>((latest, value) => (value && (!latest || value > latest) ? value : latest), null);
}
