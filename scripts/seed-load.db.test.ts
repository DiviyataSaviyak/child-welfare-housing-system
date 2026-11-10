import { afterAll, describe, expect, it } from "vitest";
import type { CaseStatus } from "@/generated/prisma/enums";
import { addDays, colomboDay, colomboYear, dateToDay } from "@/lib/dates";
import { INSTALLMENT_AMOUNT, RELEASE_AMOUNT } from "@/lib/money";
import { isComplete } from "@/server/cases/complete";
import { nextInstallment } from "@/server/installments/rules";
import { seed } from "../prisma/seed-data";
import { createTestClient } from "../tests/db/client";
import { addLoadData, LOAD_ID_PREFIX, LOAD_USER_ID, loadDataAllowed, removeLoadData } from "./seed-load";

const db = createTestClient();

afterAll(() => db.$disconnect());

const COUNT = 600;
const loadCases = { id: { startsWith: LOAD_ID_PREFIX } };

async function counters() {
  const rows = await db.caseNumberCounter.findMany({ orderBy: [{ dsOfficeId: "asc" }, { year: "asc" }] });
  return rows.map((c) => `${c.dsOfficeId}:${c.year}:${c.last}`);
}

// Adding or removing hundreds of cases takes seconds, more on a CI runner than vitest's default 5. A test
// that times out keeps running underneath the next one, which then fails too.
describe("load-test data (PRF-1)", { timeout: 120_000 }, () => {
  let countersBefore: string[] = [];

  it("is never made in production", () => {
    expect(loadDataAllowed("production")).toBe(false);
    expect(loadDataAllowed("staging")).toBe(true);
    expect(loadDataAllowed("development")).toBe(true);
    expect(loadDataAllowed("ci")).toBe(true);
  });

  it("adds made-up cases in every active office, each one following the rules of a case's life", async () => {
    await seed(db);
    countersBefore = await counters();
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
        release: true,
        installments: { orderBy: { number: "asc" } },
        stageUpdates: { include: { stage: { select: { sortOrder: true } } } },
      },
    });
    expect(cases).toHaveLength(COUNT);
    expect(new Set(cases.map((c) => c.dsOfficeId))).toEqual(new Set(active.map((o) => o.id)));
    const statuses = new Set(cases.map((c) => c.status));
    expect([...statuses].sort()).toEqual(
      (
        ["DRAFT", "SUBMITTED", "RETURNED", "VERIFIED", "IN_PROGRESS", "COMPLETED", "REJECTED", "STOPPED"] as const
      ).toSorted(),
    );

    const decisionTypes = (c: (typeof cases)[number]) => c.decisions.map((d) => d.type).sort();
    for (const c of cases) {
      expect(c.createdById).toBe(LOAD_USER_ID);
      expect(c.createdAt.getTime()).toBeLessThanOrEqual(c.updatedAt.getTime());
      expect(c.updatedAt.getTime()).toBeLessThanOrEqual(now.getTime());

      // CASE-5: a number from the first submit on, in the office's code and the year of submitting.
      if (c.status === "DRAFT") {
        expect(c.applicationNumber).toBeNull();
        expect(c.decisions).toHaveLength(0);
      } else {
        expect(c.applicationNumber).toMatch(new RegExp(`^${c.dsOffice.code}-${colomboYear(c.submittedAt!)}-\\d{3,}$`));
        expect(c.category).not.toBeNull();
        expect(c.kind).not.toBeNull();
        expect(c.nicKey).not.toBeNull();
      }
      expect(c.childName === null).toBe(c.category !== "CHILD_AT_RISK");

      const path: CaseStatus = c.statusBeforeStop ?? c.status;
      if (c.status === "STOPPED") expect(["VERIFIED", "IN_PROGRESS"]).toContain(c.statusBeforeStop);
      else expect(c.statusBeforeStop).toBeNull();
      if (c.status === "RETURNED") expect(decisionTypes(c)).toEqual(["SEND_BACK", "SUBMIT"]);
      if (c.status === "REJECTED") expect(decisionTypes(c)).toEqual(["REJECT", "SUBMIT"]);
      for (const d of c.decisions)
        if (["SEND_BACK", "REJECT", "STOP"].includes(d.type)) expect(d.reason?.length).toBeGreaterThanOrEqual(5);

      if (path !== "IN_PROGRESS" && path !== "COMPLETED") {
        expect(c.release).toBeNull();
        expect(c.installments).toHaveLength(0);
        expect(c.stageUpdates).toHaveLength(0);
        continue;
      }

      // REL-2: Rs. 2,000,000, on or after the verification day and never in the future.
      const release = c.release!;
      const releasedOn = dateToDay(release.releasedOn);
      expect(release.amount).toBe(RELEASE_AMOUNT);
      expect(releasedOn >= colomboDay(c.verifiedAt!)).toBe(true);
      expect(releasedOn <= today).toBe(true);

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
      expect(done).toBe(path === "COMPLETED");
      expect(c.completedAt !== null).toBe(c.status === "COMPLETED");
    }

    // Some cases being built have had no update for 30 days or more (DSH-1, HOME-3), most have.
    const building = cases.filter((c) => c.status === "IN_PROGRESS");
    const staleSince = addDays(today, -30);
    const stale = building.filter((c) => colomboDay(c.updatedAt) <= staleSince).length;
    expect(stale).toBeGreaterThan(0);
    expect(stale).toBeLessThan(building.length / 2);

    // The counters are past every number the load-test cases took.
    for (const c of cases.filter((c) => c.applicationNumber)) {
      const [, year, sequence] = c.applicationNumber!.split("-");
      const counter = await db.caseNumberCounter.findUniqueOrThrow({
        where: { dsOfficeId_year: { dsOfficeId: c.dsOfficeId, year: Number(year) } },
      });
      expect(counter.last).toBeGreaterThanOrEqual(Number(sequence));
    }

    // The account behind them is disabled and has no username, so nobody signs in with it.
    expect(await db.user.findUniqueOrThrow({ where: { id: LOAD_USER_ID } })).toMatchObject({
      banned: true,
      username: null,
    });
  });

  it("gives the same cases for the same seed", async () => {
    const pick = { name: true, nic: true, status: true, applicationNumber: true } as const;
    const first = await db.case.findMany({ where: loadCases, select: pick });
    await addLoadData(db, { count: COUNT, seed: 42 });
    const all = await db.case.findMany({ where: loadCases, select: pick });
    const key = (c: (typeof all)[number]) => `${c.name}|${c.nic}|${c.status}`;
    expect(all).toHaveLength(COUNT * 2);
    expect(new Set(all.map(key))).toEqual(new Set(first.map(key)));
  });

  it("removes them again, with their account, and gives back the case numbers", async () => {
    expect(await removeLoadData(db)).toBe(COUNT * 2);

    expect(await db.case.count({ where: loadCases })).toBe(0);
    const loadCase = { caseId: { startsWith: LOAD_ID_PREFIX } };
    expect(await db.decision.count({ where: loadCase })).toBe(0);
    expect(await db.release.count({ where: loadCase })).toBe(0);
    expect(await db.installment.count({ where: loadCase })).toBe(0);
    expect(await db.stageUpdate.count({ where: loadCase })).toBe(0);
    expect(await db.user.findUnique({ where: { id: LOAD_USER_ID } })).toBeNull();
    expect(await counters()).toEqual(countersBefore);

    // Nothing left to remove.
    expect(await removeLoadData(db)).toBe(0);
  });
});
