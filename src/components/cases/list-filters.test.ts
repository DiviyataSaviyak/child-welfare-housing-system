import { describe, expect, it } from "vitest";
import { KINDS } from "@/lib/validation/case";
import { NOT_ALLOCATED, readFilters, STATUSES } from "./list-filters";

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
