import { describe, expect, it } from "vitest";
import {
  dayProblem,
  parseAmount,
  NOTE_ONLY,
  paidLimits,
  parsePaidForm,
  parseStageForm,
  parseStartForm,
  type StageField,
  stageLimits,
  type StartField,
  startLimits,
} from "./progress";

const RELEASED = "2026-06-20";
const TODAY = "2026-09-28";

describe("dayProblem", () => {
  const limits = paidLimits(TODAY, RELEASED, "2026-07-02");

  it("needs a real day", () => {
    expect(dayProblem("", limits)).toBe("dateRequired");
    expect(dayProblem("2026-02-30", limits)).toBe("dateInvalid");
    expect(dayProblem("28/09/2026", limits)).toBe("dateInvalid");
  });

  it("checks the latest day, then each earliest day in order", () => {
    expect(dayProblem("2026-09-29", limits)).toBe("dateInFuture");
    expect(dayProblem("2026-06-19", limits)).toBe("dateBeforeRelease");
    expect(dayProblem("2026-07-01", limits)).toBe("dateBeforePrevious");
    expect(dayProblem(" 2026-07-02 ", limits)).toBeNull();
    expect(dayProblem(TODAY, limits)).toBeNull();
  });
});

describe("starting a payment (INS-3)", () => {
  const read = (values: Partial<Record<StartField, string>>) => (field: StartField) => values[field] ?? "";

  it("needs an expected day on or after the release, which may be in the future", () => {
    expect(parseStartForm(read({}), startLimits(RELEASED))).toEqual({
      ok: false,
      errors: { expectedOn: "dateRequired" },
    });
    expect(parseStartForm(read({ expectedOn: "2026-06-19" }), startLimits(RELEASED))).toEqual({
      ok: false,
      errors: { expectedOn: "dateBeforeRelease" },
    });
    expect(
      parseStartForm(read({ expectedOn: "2027-01-15", purpose: " අත්තිවාරම සඳහා " }), startLimits(RELEASED)),
    ).toEqual({
      ok: true,
      value: { amount: null, expectedOn: "2027-01-15", purpose: "අත්තිවාරම සඳහා", note: null },
    });
  });

  it("keeps the purpose to 200 characters and the note to 500", () => {
    const result = parseStartForm(
      read({ expectedOn: TODAY, purpose: "x".repeat(201), note: "x".repeat(501) }),
      startLimits(RELEASED),
    );
    expect(result).toEqual({ ok: false, errors: { purpose: "purposeTooLong", note: "noteTooLong" } });
  });
});

describe("a land case's installment amount (INS-7, INS-8)", () => {
  const read = (values: Partial<Record<StartField, string>>) => (field: StartField) => values[field] ?? "";

  it("takes whole rupees from Rs. 1 to the balance, with or without commas", () => {
    const limit = { max: 1_100_000, fixed: false };
    expect(parseAmount("", limit)).toEqual({ ok: false, error: "amountRequired" });
    expect(parseAmount("0", limit)).toEqual({ ok: false, error: "amountInvalid" });
    expect(parseAmount("-5", limit)).toEqual({ ok: false, error: "amountInvalid" });
    expect(parseAmount("450000.50", limit)).toEqual({ ok: false, error: "amountInvalid" });
    expect(parseAmount("1,200,000", limit)).toEqual({ ok: false, error: "amountOverBalance" });
    expect(parseAmount(" 450,000 ", limit)).toEqual({ ok: true, value: 450_000 });
    expect(parseAmount("1100000", limit)).toEqual({ ok: true, value: 1_100_000 });
  });

  it("makes installment 4 the whole balance", () => {
    const limit = { max: 300_000, fixed: true };
    expect(parseAmount("200000", limit)).toEqual({ ok: false, error: "amountNotBalance" });
    expect(parseAmount("300,000", limit)).toEqual({ ok: true, value: 300_000 });
  });

  it("is asked only for a land case, beside the day", () => {
    const limits = startLimits(RELEASED);
    expect(parseStartForm(read({ amount: "x" }), limits)).toEqual({
      ok: false,
      errors: { expectedOn: "dateRequired" },
    });
    expect(parseStartForm(read({}), limits, { max: 2_000_000, fixed: false })).toEqual({
      ok: false,
      errors: { amount: "amountRequired", expectedOn: "dateRequired" },
    });
    expect(
      parseStartForm(read({ amount: "900,000", expectedOn: TODAY, purpose: "ඉඩම මිලදී ගැනීම" }), limits, {
        max: 2_000_000,
        fixed: false,
      }),
    ).toEqual({ ok: true, value: { amount: 900_000, expectedOn: TODAY, purpose: "ඉඩම මිලදී ගැනීම", note: null } });
  });
});

describe("marking paid (INS-4)", () => {
  it("needs the day paid, within its limits", () => {
    const limits = paidLimits(TODAY, RELEASED, null);
    expect(parsePaidForm(() => "", limits)).toEqual({ ok: false, errors: { releasedOn: "dateRequired" } });
    expect(parsePaidForm((f) => (f === "releasedOn" ? "2026-07-02" : " "), limits)).toEqual({
      ok: true,
      value: { releasedOn: "2026-07-02", note: null },
    });
  });
});

describe("a stage update (STG-1)", () => {
  const read = (values: Partial<Record<StageField, string>>) => (field: StageField) => values[field] ?? "";
  const limits = stageLimits(TODAY, RELEASED, "2026-09-05");

  it("needs a stage or the note-only choice", () => {
    expect(parseStageForm(read({ visitedOn: TODAY }), limits)).toEqual({
      ok: false,
      errors: { stageId: "stageRequired" },
    });
    expect(parseStageForm(read({ stageId: "7", visitedOn: TODAY, note: " බිත්ති බැඳ ඇත " }), limits)).toEqual({
      ok: true,
      value: { stageId: 7, visitedOn: TODAY, note: "බිත්ති බැඳ ඇත" },
    });
    expect(parseStageForm(read({ stageId: NOTE_ONLY, visitedOn: TODAY }), limits)).toEqual({
      ok: true,
      value: { stageId: null, visitedOn: TODAY, note: null },
    });
  });

  it("keeps a stage reached on or after the current stage's day; a note-only visit needs only the release", () => {
    expect(parseStageForm(read({ stageId: "7", visitedOn: "2026-09-01" }), limits)).toEqual({
      ok: false,
      errors: { visitedOn: "dateBeforeStage" },
    });
    expect(parseStageForm(read({ stageId: NOTE_ONLY, visitedOn: "2026-09-01" }), limits).ok).toBe(true);
    expect(parseStageForm(read({ stageId: NOTE_ONLY, visitedOn: "2026-06-01" }), limits)).toEqual({
      ok: false,
      errors: { visitedOn: "dateBeforeRelease" },
    });
  });

  it("keeps the note to 1,000 characters and refuses a future day", () => {
    expect(parseStageForm(read({ stageId: "7", visitedOn: "2026-09-29", note: "x".repeat(1001) }), limits)).toEqual({
      ok: false,
      errors: { visitedOn: "dateInFuture", note: "noteTooLong" },
    });
  });
});
