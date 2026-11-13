import { z } from "zod";
import { parseDay } from "@/lib/dates";

/**
 * The installment and building-progress forms (INS-3, INS-4, STG-1), checked the same way in the
 * browser and on the server. Error messages are keys under "progress.errors" in messages/si.json.
 */

export type DayError =
  "dateRequired" | "dateInvalid" | "dateInFuture" | "dateBeforeRelease" | "dateBeforePrevious" | "dateBeforeStage";

export type AmountError = "amountRequired" | "amountInvalid" | "amountOverBalance" | "amountNotBalance";

export type ProgressErrorKey =
  DayError | AmountError | "purposeTooLong" | "noteTooLong" | "stageRequired" | "stageNotLater";

/** A day must be no later than `latest` (when there is one), and on or after each earliest day, checked in order. */
export type DayLimits = {
  latest: string | null;
  earliest: { day: string | null; error: DayError }[];
};

/** Why a typed day breaks its limits, or null when it is a real day within them. */
export function dayProblem(text: string, limits: DayLimits): DayError | null {
  const value = text.trim();
  if (!value) return "dateRequired";
  const day = parseDay(value);
  if (!day) return "dateInvalid";
  if (limits.latest && day > limits.latest) return "dateInFuture";
  for (const { day: earliest, error } of limits.earliest) if (earliest && day < earliest) return error;
  return null;
}

const optionalText = (max: number, error: ProgressErrorKey) =>
  z
    .string()
    .trim()
    .max(max, { error })
    .transform((value) => value || null);

const PURPOSE_MAX = 200;
const INSTALLMENT_NOTE_MAX = 500;
const STAGE_NOTE_MAX = 1000;

type Parsed<F extends string, V> = { ok: true; value: V } | { ok: false; errors: Partial<Record<F, ProgressErrorKey>> };

/** Runs the text checks and the date check, and gives at most one error per field. */
function parse<F extends string, V>(
  fields: readonly F[],
  read: (field: F) => string,
  texts: z.ZodType,
  dateField: F,
  dateError: DayError | null,
): Parsed<F, V> {
  const raw = Object.fromEntries(fields.map((field) => [field, read(field)]));
  const result = texts.safeParse(raw);
  const errors: Partial<Record<F, ProgressErrorKey>> = {};
  if (dateError) errors[dateField] = dateError;
  if (!result.success) {
    for (const issue of result.error.issues) errors[issue.path[0] as F] ??= issue.message as ProgressErrorKey;
  }
  if (Object.keys(errors).length > 0 || !result.success) return { ok: false, errors };
  return { ok: true, value: { ...(result.data as object), [dateField]: (raw[dateField] ?? "").trim() } as V };
}

// --- An installment's amount, for a land kind (INS-7, INS-8) --------------------------------------

/** The most a land case's installment may be (the balance), and whether it must be exactly that (installment 4). */
export type AmountLimit = { max: number; fixed: boolean };

/**
 * INS-7: a whole number of rupees, at least Rs. 1 and no more than the balance; installment 4 is the whole
 * balance. Spaces and the thousands' commas are allowed, as in "850,000".
 */
export function parseAmount(
  text: string,
  limit: AmountLimit,
): { ok: true; value: number } | { ok: false; error: AmountError } {
  const value = text.replace(/[\s,]/g, "");
  if (!value) return { ok: false, error: "amountRequired" };
  if (!/^\d{1,9}$/.test(value) || Number(value) < 1) return { ok: false, error: "amountInvalid" };
  const amount = Number(value);
  if (amount > limit.max) return { ok: false, error: "amountOverBalance" };
  if (limit.fixed && amount !== limit.max) return { ok: false, error: "amountNotBalance" };
  return { ok: true, value: amount };
}

// --- Starting an installment's payment (INS-3), or correcting a land case's (INS-8) ------------

export const START_FIELDS = ["amount", "expectedOn", "purpose", "note"] as const;
export type StartField = (typeof START_FIELDS)[number];
/** `amount` is null for a house kind, whose installments are always Rs. 500,000 (INS-1). */
export type StartValues = { amount: number | null; expectedOn: string; purpose: string | null; note: string | null };

/** INS-3: the expected date is on or after the District's release of the Rs. 2,000,000 to the DS (change 0006); it may be in the future. */
export function startLimits(releasedOn: string): DayLimits {
  return { latest: null, earliest: [{ day: releasedOn, error: "dateBeforeRelease" }] };
}

/** `amount` is the land case's limit (INS-7); null for a house kind, whose form sends no amount. */
export function parseStartForm(
  read: (field: StartField) => string,
  limits: DayLimits,
  amount: AmountLimit | null = null,
): Parsed<StartField, StartValues> {
  const texts = z.object({
    purpose: optionalText(PURPOSE_MAX, "purposeTooLong"),
    note: optionalText(INSTALLMENT_NOTE_MAX, "noteTooLong"),
  });
  const fields = START_FIELDS.filter((field) => field !== "amount");
  const parsed = parse<StartField, Omit<StartValues, "amount">>(
    fields,
    read,
    texts,
    "expectedOn",
    dayProblem(read("expectedOn"), limits),
  );
  const checked = amount ? parseAmount(read("amount"), amount) : null;
  if (checked && !checked.ok) {
    return { ok: false, errors: { amount: checked.error, ...(parsed.ok ? {} : parsed.errors) } };
  }
  if (!parsed.ok) return parsed;
  return { ok: true, value: { amount: checked?.value ?? null, ...parsed.value } };
}

// --- Marking an installment paid (INS-4) ------------------------------------------------------

export const PAID_FIELDS = ["releasedOn", "note"] as const;
export type PaidField = (typeof PAID_FIELDS)[number];
export type PaidValues = { releasedOn: string; note: string | null };

/**
 * INS-4: the day paid is no later than today, on or after the District's release of the Rs. 2,000,000 to the DS (change 0006), and on or after
 * the previous installment's day paid.
 */
export function paidLimits(today: string, releasedOn: string, previousPaidOn: string | null): DayLimits {
  return {
    latest: today,
    earliest: [
      { day: releasedOn, error: "dateBeforeRelease" },
      { day: previousPaidOn, error: "dateBeforePrevious" },
    ],
  };
}

export function parsePaidForm(read: (field: PaidField) => string, limits: DayLimits): Parsed<PaidField, PaidValues> {
  const texts = z.object({ note: optionalText(INSTALLMENT_NOTE_MAX, "noteTooLong") });
  return parse(PAID_FIELDS, read, texts, "releasedOn", dayProblem(read("releasedOn"), limits));
}

// --- A stage update (STG-1) -------------------------------------------------------------------

/** The form's value for "no change, note only". */
export const NOTE_ONLY = "none";

export const STAGE_FIELDS = ["stageId", "visitedOn", "note"] as const;
export type StageField = (typeof STAGE_FIELDS)[number];
/** `stageId` is null for a note-only visit. */
export type StageValues = { stageId: number | null; visitedOn: string; note: string | null };

/**
 * STG-1: the day is no later than today and on or after the District's release of the Rs. 2,000,000 to the DS (change 0006). A stage reached
 * can't come before the day the current stage was reached, so the stages keep their order.
 */
export function stageLimits(today: string, releasedOn: string, currentStageOn: string | null): DayLimits {
  return {
    latest: today,
    earliest: [
      { day: releasedOn, error: "dateBeforeRelease" },
      { day: currentStageOn, error: "dateBeforeStage" },
    ],
  };
}

/** `limits` comes from stageLimits(); the current stage's day applies only when a stage is chosen. */
export function parseStageForm(
  read: (field: StageField) => string,
  limits: DayLimits,
): Parsed<StageField, StageValues> {
  const choice = read("stageId").trim();
  const noteOnly = choice === NOTE_ONLY;
  const stageId = /^\d{1,9}$/.test(choice) ? Number(choice) : null;
  const dayLimits = noteOnly
    ? { ...limits, earliest: limits.earliest.filter((e) => e.error !== "dateBeforeStage") }
    : limits;
  const texts = z.object({ note: optionalText(STAGE_NOTE_MAX, "noteTooLong") });
  const parsed = parse<StageField, Omit<StageValues, "stageId">>(
    STAGE_FIELDS,
    read,
    texts,
    "visitedOn",
    dayProblem(read("visitedOn"), dayLimits),
  );
  if (!noteOnly && stageId === null) {
    return { ok: false, errors: { ...(parsed.ok ? {} : parsed.errors), stageId: "stageRequired" } };
  }
  if (!parsed.ok) return parsed;
  return { ok: true, value: { ...parsed.value, stageId } };
}
