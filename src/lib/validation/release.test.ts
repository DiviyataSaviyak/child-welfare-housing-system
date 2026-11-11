import { describe, expect, it } from "vitest";
import { parseReason } from "./decision";
import { defaultValidUntil, latestDay, parseReleaseForm, type ReleaseField } from "./release";

const limits = { earliest: "2026-09-10", today: "2026-09-28" };
const form =
  (values: Partial<Record<ReleaseField, string>>) =>
  (field: ReleaseField): string =>
    values[field] ??
    { letterNumber: "MWCA/3/8/16/04-2026", letterDate: "2026-09-20", validUntil: "2026-12-31", note: "" }[field];

describe("the allocation letter form (REL-2)", () => {
  it("accepts a date from the latest verification to today, and trims the text", () => {
    expect(parseReleaseForm(form({ letterNumber: "  MWCA/1  " }), limits)).toEqual({
      ok: true,
      value: { letterNumber: "MWCA/1", letterDate: "2026-09-20", validUntil: "2026-12-31", note: null },
    });
    expect(parseReleaseForm(form({ letterDate: "2026-09-10" }), limits).ok).toBe(true);
    expect(parseReleaseForm(form({ letterDate: "2026-09-28" }), limits).ok).toBe(true);
    expect(parseReleaseForm(form({ letterDate: "2026-01-01" }), { earliest: null, today: "2026-09-28" }).ok).toBe(true);
  });

  it("refuses a missing, impossible, future or too early date", () => {
    const error = (letterDate: string) => {
      const result = parseReleaseForm(form({ letterDate }), limits);
      return result.ok ? null : result.errors.letterDate;
    };
    expect(error("")).toBe("dateRequired");
    expect(error("2026-02-30")).toBe("dateInvalid");
    expect(error("2026-09-29")).toBe("dateInFuture");
    expect(error("2026-09-09")).toBe("dateBeforeEntered");
  });

  it("needs a last valid day on or after the letter's date, which may be in the future", () => {
    const error = (validUntil: string) => {
      const result = parseReleaseForm(form({ validUntil }), limits);
      return result.ok ? null : result.errors.validUntil;
    };
    expect(error("")).toBe("untilRequired");
    expect(error("2026-13-01")).toBe("untilInvalid");
    expect(error("2026-09-19")).toBe("untilBeforeDate");
    expect(error("2026-09-20")).toBeNull();
    expect(error("2027-06-30")).toBeNull();
  });

  it("needs a letter number of at most 50 characters, and a note of at most 500", () => {
    expect(parseReleaseForm(form({ letterNumber: "   " }), limits)).toEqual({
      ok: false,
      errors: { letterNumber: "numberRequired" },
    });
    expect(parseReleaseForm(form({ letterNumber: "x".repeat(51), note: "x".repeat(501) }), limits)).toEqual({
      ok: false,
      errors: { letterNumber: "numberTooLong", note: "noteTooLong" },
    });
  });

  it("is valid until the end of the year by default, and can't be dated before any of its cases' verification", () => {
    expect(defaultValidUntil("2026-10-06")).toBe("2026-12-31");
    expect(latestDay(["2026-09-10", null, "2026-09-22", "2026-09-15"])).toBe("2026-09-22");
    expect(latestDay([null])).toBeNull();
    expect(latestDay([])).toBeNull();
  });
});

describe("a reason (CHK-3)", () => {
  it("needs 5 to 1,000 characters after trimming", () => {
    expect(parseReason("   ")).toEqual({ ok: false, error: "reasonRequired" });
    expect(parseReason(" නැත ")).toEqual({ ok: false, error: "reasonTooShort" });
    expect(parseReason("x".repeat(1001))).toEqual({ ok: false, error: "reasonTooLong" });
    expect(parseReason("  ලිපිනය සම්පූර්ණ නැත.  ")).toEqual({ ok: true, value: "ලිපිනය සම්පූර්ණ නැත." });
  });
});
