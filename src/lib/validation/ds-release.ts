import { z } from "zod";
import { parseDay } from "@/lib/dates";

/** Error messages are keys under "review.errors" in messages/si.json. */
export type DsReleaseErrorKey =
  | "referenceRequired"
  | "referenceTooLong"
  | "releaseDateRequired"
  | "dateInvalid"
  | "releaseInFuture"
  | "releaseBeforeLetter"
  | "releaseAfterInstallment"
  | "releaseAfterStage"
  | "noteTooLong";

/** The District release's own fields (REL-6). Its cases and scan are chosen beside them. */
export const DS_RELEASE_FIELDS = ["referenceNumber", "releasedOn", "note"] as const;
export type DsReleaseField = (typeof DS_RELEASE_FIELDS)[number];
export type DsReleaseErrors = Partial<Record<DsReleaseField, DsReleaseErrorKey>>;

export type DsReleaseValues = {
  /** As on the District's letter or voucher. */
  referenceNumber: string;
  /** A calendar day, "YYYY-MM-DD". */
  releasedOn: string;
  note: string | null;
};

/**
 * The days a District release's date must fall between (REL-6): from the latest date of the Ministry's
 * letter of one of its cases to today, in Colombo. With no case there is no earliest day.
 */
export type DsReleaseDateLimits = { earliest: string | null; today: string };

const schema = ({ earliest, today }: DsReleaseDateLimits) =>
  z.object({
    referenceNumber: z.string().trim().min(1, { error: "referenceRequired" }).max(50, { error: "referenceTooLong" }),
    releasedOn: z
      .string()
      .trim()
      .min(1, { error: "releaseDateRequired" })
      .refine((value) => parseDay(value) !== null, { error: "dateInvalid", abort: true })
      .refine((value) => value <= today, { error: "releaseInFuture" })
      .refine((value) => earliest === null || value >= earliest, { error: "releaseBeforeLetter" }),
    note: z
      .string()
      .trim()
      .max(500, { error: "noteTooLong" })
      .transform((value) => value || null),
  });

/**
 * REL-6: the District release's reference number, date and note, checked the same way in the browser and
 * on the server. The amount is not on the form; it is Rs. 2,000,000 for each case ticked.
 */
export function parseDsReleaseForm(
  read: (field: DsReleaseField) => string,
  limits: DsReleaseDateLimits,
): { ok: true; value: DsReleaseValues } | { ok: false; errors: DsReleaseErrors } {
  const raw = Object.fromEntries(DS_RELEASE_FIELDS.map((field) => [field, read(field)]));
  const result = schema(limits).safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const errors: DsReleaseErrors = {};
  for (const issue of result.error.issues) {
    errors[issue.path[0] as DsReleaseField] ??= issue.message as DsReleaseErrorKey;
  }
  return { ok: false, errors };
}
