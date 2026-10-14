import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { colomboDay, dateToDay } from "@/lib/dates";
import { caseHistory } from "@/server/history/queries";
import { seed } from "../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../tests/db/client";
import { addDemoData, DEMO_ID_PREFIX, removeDemoData } from "./seed-demo";

const db = createTestClient();

const OFFICER = "demo-test-ds";
/** A second officer of the same office, whose account came later (ADM-3). */
const SECOND_OFFICER = "demo-test-ds-2";
const HEAD_OFFICE = "demo-test-ho";
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
      data: { id, name, email: `${id}@no-email.invalid`, role: "DS_OFFICER", dsOfficeId: officeId },
    });
  }
  await db.user.create({
    data: { id: HEAD_OFFICE, name: "ප්‍ර. පරීක්ෂණ", email: `${HEAD_OFFICE}@no-email.invalid`, role: "HO_OFFICER" },
  });
});

afterAll(() => db.$disconnect());

// Adding or removing a few hundred cases takes seconds, more on a CI runner than vitest's default 5.
describe("demo data", { timeout: 120_000 }, () => {
  let countersBefore: string[] = [];
  const counters = async () =>
    (await db.caseNumberCounter.findMany({ orderBy: [{ dsOfficeId: "asc" }, { year: "asc" }] })).map(
      (c) => `${c.dsOfficeId}:${c.year}:${c.last}`,
    );

  it("adds cases to each office with an officer, each one with its history told by real accounts", async () => {
    countersBefore = await counters();
    const now = new Date();
    const today = colomboDay(now);

    const { offices } = await addDemoData(db, { seed: 3, now });
    const office = await db.dsOffice.findUniqueOrThrow({ where: { id: officeId } });
    expect(offices).toContain(office.nameSi);

    const cases = await db.case.findMany({
      where: { ...demoCases, dsOfficeId: officeId },
      include: {
        decisions: true,
        release: { include: { letter: true } },
        installments: true,
        stageUpdates: true,
      },
    });
    expect(cases).toHaveLength(15);
    expect(new Set(cases.map((c) => c.status))).toEqual(
      new Set(["DRAFT", "SUBMITTED", "RETURNED", "VERIFIED", "IN_PROGRESS", "COMPLETED", "REJECTED", "STOPPED"]),
    );

    const viewer = { role: "HO_OFFICER", dsOfficeId: null } as const;
    // Other test files add Head Office officers too, and each case takes one of them at random.
    const headOffice = new Set(
      (await db.user.findMany({ where: { role: "HO_OFFICER", banned: false }, select: { id: true } })).map((u) => u.id),
    );
    expect(headOffice).toContain(HEAD_OFFICE);
    for (const c of cases) {
      expect(c.createdById).toBe(OFFICER);
      // A draft may still have an empty address (CASE-4); see `maybe` in seed-load.ts.
      if (c.status !== "DRAFT" || c.address !== null) expect(c.address).toMatch(/^අංක \d+, /);
      for (const d of c.decisions) {
        if (d.type === "SUBMIT") expect(d.byId).toBe(OFFICER);
        else expect(headOffice).toContain(d.byId);
      }

      // HIS-2: the history reads as if the case had been entered on the screens.
      const history = (await caseHistory(db, viewer, c.id, "si"))!.toReversed();
      expect(history[0]).toMatchObject({ action: "case_created", actor: { role: "DS_OFFICER" } });
      for (const [index, entry] of history.entries()) {
        if (index > 0) expect(entry.at.getTime()).toBeGreaterThanOrEqual(history[index - 1].at.getTime());
        expect(entry.at.getTime()).toBeLessThanOrEqual(now.getTime());
      }
      const actions = history.map((e) => e.action);
      expect(actions.includes("case_submitted")).toBe(c.status !== "DRAFT");
      const submitted = history.find((e) => e.action === "case_submitted");
      if (submitted) expect(submitted.after.caseNumber).toBe(c.caseNumber);
      expect(actions.filter((a) => a === "stage_updated")).toHaveLength(c.stageUpdates.length);
      expect(actions.filter((a) => a === "case_completed")).toHaveLength(c.status === "COMPLETED" ? 1 : 0);
      if (c.status === "COMPLETED") expect(history.at(-1)).toMatchObject({ action: "case_completed", actor: null });

      if (c.release) {
        // REL-2: the case's letter is for its district, dated on or after its verification.
        const letter = c.release.letter;
        expect(letter.districtId).toBe(office.districtId);
        expect(dateToDay(letter.letterDate) >= colomboDay(c.verifiedAt!)).toBe(true);
        expect(dateToDay(letter.letterDate) <= today).toBe(true);
        const released = history.find((e) => e.action === "case_released")!;
        expect(released.after).toMatchObject({ letterId: letter.id, letterNumber: letter.letterNumber });
        expect(released.actor).toMatchObject({ role: "HO_OFFICER" });
      }

      // INS-2: each installment started, and was paid only after it started.
      for (const i of c.installments.filter((i) => i.status !== "NOT_STARTED")) {
        const started = history.find((e) => e.action === "installment_started" && e.after.number === i.number);
        expect(started?.after.expectedOn).toBe(dateToDay(i.expectedOn!));
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
  });

  it("leaves an office that already has demo cases alone", async () => {
    const { offices } = await addDemoData(db, { seed: 4 });
    expect(offices).toEqual([]);
    expect(await db.case.count({ where: { ...demoCases, dsOfficeId: officeId } })).toBe(15);
  });

  it("removes them again and gives back the case numbers, keeping their audit records", async () => {
    const ids = (await db.case.findMany({ where: demoCases, select: { id: true } })).map((c) => c.id);
    expect(await removeDemoData(db)).toBe(ids.length);

    expect(await db.case.count({ where: demoCases })).toBe(0);
    expect(await db.notification.count({ where: { caseId: { in: ids } } })).toBe(0);
    expect(await db.releaseLetter.count({ where: { id: { startsWith: DEMO_ID_PREFIX } } })).toBe(0);
    expect(await counters()).toEqual(countersBefore);
    // HIS-3: the audit log is never cleaned up.
    expect(await db.auditLog.count({ where: { caseId: { in: ids } } })).toBeGreaterThan(0);
  });
});
