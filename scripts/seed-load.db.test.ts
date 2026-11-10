import { afterAll, describe, expect, it } from "vitest";
import { addDays, colomboDay, colomboYear, dateToDay } from "@/lib/dates";
import { INSTALLMENT_AMOUNT, RELEASE_AMOUNT } from "@/lib/money";
import { isComplete } from "@/server/cases/complete";
import { applicationKey } from "@/server/cases/numbers";
import { nextInstallment } from "@/server/installments/rules";
import { seed } from "../prisma/seed-data";
import { createTestClient } from "../tests/db/client";
import { addLoadData, LOAD_ID_PREFIX, LOAD_USER_ID, loadDataAllowed, removeLoadData } from "./seed-load";

const db = createTestClient();

afterAll(() => db.$disconnect());

const COUNT = 600;
const loadCases = { id: { startsWith: LOAD_ID_PREFIX } };

// Adding or removing hundreds of cases takes seconds, more on a CI runner than vitest's default 5. A test
// that times out keeps running underneath the next one, which then fails too.
describe("load-test data (PRF-1)", { timeout: 120_000 }, () => {
  it("is never made in production", () => {
    expect(loadDataAllowed("production")).toBe(false);
    expect(loadDataAllowed("staging")).toBe(true);
    expect(loadDataAllowed("development")).toBe(true);
    expect(loadDataAllowed("ci")).toBe(true);
  });

  it("adds made-up cases in every active office, each one following the rules of a case's life", async () => {
    await seed(db);
    const now = new Date();
    const today = colomboDay(now);

    const { offices } = await addLoadData(db, { count: COUNT, seed: 42, now });

    const active = await db.dsOffice.findMany({ where: { active: true }, select: { id: true } });
    expect(offices).toBe(active.length);
    const stages = await db.stageDefinition.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, kind: true },
    });
    const cases = await db.case.findMany({
      where: loadCases,
      include: {
        dsOffice: { select: { code: true } },
        decisions: true,
        release: { include: { dsRelease: true } },
        installments: { orderBy: { number: "asc" } },
        stageUpdates: { include: { stage: { select: { sortOrder: true } } } },
      },
    });
    expect(cases).toHaveLength(COUNT);
    expect(new Set(cases.map((c) => c.dsOfficeId))).toEqual(new Set(active.map((o) => o.id)));
    // Until change 0006's task 10, version 1's letter stands for the District's release too, so no case
    // waits at the district.
    expect([...new Set(cases.map((c) => c.status))].sort()).toEqual(
      (["AWAITING_ALLOCATION", "ALLOCATION_RECEIVED", "IN_PROGRESS", "COMPLETED"] as const).toSorted(),
    );
    // CASE-12: each number once within its office.
    expect(new Set(cases.map((c) => `${c.dsOfficeId}:${c.applicationKey}`)).size).toBe(COUNT);

    for (const c of cases) {
      expect(c.createdById).toBe(LOAD_USER_ID);
      expect(c.createdAt.getTime()).toBeLessThanOrEqual(c.updatedAt.getTime());
      expect(c.updatedAt.getTime()).toBeLessThanOrEqual(now.getTime());

      // CASE-12: an Application Number in version 1's form, of the year it was entered.
      expect(c.applicationNumber).toMatch(new RegExp(`^${c.dsOffice.code}-${colomboYear(c.createdAt)}-\\d{3,}$`));
      expect(c.applicationKey).toBe(applicationKey(c.applicationNumber));
      expect(c.nicKey).not.toBeNull();
      expect(c.childName === null).toBe(c.category !== "CHILD_AT_RISK");
      // CASE-13: built in the DS of residence.
      expect(c.buildDsOfficeId).toBe(c.dsOfficeId);
      // Nobody checks, sends back, rejects or stops a case any more (change 0006).
      expect(c.decisions).toHaveLength(0);

      if (c.status === "AWAITING_ALLOCATION") {
        expect(c.release).toBeNull();
        expect(c.installments).toHaveLength(0);
        expect(c.stageUpdates).toHaveLength(0);
        continue;
      }

      // REL-2: Rs. 2,000,000, on or after the day it was entered and never in the future, with the
      // District's release to its DS on the letter's day.
      const release = c.release!;
      const releasedOn = dateToDay(release.releasedOn);
      expect(release.amount).toBe(RELEASE_AMOUNT);
      expect(releasedOn >= colomboDay(c.createdAt)).toBe(true);
      expect(releasedOn <= today).toBe(true);
      expect(release.dsReleasedOn && dateToDay(release.dsReleasedOn)).toBe(releasedOn);
      expect(release.dsRelease?.dsOfficeId).toBe(c.buildDsOfficeId);

      // INS-5: in progress once installment 1 is paid; until then, its allocation received and no stage.
      expect(c.installments[0].status === "RELEASED").toBe(c.status !== "ALLOCATION_RECEIVED");
      if (c.status === "ALLOCATION_RECEIVED") expect(c.stageUpdates).toHaveLength(0);

      // INS-1 to INS-4: four of Rs. 500,000; only the next one is being paid, each paid after the one before.
      expect(c.installments.map((i) => [i.number, i.amount])).toEqual([1, 2, 3, 4].map((n) => [n, INSTALLMENT_AMOUNT]));
      const next = nextInstallment(c.installments.map((i) => ({ ...i, releasedOn: null })));
      let previousPaidOn = releasedOn;
      for (const i of c.installments) {
        if (i.status === "RELEASED") {
          expect(next === null || i.number < next.number).toBe(true);
          const paidOn = dateToDay(i.releasedOn!);
          expect(paidOn >= previousPaidOn && paidOn <= today).toBe(true);
          previousPaidOn = paidOn;
        } else if (i.status === "PROCESSING") {
          expect(i.number).toBe(next?.number);
          expect(dateToDay(i.expectedOn!) >= releasedOn).toBe(true);
        }
      }

      // STG-1: stages of the case's kind, in order, dated from the release to today.
      const kindStages = stages.filter((s) => s.kind === c.kind).map((s) => s.id);
      const reached = c.stageUpdates
        .filter((u) => u.stageId !== null)
        .sort((a, b) => a.stage!.sortOrder - b.stage!.sortOrder);
      expect(reached.map((u) => u.stageId)).toEqual(kindStages.slice(0, reached.length));
      for (const [index, u] of reached.entries())
        if (index > 0) expect(u.visitedOn.getTime()).toBeGreaterThanOrEqual(reached[index - 1].visitedOn.getTime());
      for (const u of c.stageUpdates) {
        expect(dateToDay(u.visitedOn) >= releasedOn && dateToDay(u.visitedOn) <= today).toBe(true);
        if (u.stageId === null) expect(u.note).not.toBeNull();
      }

      // CLS-1: completed exactly when installment 4 is paid and the last active stage is reached.
      const done = isComplete({
        lastInstallmentPaid: c.installments[3].status === "RELEASED",
        lastActiveStageId: kindStages.at(-1) ?? null,
        reachedStageIds: reached.map((u) => u.stageId!),
      });
      expect(done).toBe(c.status === "COMPLETED");
      expect(c.completedAt !== null).toBe(c.status === "COMPLETED");
    }

    // Some cases being built have had no update for 30 days or more (DSH-1, HOME-3), most have.
    const building = cases.filter((c) => c.status === "IN_PROGRESS");
    const staleSince = addDays(today, -30);
    const stale = building.filter((c) => colomboDay(c.updatedAt) <= staleSince).length;
    expect(stale).toBeGreaterThan(0);
    expect(stale).toBeLessThan(building.length / 2);

    // The account behind them is disabled and has no username, so nobody signs in with it.
    expect(await db.user.findUniqueOrThrow({ where: { id: LOAD_USER_ID } })).toMatchObject({
      banned: true,
      username: null,
    });
  });

  it("gives the same cases for the same seed, numbered after the ones already there", async () => {
    const pick = { name: true, nic: true, status: true, applicationKey: true, dsOfficeId: true } as const;
    const first = await db.case.findMany({ where: loadCases, select: pick });
    await addLoadData(db, { count: COUNT, seed: 42 });
    const all = await db.case.findMany({ where: loadCases, select: pick });
    const key = (c: (typeof all)[number]) => `${c.name}|${c.nic}|${c.status}`;
    expect(all).toHaveLength(COUNT * 2);
    expect(new Set(all.map(key))).toEqual(new Set(first.map(key)));
    expect(new Set(all.map((c) => `${c.dsOfficeId}:${c.applicationKey}`)).size).toBe(COUNT * 2);
  });

  it("removes them again, with their account, letters and District releases", async () => {
    expect(await removeLoadData(db)).toBe(COUNT * 2);

    expect(await db.case.count({ where: loadCases })).toBe(0);
    const loadCase = { caseId: { startsWith: LOAD_ID_PREFIX } };
    expect(await db.release.count({ where: loadCase })).toBe(0);
    expect(await db.installment.count({ where: loadCase })).toBe(0);
    expect(await db.stageUpdate.count({ where: loadCase })).toBe(0);
    expect(await db.releaseLetter.count({ where: { id: { startsWith: LOAD_ID_PREFIX } } })).toBe(0);
    expect(await db.dsRelease.count({ where: { id: { startsWith: LOAD_ID_PREFIX } } })).toBe(0);
    expect(await db.user.findUnique({ where: { id: LOAD_USER_ID } })).toBeNull();

    // Nothing left to remove.
    expect(await removeLoadData(db)).toBe(0);
  });
});
