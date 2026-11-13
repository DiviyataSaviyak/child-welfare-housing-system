import { afterAll, describe, expect, it } from "vitest";
import { addDays, colomboDay, dateToDay } from "@/lib/dates";
import { INSTALLMENT_AMOUNT, INSTALLMENT_COUNT, RELEASE_AMOUNT } from "@/lib/money";
import {
  ageOn,
  type CaseValues,
  completeValues,
  isHouseKind,
  KINDS,
  type PartialDate,
  parsePartialDate,
  stageKind,
  untilBeforeFrom,
} from "@/lib/validation/case";
import { centreValues } from "@/server/cases/commands";
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

/** CASE-14: a centre's date as the form reads it back, typed into its three boxes. */
function retyped(date: PartialDate | null, today: string) {
  return parsePartialDate(
    date ? String(date.year) : "",
    date?.month ? String(date.month) : "",
    date?.day ? String(date.day) : "",
    today,
  );
}

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
        buildDsOffice: { select: { districtId: true } },
        decisions: true,
        release: { include: { letter: true, dsRelease: true } },
        installments: { orderBy: { number: "asc" } },
        stageUpdates: { include: { stage: { select: { sortOrder: true } } } },
        centres: { orderBy: { position: "asc" } },
      },
    });
    expect(cases).toHaveLength(COUNT);
    // CASE-17: every kind of help, the land kinds among them.
    expect(new Set(cases.map((c) => c.kind))).toEqual(new Set(KINDS));
    expect(new Set(cases.map((c) => c.dsOfficeId))).toEqual(new Set(active.map((o) => o.id)));
    // STS-1: every one of the five statuses.
    expect([...new Set(cases.map((c) => c.status))].sort()).toEqual(
      (
        ["AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT", "ALLOCATION_RECEIVED", "IN_PROGRESS", "COMPLETED"] as const
      ).toSorted(),
    );
    // CASE-13: a few are built in another DS office, most in the one that entered them.
    const elsewhere = cases.filter((c) => c.buildDsOfficeId !== c.dsOfficeId).length;
    expect(elsewhere).toBeGreaterThan(0);
    expect(elsewhere).toBeLessThan(COUNT / 10);
    // CASE-12: each number once within its office.
    expect(new Set(cases.map((c) => `${c.dsOfficeId}:${c.applicationKey}`)).size).toBe(COUNT);

    for (const c of cases) {
      expect(c.createdById).toBe(LOAD_USER_ID);
      expect(c.createdAt.getTime()).toBeLessThanOrEqual(c.updatedAt.getTime());
      expect(c.updatedAt.getTime()).toBeLessThanOrEqual(now.getTime());

      // CASE-12: an Application Number as a paper application might carry it, with its office's code.
      expect(c.applicationNumber).toMatch(new RegExp(`^${c.dsOffice.code}/\\d+$`));
      expect(c.applicationKey).toBe(applicationKey(c.applicationNumber));
      expect(c.nicKey).not.toBeNull();
      expect(c.childName === null).toBe(c.category !== "CHILD_AT_RISK");
      // Nobody checks, sends back, rejects or stops a case any more (change 0006).
      expect(c.decisions).toHaveLength(0);

      // CASE-2, CASE-14 to CASE-17: every detail the form asks for, as the form would take it, with nothing
      // of the other category.
      const values: CaseValues = {
        category: c.category,
        careGroup: c.careGroup,
        kind: c.kind,
        landGnDivision: c.landGnDivision,
        applicationNumber: c.applicationNumber,
        childName: c.childName,
        name: c.name,
        dateOfBirth: c.dateOfBirth && dateToDay(c.dateOfBirth),
        relationship: c.relationship,
        relationshipOther: c.relationshipOther,
        maritalStatus: c.maritalStatus,
        nic: c.nic,
        address: c.address,
        gnDivision: c.gnDivision,
        mobile1: c.mobile1,
        mobile2: c.mobile2,
        remark: c.remark,
        familyMembers: c.familyMembers,
        disabledChildren: c.disabledChildren,
        aid: c.aid,
        aidOther: c.aidOther,
        centres: c.centres.map(centreValues),
      };
      expect(completeValues(values)).toEqual(values);
      expect(c.familyMembers).toBeGreaterThanOrEqual(1);
      expect(c.familyMembers).toBeLessThanOrEqual(30);
      const age = ageOn(values.dateOfBirth!, colomboDay(c.createdAt));
      if (c.careGroup === "IN_CARE") expect([16, 17]).toContain(age);
      else if (c.careGroup === "LEFT_CARE") expect(age).toBeGreaterThanOrEqual(18);
      else expect(age).toBeLessThan(18);
      // CASE-14: one to three centres in order, each date one the form takes, "until" never before "from";
      // one still in care is still in the last.
      expect(c.centres.length > 0).toBe(c.category === "CARE_LEAVER");
      expect(c.centres.length).toBeLessThanOrEqual(3);
      for (const centre of values.centres) {
        const from = retyped(centre.from, today);
        const until = retyped(centre.until, today);
        expect(from.ok && until.ok).toBe(true);
        if (centre.from && centre.until) expect(untilBeforeFrom(centre.from, centre.until)).toBe(false);
      }
      if (c.careGroup === "IN_CARE") expect(values.centres.at(-1)!.until).toBeNull();

      if (c.status === "AWAITING_ALLOCATION") {
        expect(c.release).toBeNull();
        expect(c.installments).toHaveLength(0);
        expect(c.stageUpdates).toHaveLength(0);
        continue;
      }

      // REL-2, REL-3: Rs. 2,000,000 on a letter to the district where it is built, on or after the day it
      // was entered and never in the future.
      const release = c.release!;
      const letterDay = dateToDay(release.releasedOn);
      expect(release.amount).toBe(RELEASE_AMOUNT);
      expect(release.letter.districtId).toBe(c.buildDsOffice.districtId);
      expect(dateToDay(release.letter.letterDate)).toBe(letterDay);
      expect(letterDay >= colomboDay(c.createdAt)).toBe(true);
      expect(letterDay <= today).toBe(true);

      if (c.status === "ALLOCATED_TO_DISTRICT") {
        // REL-6: not yet released to the DS, so there is nothing to pay or record.
        expect(release.dsRelease).toBeNull();
        expect(release.dsReleasedOn).toBeNull();
        expect(c.installments).toHaveLength(0);
        expect(c.stageUpdates).toHaveLength(0);
        continue;
      }

      // REL-6, REL-7: the District's release to the DS where it is built, on or after the letter's day.
      const dsRelease = release.dsRelease!;
      const releasedOn = dateToDay(release.dsReleasedOn!);
      expect(dsRelease.dsOfficeId).toBe(c.buildDsOfficeId);
      expect(dsRelease.districtId).toBe(c.buildDsOffice.districtId);
      expect(dateToDay(dsRelease.releasedOn)).toBe(releasedOn);
      expect(releasedOn >= letterDay && releasedOn <= today).toBe(true);

      // INS-5: in progress once installment 1 is paid; until then, its allocation received, with visits
      // perhaps but no stage reached.
      expect(c.installments[0]?.status === "RELEASED").toBe(c.status !== "ALLOCATION_RECEIVED");
      if (c.status === "ALLOCATION_RECEIVED") for (const u of c.stageUpdates) expect(u.stageId).toBeNull();

      if (isHouseKind(c.kind)) {
        // INS-1, REL-7: four of Rs. 500,000, made at the District's release.
        expect(c.installments.map((i) => [i.number, i.amount])).toEqual(
          [1, 2, 3, 4].map((n) => [n, INSTALLMENT_AMOUNT]),
        );
      } else {
        // INS-7: only the installments started, numbered in order, at most four, of amounts adding up to no
        // more than Rs. 2,000,000, and to all of it once the fourth is started.
        expect(c.installments.map((i) => i.number)).toEqual(c.installments.map((_, index) => index + 1));
        expect(c.installments.length).toBeLessThanOrEqual(INSTALLMENT_COUNT);
        for (const i of c.installments) expect(i.status).not.toBe("NOT_STARTED");
        const started = c.installments.reduce((sum, i) => sum + i.amount, 0);
        expect(started).toBeLessThanOrEqual(RELEASE_AMOUNT);
        if (c.installments.length === INSTALLMENT_COUNT) expect(started).toBe(RELEASE_AMOUNT);
      }
      // INS-2 to INS-4: only the next one is being paid, each paid after the one before.
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

      // STG-1, STG-4: stages of the list the case's kind follows, in order, dated from the release to today.
      const kindStages = stages.filter((s) => s.kind === stageKind(c.kind)).map((s) => s.id);
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

      // CLS-1: completed exactly when the money is paid in full and the last active stage is reached.
      const done = isComplete({
        kind: c.kind,
        installments: c.installments,
        lastActiveStageId: kindStages.at(-1) ?? null,
        reachedStageIds: reached.map((u) => u.stageId!),
      });
      expect(done).toBe(c.status === "COMPLETED");
      expect(c.completedAt !== null).toBe(c.status === "COMPLETED");
    }

    // INS-7: land cases are paid in amounts of their own, and some have been paid in full.
    const land = cases.filter((c) => !isHouseKind(c.kind));
    expect(land.some((c) => c.installments.some((i) => i.amount !== INSTALLMENT_AMOUNT))).toBe(true);
    expect(land.some((c) => c.status === "COMPLETED")).toBe(true);

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
