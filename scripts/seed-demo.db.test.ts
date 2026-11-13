import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { colomboDay, dateToDay } from "@/lib/dates";
import { INSTALLMENT_AMOUNT } from "@/lib/money";
import { isHouseKind, LAND_KINDS } from "@/lib/validation/case";
import { caseHistory } from "@/server/history/queries";
import { seed } from "../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../tests/db/client";
import { addDemoData, DEMO_ID_PREFIX, removeDemoData } from "./seed-demo";

const db = createTestClient();

const OFFICER = "demo-test-ds";
/** A second officer of the same office, whose account came later (ADM-3). */
const SECOND_OFFICER = "demo-test-ds-2";
const HEAD_OFFICE = "demo-test-ho";
/** A District CRPO of the office's district, who releases its cases (REL-6). */
const DISTRICT = "demo-test-dt";
const demoCases = { id: { startsWith: DEMO_ID_PREFIX } };
let officeId: number;

beforeAll(async () => {
  await seed(db);
  officeId = await freeOfficeId(db);
  for (const [id, name] of [
    [OFFICER, "ද. පරීක්ෂණ"],
    [SECOND_OFFICER, "දෙ. පරීක්ෂණ"],
  ] as const) {
    await db.user.create({
      data: {
        id,
        name,
        email: `${id}@no-email.invalid`,
        role: "DS_OFFICER",
        designation: "DS_CRPO",
        dsOfficeId: officeId,
      },
    });
  }
  await db.user.create({
    data: {
      id: HEAD_OFFICE,
      name: "ප්‍ර. පරීක්ෂණ",
      email: `${HEAD_OFFICE}@no-email.invalid`,
      role: "MINISTRY_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
    },
  });
  const { districtId } = await db.dsOffice.findUniqueOrThrow({ where: { id: officeId }, select: { districtId: true } });
  await db.user.create({
    data: {
      id: DISTRICT,
      name: "දි. පරීක්ෂණ",
      email: `${DISTRICT}@no-email.invalid`,
      role: "DISTRICT_OFFICER",
      designation: "DISTRICT_CRPO",
      districtId,
    },
  });
});

afterAll(() => db.$disconnect());

// Adding or removing a few hundred cases takes seconds, more on a CI runner than vitest's default 5.
describe("demo data", { timeout: 120_000 }, () => {
  it("adds cases to each office with an officer, each one with its history told by real accounts", async () => {
    const now = new Date();
    const today = colomboDay(now);

    const { offices } = await addDemoData(db, { seed: 3, now });
    const office = await db.dsOffice.findUniqueOrThrow({ where: { id: officeId } });
    expect(offices).toContain(office.nameSi);

    const cases = await db.case.findMany({
      where: { ...demoCases, dsOfficeId: officeId },
      include: {
        buildDsOffice: { select: { districtId: true } },
        decisions: true,
        release: { include: { letter: true, dsRelease: true } },
        installments: true,
        stageUpdates: true,
        centres: true,
      },
    });
    expect(cases).toHaveLength(15);
    // CASE-17: a few cases of each land kind, among the houses.
    for (const kind of LAND_KINDS) expect(cases.some((c) => c.kind === kind)).toBe(true);
    // INS-7: a land case paid is paid in amounts of its own.
    expect(
      cases.some(
        (c) =>
          !isHouseKind(c.kind) &&
          c.installments.some((i) => i.amount !== INSTALLMENT_AMOUNT && i.status === "RELEASED"),
      ),
    ).toBe(true);
    // STS-1: every one of the five statuses.
    expect(new Set(cases.map((c) => c.status))).toEqual(
      new Set(["AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT", "ALLOCATION_RECEIVED", "IN_PROGRESS", "COMPLETED"]),
    );

    const viewer = {
      role: "MINISTRY_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
      districtId: null,
      provinceId: null,
      dsOfficeId: null,
    } as const;
    // Other test files add Ministry officers too, and each case takes one of them at random.
    const headOffice = new Set(
      (await db.user.findMany({ where: { role: "MINISTRY_OFFICER", banned: false }, select: { id: true } })).map(
        (u) => u.id,
      ),
    );
    expect(headOffice).toContain(HEAD_OFFICE);
    for (const c of cases) {
      expect(c.createdById).toBe(OFFICER);
      expect(c.address).toMatch(/^අංක \d+, /);
      // Nobody checks, sends back, rejects or stops a case any more (change 0006).
      expect(c.decisions).toHaveLength(0);

      // HIS-2: the history reads as if the case had been entered on the screens.
      const history = (await caseHistory(db, viewer, c.id, "si"))!.toReversed();
      expect(history[0]).toMatchObject({ action: "case_created", actor: { role: "DS_OFFICER" } });
      // CASE-12: entered with its Application Number, as saveCase logs it.
      expect(history[0].after.applicationNumber).toBe(c.applicationNumber);
      // CASE-14 to CASE-16: and with change 0007's details, the centres as one field.
      expect(history[0].after).toMatchObject({
        dateOfBirth: dateToDay(c.dateOfBirth!),
        familyMembers: c.familyMembers,
        disabledChildren: c.disabledChildren,
      });
      expect(history[0].after.centres ?? []).toHaveLength(c.centres.length);
      expect(c.centres.length > 0).toBe(c.category === "CARE_LEAVER");
      for (const [index, entry] of history.entries()) {
        if (index > 0) expect(entry.at.getTime()).toBeGreaterThanOrEqual(history[index - 1].at.getTime());
        expect(entry.at.getTime()).toBeLessThanOrEqual(now.getTime());
      }
      const actions = history.map((e) => e.action);
      expect(actions.filter((a) => a === "stage_updated")).toHaveLength(c.stageUpdates.length);
      expect(actions.filter((a) => a === "case_completed")).toHaveLength(c.status === "COMPLETED" ? 1 : 0);
      if (c.status === "COMPLETED") expect(history.at(-1)).toMatchObject({ action: "case_completed", actor: null });

      if (c.release) {
        // REL-2, REL-3: the case's letter is for the district where it is built, dated on or after the day it
        // was entered.
        const letter = c.release.letter;
        expect(letter.districtId).toBe(c.buildDsOffice.districtId);
        expect(dateToDay(letter.letterDate) >= colomboDay(c.createdAt)).toBe(true);
        expect(dateToDay(letter.letterDate) <= today).toBe(true);
        const allocated = history.find((e) => e.action === "case_allocated")!;
        expect(allocated.after).toMatchObject({ letterId: letter.id, letterNumber: letter.letterNumber });
        expect(allocated.actor).toMatchObject({ role: "MINISTRY_OFFICER" });
      }
      // REL-6, REL-7: the District's release to the DS where it is built, on or after the letter, by the
      // district's CRPO.
      const dsRelease = c.release?.dsRelease;
      expect(dsRelease == null).toBe(["AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT"].includes(c.status));
      if (dsRelease) {
        expect(dsRelease.dsOfficeId).toBe(c.buildDsOfficeId);
        expect(dateToDay(dsRelease.releasedOn) >= dateToDay(c.release!.letter.letterDate)).toBe(true);
        expect(dateToDay(c.release!.dsReleasedOn!)).toBe(dateToDay(dsRelease.releasedOn));
        const released = history.find((e) => e.action === "case_ds_released")!;
        expect(released.after).toMatchObject({ dsReleaseId: dsRelease.id, referenceNumber: dsRelease.referenceNumber });
        if (c.buildDsOffice.districtId === office.districtId)
          expect(released.actor).toMatchObject({ role: "DISTRICT_OFFICER" });
      }
      // INS-5: paying installment 1 moved the case on to in progress.
      expect(actions.filter((a) => a === "case_started")).toHaveLength(
        ["IN_PROGRESS", "COMPLETED"].includes(c.status) ? 1 : 0,
      );

      // INS-2: each installment started, and was paid only after it started.
      for (const i of c.installments.filter((i) => i.status !== "NOT_STARTED")) {
        const started = history.find((e) => e.action === "installment_started" && e.after.number === i.number);
        expect(started?.after.expectedOn).toBe(dateToDay(i.expectedOn!));
        // INS-7: started with its amount, as the command logs it.
        expect(started?.after.amount).toBe(i.amount);
        if (i.status === "RELEASED") {
          const paid = history.find((e) => e.action === "installment_paid" && e.after.number === i.number)!;
          expect(paid.after.releasedOn).toBe(dateToDay(i.releasedOn!));
          expect(started!.at.getTime()).toBeLessThanOrEqual(paid.at.getTime());
        }
      }
    }

    // NTF-1: the officer has the notices the steps sent; only the last week's are unread.
    const notices = await db.notification.findMany({ where: { userId: OFFICER, case: { dsOfficeId: officeId } } });
    expect(notices.length).toBeGreaterThan(0);
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60_000;
    for (const n of notices) expect(n.readAt === null).toBe(n.createdAt.getTime() > weekAgo);
    // The office's other officer gets them too, though the first one entered the cases (ADM-3).
    expect(await db.notification.count({ where: { userId: SECOND_OFFICER, case: { dsOfficeId: officeId } } })).toBe(
      notices.length,
    );
    // NTF-1: the District CRPO hears of each of its district's letters once.
    const letters = await db.releaseLetter.count({
      where: { id: { startsWith: DEMO_ID_PREFIX }, districtId: office.districtId },
    });
    expect(letters).toBeGreaterThan(0);
    expect(await db.notification.count({ where: { userId: DISTRICT, type: "DISTRICT_LETTER" } })).toBe(letters);
  });

  it("leaves an office that already has demo cases alone", async () => {
    const { offices } = await addDemoData(db, { seed: 4 });
    expect(offices).toEqual([]);
    expect(await db.case.count({ where: { ...demoCases, dsOfficeId: officeId } })).toBe(15);
  });

  it("removes them again with their letters and District releases, keeping their audit records", async () => {
    const ids = (await db.case.findMany({ where: demoCases, select: { id: true } })).map((c) => c.id);
    expect(await removeDemoData(db)).toBe(ids.length);

    expect(await db.case.count({ where: demoCases })).toBe(0);
    expect(await db.notification.count({ where: { caseId: { in: ids } } })).toBe(0);
    expect(await db.releaseLetter.count({ where: { id: { startsWith: DEMO_ID_PREFIX } } })).toBe(0);
    expect(await db.dsRelease.count({ where: { id: { startsWith: DEMO_ID_PREFIX } } })).toBe(0);
    // HIS-3: the audit log is never cleaned up.
    expect(await db.auditLog.count({ where: { caseId: { in: ids } } })).toBeGreaterThan(0);
  });
});
