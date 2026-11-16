import { describe, expect, it } from "vitest";
import { KINDS } from "@/lib/validation/case";
import { filterQuery, NOT_ALLOCATED, PERIODS, periodDays, readFilters, readPeriod, STATUSES } from "./list-filters";

const fromAddress = (query: string) => {
  const params = new URLSearchParams(query);
  return readFilters((key) => params.get(key) ?? "").filter;
};

describe("the case list's kind filter (FND-1)", () => {
  it("takes each of the five kinds, the land kinds of change 0007 among them", () => {
    expect(KINDS).toEqual(["NEW_HOUSE", "RENOVATION", "LAND_ONLY", "LAND_AND_BUILD", "LAND_WITH_HOUSE"]);
    for (const kind of KINDS) expect(fromAddress(`kind=${kind}`).kind, kind).toBe(kind);
  });

  it("ignores a kind that isn't one", () => {
    expect(fromAddress("kind=LAND").kind).toBeUndefined();
    expect(fromAddress("").kind).toBeUndefined();
  });
});

describe("the case list's status filter (FND-1)", () => {
  it("takes each of the six statuses, replaced last", () => {
    expect(STATUSES).toEqual([
      "AWAITING_ALLOCATION",
      "ALLOCATED_TO_DISTRICT",
      "ALLOCATION_RECEIVED",
      "IN_PROGRESS",
      "COMPLETED",
      "REPLACED",
    ]);
    for (const status of STATUSES) expect(fromAddress(`status=${status}`).statuses, status).toEqual([status]);
  });

  it("takes 'not yet allocated' as the first two statuses together", () => {
    expect(fromAddress(`status=${NOT_ALLOCATED}`).statuses).toEqual(["AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT"]);
  });

  it("ignores a status that isn't one", () => {
    for (const status of ["", "DRAFT", "not_allocated", "toString"]) {
      expect(fromAddress(`status=${status}`).statuses, status).toBeUndefined();
    }
  });
});

describe("the period filter (EXP-4)", () => {
  it("takes from and until, each alone or both, the same day too", () => {
    expect(fromAddress("from=2026-10-01&until=2026-10-31")).toMatchObject({
      enteredFrom: "2026-10-01",
      enteredUntil: "2026-10-31",
    });
    expect(readPeriod("2026-10-01", "")).toEqual({ enteredFrom: "2026-10-01" });
    expect(readPeriod("", "2026-10-31")).toEqual({ enteredUntil: "2026-10-31" });
    expect(readPeriod("2026-10-05", "2026-10-05")).toEqual({ enteredFrom: "2026-10-05", enteredUntil: "2026-10-05" });
    expect(readPeriod("", "")).toEqual({});
  });

  it("ignores a day that isn't one", () => {
    for (const day of ["2026-02-30", "2026-10-1", "01/10/2026", "yesterday", "2026-13-01"]) {
      expect(readPeriod(day, ""), day).toEqual({});
      expect(readPeriod("", day), day).toEqual({});
    }
    expect(readPeriod("2026-02-30", "2026-10-31")).toEqual({ enteredUntil: "2026-10-31" });
  });

  it("ignores both when 'until' is before 'from'", () => {
    expect(readPeriod("2026-10-31", "2026-10-01")).toEqual({});
  });

  it("keeps the period in the address with the other filters", () => {
    const { values } = readFilters((key) => ({ q: "ඒ", from: "2026-10-01", until: "2026-10-31" })[key] ?? "");
    expect(filterQuery(values).toString()).toBe("q=%E0%B6%92&from=2026-10-01&until=2026-10-31");
  });
});

describe("the period's shortcuts (EXP-4)", () => {
  it("has one month, two months and one year", () => {
    expect(Object.keys(PERIODS)).toEqual(["month", "twoMonths", "year"]);
  });

  it("ends each on today and covers its whole months once", () => {
    expect(periodDays("month", "2026-11-16")).toEqual({ from: "2026-10-17", until: "2026-11-16" });
    expect(periodDays("twoMonths", "2026-11-16")).toEqual({ from: "2026-09-17", until: "2026-11-16" });
    expect(periodDays("year", "2026-11-16")).toEqual({ from: "2025-11-17", until: "2026-11-16" });
    // The last day of a month: a month back is the whole of that month.
    expect(periodDays("month", "2026-10-31")).toEqual({ from: "2026-10-01", until: "2026-10-31" });
    expect(periodDays("month", "2026-03-31")).toEqual({ from: "2026-03-01", until: "2026-03-31" });
  });
});
