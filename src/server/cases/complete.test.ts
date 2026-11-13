import { describe, expect, it } from "vitest";
import type { InstallmentStatus, Kind } from "@/generated/prisma/enums";
import { isComplete, paidInFull } from "./complete";

type Row = { number: number; status: InstallmentStatus; amount: number };

const paid = (...amounts: number[]): Row[] =>
  amounts.map((amount, index) => ({ number: index + 1, status: "RELEASED", amount }));
const house = (released: number): Row[] =>
  [1, 2, 3, 4].map((number) => ({
    number,
    status: number <= released ? "RELEASED" : "NOT_STARTED",
    amount: 500_000,
  }));

const LAST = 9;
const done = (kind: Kind, installments: Row[], reached: number[] = [], lastActiveStageId: number | null = LAST) =>
  isComplete({ kind, installments, lastActiveStageId, reachedStageIds: reached });

describe("paidInFull (CLS-1, INS-1, INS-7)", () => {
  it("needs installment 4 paid for a house kind", () => {
    expect(paidInFull("NEW_HOUSE", house(3))).toBe(false);
    expect(paidInFull("RENOVATION", house(4))).toBe(true);
  });

  it("needs Rs. 2,000,000 paid for a land kind, in however many installments", () => {
    expect(paidInFull("LAND_ONLY", paid(1_500_000))).toBe(false);
    expect(paidInFull("LAND_ONLY", paid(1_500_000, 500_000))).toBe(true);
    expect(paidInFull("LAND_WITH_HOUSE", paid(2_000_000))).toBe(true);
    expect(paidInFull("LAND_AND_BUILD", paid(100_000, 100_000, 100_000, 1_700_000))).toBe(true);
  });

  it("counts only what is paid, not what is being paid", () => {
    const rows: Row[] = [
      { number: 1, status: "RELEASED", amount: 1_500_000 },
      { number: 2, status: "PROCESSING", amount: 500_000 },
    ];
    expect(paidInFull("LAND_ONLY", rows)).toBe(false);
  });
});

describe("isComplete (CLS-1, STG-4)", () => {
  it("needs the money and the last stage for a new house and for buying land and building", () => {
    expect(done("NEW_HOUSE", house(4))).toBe(false);
    expect(done("NEW_HOUSE", house(3), [LAST])).toBe(false);
    expect(done("NEW_HOUSE", house(4), [LAST])).toBe(true);
    expect(done("LAND_AND_BUILD", paid(2_000_000))).toBe(false);
    expect(done("LAND_AND_BUILD", paid(1_000_000), [LAST])).toBe(false);
    expect(done("LAND_AND_BUILD", paid(1_000_000, 1_000_000), [LAST])).toBe(true);
  });

  it("needs only the money for a kind with no active stages", () => {
    expect(done("RENOVATION", house(4), [], null)).toBe(true);
    expect(done("LAND_ONLY", paid(1_500_000, 500_000), [], null)).toBe(true);
    expect(done("LAND_WITH_HOUSE", paid(1_999_999), [], null)).toBe(false);
    expect(done("LAND_WITH_HOUSE", paid(1_999_999, 1), [], null)).toBe(true);
  });
});
