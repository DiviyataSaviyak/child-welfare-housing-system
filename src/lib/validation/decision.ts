import { z } from "zod";

/** Error messages are keys under "progress.errors" in messages/si.json. */
export type ReasonErrorKey = "reasonRequired" | "reasonTooShort" | "reasonTooLong";

/** The reason given for deleting a case (CASE-8) or undoing a payment (INS-6). */
const reasonSchema = z
  .string()
  .trim()
  .min(1, { error: "reasonRequired" })
  .min(5, { error: "reasonTooShort" })
  .max(1000, { error: "reasonTooLong" });

export function parseReason(raw: string): { ok: true; value: string } | { ok: false; error: ReasonErrorKey } {
  const result = reasonSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues[0]?.message as ReasonErrorKey };
}
