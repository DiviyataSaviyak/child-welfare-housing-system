import { describe, expect, it } from "vitest";
import type { InstallmentStatus } from "@/generated/prisma/enums";
import {
  landAmountLimit,
  landBalance,
  lastPaid,
  nextInstallment,
  previousPaidOn,
  schedule,
  stepRefusal,
  upcomingInstallment,
} from "./rules";

const list = (...statuses: InstallmentStatus[]) =>
  statuses.map((status, index) => ({
    number: index + 1,
    status,
    releasedOn: status === "RELEASED" ? `2026-07-0${index + 1}` : null,
  }));

describe("installment order (INS-2, AC-11)", () => {
  it("lets only the lowest unpaid installment change", () => {
    const four = list("RELEASED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED");
    expect(nextInstallment(four)?.number).toBe(2);
    expect(stepRefusal(four, 2, "start")).toBeNull();
    expect(stepRefusal(four, 3, "start")).toBe("notNext");
    expect(stepRefusal(four, 4, "pay")).toBe("notNext");
    expect(stepRefusal(four, 1, "pay")).toBe("alreadyPaid");
    expect(stepRefusal(four, 5, "start")).toBe("noSuchInstallment");
  });

  it("starts a payment before it can be marked paid, and only once", () => {
    expect(stepRefusal(list("NOT_STARTED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED"), 1, "pay")).toBe(
      "notStartedYet",
    );
    const started = list("PROCESSING", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED");
    expect(stepRefusal(started, 1, "start")).toBe("alreadyStarted");
    expect(stepRefusal(started, 1, "pay")).toBeNull();
    // Installment 3 can't change while installment 2 is not released, even when 2 is under way.
    const second = list("RELEASED", "PROCESSING", "NOT_STARTED", "NOT_STARTED");
    expect(stepRefusal(second, 3, "start")).toBe("notNext");
  });

  it("finds nothing next when all four are paid", () => {
    const paid = list("RELEASED", "RELEASED", "RELEASED", "RELEASED");
    expect(nextInstallment(paid)).toBeNull();
    expect(stepRefusal(paid, 4, "pay")).toBe("alreadyPaid");
  });

  it("gives the day the installment before was paid (INS-4)", () => {
    const two = list("RELEASED", "RELEASED", "PROCESSING", "NOT_STARTED");
    expect(previousPaidOn(two, 1)).toBeNull();
    expect(previousPaidOn(two, 3)).toBe("2026-07-02");
  });

  it("moves back only the most recently released installment (INS-6)", () => {
    expect(lastPaid(list("RELEASED", "RELEASED", "PROCESSING", "NOT_STARTED"))?.number).toBe(2);
    expect(lastPaid(list("NOT_STARTED", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED"))).toBeNull();
  });
});

describe("a land case's installments (INS-7)", () => {
  const rows = (...items: [InstallmentStatus, number][]) =>
    items.map(([status, amount], index) => ({ number: index + 1, status, amount, releasedOn: null }));

  it("has none until the DS starts one, then each with its own amount", () => {
    expect(schedule("LAND_AND_BUILD", [])).toEqual([
      { number: 1, status: "NOT_STARTED", releasedOn: null, amount: 2_000_000, upcoming: true },
    ]);
    expect(stepRefusal(schedule("LAND_ONLY", []), 1, "start")).toBeNull();
    expect(stepRefusal(schedule("LAND_ONLY", []), 1, "pay")).toBe("notStartedYet");
    const one = rows(["RELEASED", 900_000]);
    expect(landBalance(one)).toBe(1_100_000);
    expect(nextInstallment(schedule("LAND_ONLY", one))?.number).toBe(2);
    expect(upcomingInstallment("LAND_ONLY", one)?.amount).toBe(1_100_000);
  });

  it("waits for the one being paid before the next can start (INS-2)", () => {
    const paying = schedule("LAND_WITH_HOUSE", rows(["PROCESSING", 900_000]));
    expect(paying.map((i) => i.number)).toEqual([1, 2]);
    expect(stepRefusal(paying, 2, "start")).toBe("notNext");
    expect(stepRefusal(paying, 1, "pay")).toBeNull();
  });

  it("offers none once Rs. 2,000,000 is started, or four are", () => {
    expect(upcomingInstallment("LAND_ONLY", rows(["RELEASED", 1_500_000], ["PROCESSING", 500_000]))).toBeNull();
    const four = rows(["RELEASED", 1], ["RELEASED", 1], ["RELEASED", 1], ["RELEASED", 1]);
    expect(upcomingInstallment("LAND_ONLY", four)).toBeNull();
    expect(nextInstallment(schedule("LAND_ONLY", four))).toBeNull();
  });

  it("never adds one to a house kind, whose four are made at the release (REL-7)", () => {
    expect(schedule("NEW_HOUSE", [])).toEqual([]);
    expect(upcomingInstallment("RENOVATION", rows(["RELEASED", 500_000]))).toBeNull();
  });

  it("limits the amount to the balance, plus its own when corrected, and fixes installment 4", () => {
    const three = rows(["RELEASED", 900_000], ["RELEASED", 400_000], ["PROCESSING", 300_000]);
    expect(landAmountLimit(three, 4)).toEqual({ max: 400_000, fixed: true });
    expect(landAmountLimit(three, 3)).toEqual({ max: 700_000, fixed: false });
    expect(landAmountLimit([], 1)).toEqual({ max: 2_000_000, fixed: false });
  });
});
