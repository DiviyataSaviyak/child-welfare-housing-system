import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId, testApplicationNumber } from "../../../tests/db/client";
import { releaseToDsForTests } from "../../../tests/db/ds-release";
import { colomboDay, dayToDate } from "@/lib/dates";
import type { CaseValues } from "@/lib/validation/case";
import { defaultValidUntil, type ReleaseField } from "@/lib/validation/release";
import { fileForViewer, uploadLetterScan } from "../files/uploads";
import { listNotifications, unreadCount, unreadNow } from "../notifications/queries";
import { openNotification } from "../notifications/commands";
import { correctRelease, type LetterInput, recordLetter } from "./commands";
import { awaitingAllocation, casesForLetter, districtsWaiting, getLetter, recentLetters } from "./queries";
import { type Actor, saveCase, type SaveCaseInput } from "../cases/commands";
import { getCase } from "../cases/queries";

const db = createTestClient();

let dsA: Actor;
let dsB: Actor;
let ho: Actor;
/** The District CRPO of dsA's district, who hears of each letter to it (NTF-1). */
let district: Actor;
const admin: Actor = {
  userId: "review-test-admin",
  role: "ADMIN",
  designation: null,
  districtId: null,
  provinceId: null,
  dsOfficeId: null,
};

/** A complete, made-up case (SEC-11). Each test gives its own NIC so tests don't match each other. */
const values = (nic: string, overrides: Partial<CaseValues> = {}): CaseValues => ({
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
  applicationNumber: testApplicationNumber(),
  childName: null,
  name: "පරීක්ෂණ ප්‍රතිලාභී",
  nic,
  address: "නො. 1, පරීක්ෂණ පාර",
  gnDivision: null,
  mobile1: "0710000001",
  mobile2: null,
  remark: null,
  ...overrides,
});

const input = (nic: string, overrides: Partial<SaveCaseInput> = {}): SaveCaseInput => ({
  id: randomUUID(),
  version: null,
  dsOfficeId: null,
  buildDsOfficeId: null,
  values: values(nic),
  documentIds: [],
  ...overrides,
});

const load = (id: string) => db.case.findUniqueOrThrow({ where: { id } });

/** A saved case: it awaits its allocation at once, with nobody checking it (CASE-5, change 0006). */
async function awaiting(nic: string, actor = dsA, overrides: Partial<SaveCaseInput> = {}) {
  const result = await saveCase(db, actor, input(nic, overrides));
  if (!result.ok) throw new Error(result.error);
  return load(result.value.id);
}

const today = () => colomboDay(new Date());
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => colomboDay(new Date(Date.now() - n * DAY));
const letterForm = (overrides: Partial<Record<ReleaseField, string>> = {}): Record<ReleaseField, string> => ({
  letterNumber: "MWCA/3/8/16/01-2026",
  letterDate: today(),
  validUntil: defaultValidUntil(today()),
  note: "",
  ...overrides,
});

const districtOf = async (dsOfficeId: number) =>
  (await db.dsOffice.findUniqueOrThrow({ where: { id: dsOfficeId }, select: { districtId: true } })).districtId;

type Ticked = { id: string; version: number; dsOfficeId: number };

/** A letter for these cases of one district, as the form sends it. */
async function letter(cases: Ticked[], overrides: Partial<Record<ReleaseField, string>> = {}): Promise<LetterInput> {
  return {
    districtId: await districtOf(cases[0].dsOfficeId),
    cases: cases.map((c) => ({ id: c.id, version: c.version })),
    form: letterForm(overrides),
    scanId: null,
  };
}

/** Saved, then allocated together on one letter. */
async function released(...nics: string[]) {
  const ready = [];
  for (const nic of nics) ready.push(await awaiting(nic));
  const result = await recordLetter(db, ho, await letter(ready));
  if (!result.ok) throw new Error(String(result.error ?? JSON.stringify(result.errors)));
  return Promise.all(ready.map((c) => load(c.id)));
}

async function officer(id: string): Promise<Actor> {
  const dsOfficeId = await freeOfficeId(db);
  await db.user.create({
    data: {
      id,
      name: "ප. පරීක්ෂණ",
      email: `${id}@no-email.invalid`,
      role: "DS_OFFICER",
      designation: "DS_CRPO",
      dsOfficeId,
    },
  });
  return { userId: id, role: "DS_OFFICER", designation: "DS_CRPO", districtId: null, provinceId: null, dsOfficeId };
}

beforeAll(async () => {
  await seed(db);
  dsA = await officer("review-test-ds-a");
  dsB = await officer("review-test-ds-b");
  await db.user.create({
    data: {
      id: "review-test-ho",
      name: "ප්‍ර. පරීක්ෂණ",
      email: "review-test-ho@no-email.invalid",
      role: "MINISTRY_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
    },
  });
  ho = {
    userId: "review-test-ho",
    role: "MINISTRY_OFFICER",
    designation: "MINISTRY_PROGRAMME_OFFICER",
    districtId: null,
    provinceId: null,
    dsOfficeId: null,
  };
  await db.user.create({
    data: { id: admin.userId, name: "පරිපාලක", email: "review-test-admin@no-email.invalid", role: "ADMIN" },
  });
  const districtId = await districtOf(dsA.dsOfficeId!);
  await db.user.create({
    data: {
      id: "review-test-district",
      name: "",
      email: "review-test-district@no-email.invalid",
      role: "DISTRICT_OFFICER",
      designation: "DISTRICT_CRPO",
      districtId,
    },
  });
  district = {
    userId: "review-test-district",
    role: "DISTRICT_OFFICER",
    designation: "DISTRICT_CRPO",
    districtId,
    provinceId: null,
    dsOfficeId: null,
  };
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the Ministry's allocation letter (REL-1 to REL-3, AC-52)", () => {
  it("allocates every case ticked on the district's letter, with no installments, and tells both the offices and the district", async () => {
    const first = await awaiting("200200000030");
    const second = await awaiting("200200000035");
    const left = await awaiting("200200000036");
    const input = await letter([first, second], { letterNumber: " MWCA/3/8/16/02-2026 ", note: "පළමු ලිපිය" });
    const result = await recordLetter(db, ho, input);

    expect(result).toMatchObject({ ok: true });
    const letterId = result.ok ? result.letterId : "";
    expect(await db.releaseLetter.findUniqueOrThrow({ where: { id: letterId } })).toMatchObject({
      districtId: input.districtId,
      letterNumber: "MWCA/3/8/16/02-2026",
      letterDate: dayToDate(today()),
      validUntil: dayToDate(defaultValidUntil(today())),
      note: "පළමු ලිපිය",
      byId: ho.userId,
    });
    for (const c of [first, second]) {
      expect((await load(c.id)).status).toBe("ALLOCATED_TO_DISTRICT");
      const release = await db.release.findUniqueOrThrow({ where: { caseId: c.id } });
      expect(release).toMatchObject({
        letterId,
        amount: 2_000_000,
        releasedOn: dayToDate(today()),
        dsReleaseId: null,
        dsReleasedOn: null,
      });
      // REL-3: the District's release makes the installments, not the letter.
      expect(await db.installment.count({ where: { caseId: c.id } })).toBe(0);
      expect(await db.notification.count({ where: { caseId: c.id, userId: dsA.userId, type: "ALLOCATED" } })).toBe(1);
      const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "case_allocated" } });
      expect(audit.after).toMatchObject({
        status: "ALLOCATED_TO_DISTRICT",
        amount: 2_000_000,
        letterId,
        letterNumber: "MWCA/3/8/16/02-2026",
        cases: 2,
      });
    }
    // NTF-1: the district's CRPO hears once for the whole letter, on its first case.
    const told = await db.notification.findMany({
      where: { userId: district.userId, case: { release: { letterId } } },
    });
    expect(told.map((n) => [n.type, n.caseId])).toEqual([["DISTRICT_LETTER", [first.id, second.id].sort()[0]]]);
    // The case left off the letter still waits for one.
    expect((await load(left.id)).status).toBe("AWAITING_ALLOCATION");
    expect(await db.auditLog.count({ where: { entityId: letterId, action: "letter_recorded" } })).toBe(1);

    const details = await getCase(db, dsA, first.id, "si");
    expect(details?.release).toMatchObject({
      releasedOn: today(),
      amount: 2_000_000,
      letter: { id: letterId, letterNumber: "MWCA/3/8/16/02-2026", cases: 2, note: "පළමු ලිපිය", scanId: null },
    });
    expect(details?.installments).toEqual([]);
    expect(await getLetter(db, ho, letterId, "si")).toMatchObject({ count: 2, offices: [details?.officeName] });
    expect((await recentLetters(db, ho, "si"))[0]?.id).toBe(letterId);
    expect(await getLetter(db, dsA, letterId, "si")).toBeNull();
  });

  it("gives each case its category, kind, DS of residence when another, and the cases sharing its NIC (REL-2, CASE-6)", async () => {
    const elsewhere = await db.dsOffice.findFirstOrThrow({
      where: { active: true, id: { not: dsA.dsOfficeId! }, districtId: await districtOf(dsA.dsOfficeId!) },
      select: { id: true },
    });
    const twin = await awaiting("200200000070");
    const built = await awaiting("200200000070", dsA, { buildDsOfficeId: elsewhere.id });
    const plain = await awaiting("200200000071");
    const rows = await casesForLetter(db, ho, await districtOf(dsA.dsOfficeId!), "si");
    const row = (id: string) => rows.find((r) => r.id === id);

    expect(row(plain.id)).toMatchObject({
      category: "CARE_LEAVER",
      kind: "NEW_HOUSE",
      residenceName: null,
      duplicates: [],
    });
    expect(row(built.id)?.residenceName).toBe(row(plain.id)?.officeName);
    expect(row(built.id)?.officeName).not.toBe(row(plain.id)?.officeName);
    expect(row(twin.id)?.duplicates.map((d) => d.id)).toEqual([built.id]);
    expect(row(built.id)?.duplicates.map((d) => [d.id, d.applicationNumber, d.status])).toEqual([
      [twin.id, twin.applicationNumber, "AWAITING_ALLOCATION"],
    ]);
  });

  it("lists the districts waiting for a letter and each one's cases awaiting it, for the Ministry only", async () => {
    const first = await awaiting("200200000022");
    const second = await awaiting("200200000023");
    const districtId = await districtOf(first.dsOfficeId);

    const waiting = await districtsWaiting(db, ho, "si");
    const here = waiting.find((d) => d.id === districtId);
    expect(here?.count).toBe(
      await db.case.count({ where: { status: "AWAITING_ALLOCATION", buildDsOffice: { districtId } } }),
    );
    // NTF-1: the menu counts the same cases.
    expect(waiting.reduce((sum, d) => sum + d.count, 0)).toBe((await awaitingAllocation(db, ho)).count);
    const counts = waiting.map((d) => d.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));

    const ids = (await casesForLetter(db, ho, districtId, "si")).map((c) => c.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    for (const actor of [dsA, admin]) {
      expect(await districtsWaiting(db, actor, "si")).toEqual([]);
      expect(await casesForLetter(db, actor, districtId, "si")).toEqual([]);
      expect(await recentLetters(db, actor, "si")).toEqual([]);
      expect((await awaitingAllocation(db, actor)).count).toBe(0);
    }
  });

  it("refuses a missing number, a future date, a date before a case was entered and an end before the date", async () => {
    const early = await awaiting("200200000031");
    const late = await awaiting("200200000037");
    await db.case.update({ where: { id: early.id }, data: { createdAt: new Date(Date.now() - 10 * DAY) } });
    await db.case.update({ where: { id: late.id }, data: { createdAt: new Date(Date.now() - 3 * DAY) } });
    const refused = async (overrides: Partial<Record<ReleaseField, string>>) => {
      const result = await recordLetter(db, ho, await letter([early, late], overrides));
      return result.ok ? null : result.errors;
    };

    expect(await refused({ letterNumber: "" })).toEqual({ letterNumber: "numberRequired" });
    expect(await refused({ letterDate: colomboDay(new Date(Date.now() + DAY)) })).toEqual({
      letterDate: "dateInFuture",
    });
    // The later of the two cases is the earliest the letter can be dated (REL-2).
    expect(await refused({ letterDate: daysAgo(5) })).toEqual({ letterDate: "dateBeforeEntered" });
    expect(await refused({ letterDate: daysAgo(3), validUntil: daysAgo(4) })).toEqual({
      validUntil: "untilBeforeDate",
    });
    expect(await refused({ letterDate: "2026-02-30" })).toEqual({ letterDate: "dateInvalid" });
    for (const c of [early, late]) {
      expect((await load(c.id)).status).toBe("AWAITING_ALLOCATION");
      expect(await db.installment.count({ where: { caseId: c.id } })).toBe(0);
    }
    expect(await recordLetter(db, ho, await letter([early, late], { letterDate: daysAgo(3) }))).toMatchObject({
      ok: true,
    });
  });

  it("allocates all or nothing, and refuses no case, another district, a DS officer, a District CRPO, an admin and an old form", async () => {
    const [running] = await released("200200000032");
    const ready = await awaiting("200200000033");
    const record = async (actor: Actor, cases: Ticked[]) => recordLetter(db, actor, await letter(cases));

    expect(await record(ho, [ready, running])).toEqual({ ok: false, error: "notAllowedNow", errors: {} });
    expect((await load(ready.id)).status).toBe("AWAITING_ALLOCATION");
    expect(await recordLetter(db, ho, { ...(await letter([ready])), cases: [] })).toEqual({
      ok: false,
      error: "noCases",
      errors: {},
    });
    // A case of another district can't go on this district's letter.
    const elsewhere = await db.dsOffice.findFirstOrThrow({
      where: { active: true, districtId: { not: await districtOf(ready.dsOfficeId) } },
      select: { id: true },
    });
    const there = await awaiting("200200000038", ho, { dsOfficeId: elsewhere.id });
    const both = [ready, there].map(({ id, version }) => ({ id, version }));
    expect(await recordLetter(db, ho, { ...(await letter([ready])), cases: both })).toEqual({
      ok: false,
      error: "notFound",
      errors: {},
    });

    expect(await record(dsA, [ready])).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await record(district, [ready])).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await record(admin, [ready])).toEqual({ ok: false, error: "notFound", errors: {} });
    expect(await record(ho, [{ ...ready, version: ready.version - 1 }])).toEqual({
      ok: false,
      error: "conflict",
      errors: {},
    });
    expect(await db.release.count({ where: { caseId: { in: [ready.id, there.id] } } })).toBe(0);

    expect(await record(ho, [ready])).toMatchObject({ ok: true });
    expect(await record(ho, [ready])).toEqual({ ok: false, error: "notAllowedNow", errors: {} });
    expect(await db.release.count({ where: { caseId: ready.id } })).toBe(1);
    expect(await db.installment.count({ where: { caseId: ready.id } })).toBe(0);
  });

  it("keeps the officer's own scan with the letter, which only the letter's offices may open", async () => {
    const ready = await awaiting("200200000039");
    const pdf = { name: "ලිපිය.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n% test letter\n") };
    expect(await uploadLetterScan(db, dsA, pdf)).toEqual({ ok: false, error: "notAllowed" });
    const scan = await uploadLetterScan(db, ho, pdf);
    if (!scan.ok) throw new Error(scan.error);
    // Someone else's upload can't be attached.
    const other: Actor = {
      userId: "review-test-ho-2",
      role: "MINISTRY_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
      districtId: null,
      provinceId: null,
      dsOfficeId: null,
    };
    await db.user.create({
      data: {
        id: other.userId,
        name: "ප්‍ර. දෙවන",
        email: "review-test-ho-2@no-email.invalid",
        role: "MINISTRY_OFFICER",
        designation: "MINISTRY_PROGRAMME_OFFICER",
      },
    });
    expect(await recordLetter(db, other, { ...(await letter([ready])), scanId: scan.value.id })).toEqual({
      ok: false,
      error: "scanUnavailable",
      errors: {},
    });
    expect((await load(ready.id)).status).toBe("AWAITING_ALLOCATION");

    const result = await recordLetter(db, ho, { ...(await letter([ready])), scanId: scan.value.id });
    expect(result).toMatchObject({ ok: true });
    expect(await db.storedFile.findUniqueOrThrow({ where: { id: scan.value.id } })).toMatchObject({
      kind: "LETTER",
      letterId: result.ok ? result.letterId : "",
      caseId: null,
    });
    expect((await getCase(db, ho, ready.id, "si"))?.release?.letter.scanId).toBe(scan.value.id);
    expect(await fileForViewer(db, dsA, scan.value.id)).toMatchObject({ originalName: "ලිපිය.pdf" });
    expect(await fileForViewer(db, other, scan.value.id)).not.toBeNull();
    expect(await fileForViewer(db, dsB, scan.value.id)).toBeNull();
    expect(await fileForViewer(db, admin, scan.value.id)).toBeNull();
  });

  it("can't hold any other amount, or a letter valid before its date, even when written directly to the database", async () => {
    const [running] = await released("200200000034");
    const { letterId } = await db.release.findUniqueOrThrow({ where: { caseId: running.id } });
    const ready = await awaiting("200200000043");
    await expect(
      db.release.create({
        data: {
          id: randomUUID(),
          caseId: ready.id,
          letterId,
          releasedOn: dayToDate(today()),
          amount: 1_500_000,
          byId: ho.userId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.installment.create({ data: { id: randomUUID(), caseId: ready.id, number: 5, amount: 500_000 } }),
    ).rejects.toThrow();
    await expect(
      db.releaseLetter.create({
        data: {
          id: randomUUID(),
          districtId: await districtOf(ready.dsOfficeId),
          letterNumber: "X",
          letterDate: dayToDate(today()),
          validUntil: dayToDate(daysAgo(1)),
          byId: ho.userId,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("correcting a release's letter (REL-4)", () => {
  it("changes the letter for every case on it, logging the old and new value of each field on each", async () => {
    const [running, other] = await released("200200000040", "200200000044");
    const result = await correctRelease(db, ho, {
      caseId: running.id,
      version: running.version,
      form: letterForm({ letterNumber: "MWCA/3/8/16/09-2026", validUntil: "2027-03-31", note: "නිවැරදි කළා" }),
    });

    expect(result).toEqual({ ok: true });
    const { letterId } = await db.release.findUniqueOrThrow({ where: { caseId: running.id } });
    expect(await db.releaseLetter.findUniqueOrThrow({ where: { id: letterId } })).toMatchObject({
      letterNumber: "MWCA/3/8/16/09-2026",
      validUntil: dayToDate("2027-03-31"),
      note: "නිවැරදි කළා",
    });
    for (const c of [running, other]) {
      const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "release_corrected" } });
      expect(audit).toMatchObject({
        actorId: ho.userId,
        entityId: letterId,
        before: { letterNumber: "MWCA/3/8/16/01-2026", validUntil: defaultValidUntil(today()), note: null },
        after: { letterNumber: "MWCA/3/8/16/09-2026", validUntil: "2027-03-31", note: "නිවැරදි කළා" },
      });
      expect((await load(c.id)).version).toBe(c.version + 1);
    }
    // The other case's page, opened before the correction, can't overwrite it.
    expect(await correctRelease(db, ho, { caseId: other.id, version: other.version, form: letterForm() })).toEqual({
      ok: false,
      error: "conflict",
      errors: {},
    });
  });

  it("can't move the date past a District release or an installment of any case on it, or before a case was entered; only the Ministry corrects", async () => {
    const [running, other] = await released("200200000041", "200200000045");
    // Both entered 10 days ago and on a letter of 9 days ago; the District released the other one 7 days
    // ago, and its first installment is expected 5 days ago.
    await db.case.updateMany({
      where: { id: { in: [running.id, other.id] } },
      data: { createdAt: new Date(Date.now() - 10 * DAY) },
    });
    await db.release.updateMany({
      where: { caseId: { in: [running.id, other.id] } },
      data: { releasedOn: dayToDate(daysAgo(9)) },
    });
    await releaseToDsForTests(db, [other.id], { on: dayToDate(daysAgo(7)) });
    await db.installment.updateMany({
      where: { caseId: other.id, number: 1 },
      data: { status: "PROCESSING", expectedOn: dayToDate(daysAgo(5)) },
    });
    const version = (await load(running.id)).version;
    const correct = (actor: Actor, letterDate: string) =>
      correctRelease(db, actor, { caseId: running.id, version, form: letterForm({ letterDate }) });

    expect(await correct(dsA, daysAgo(8))).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await correct(district, daysAgo(8))).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await correct(ho, daysAgo(6))).toEqual({
      ok: false,
      error: null,
      errors: { letterDate: "dateAfterDsRelease" },
    });
    expect(await correct(ho, daysAgo(11))).toEqual({
      ok: false,
      error: null,
      errors: { letterDate: "dateBeforeEntered" },
    });
    expect(await correct(ho, daysAgo(8))).toEqual({ ok: true });
    for (const c of [running, other]) {
      expect((await db.release.findUniqueOrThrow({ where: { caseId: c.id } })).releasedOn).toEqual(
        dayToDate(daysAgo(8)),
      );
    }

    const notYet = await awaiting("200200000042");
    expect(await correctRelease(db, ho, { caseId: notYet.id, version: notYet.version, form: letterForm() })).toEqual({
      ok: false,
      error: "noRelease",
      errors: {},
    });
  });
});

describe("notifications (NTF-1)", () => {
  it("shows the office's officer their notices, newest first, and opening one marks it read", async () => {
    const ready = await awaiting("200200000060");
    await recordLetter(db, ho, await letter([ready]));

    // Saving tells nobody; the letter tells the office (NTF-1).
    const mine = (await listNotifications(db, dsA)).filter((n) => n.caseId === ready.id);
    expect(mine.map((n) => [n.type, n.read])).toEqual([["ALLOCATED", false]]);
    const before = await unreadCount(db, dsA);
    expect((await unreadNow(db, dsA)).count).toBe(before);
    expect(await openNotification(db, dsA, mine[0]!.id)).toEqual({ caseId: ready.id, type: "ALLOCATED" });
    expect(await unreadCount(db, dsA)).toBe(before - 1);
    // Opening it again changes nothing.
    expect(await openNotification(db, dsA, mine[0]!.id)).toEqual({ caseId: ready.id, type: "ALLOCATED" });
    expect(await unreadCount(db, dsA)).toBe(before - 1);
  });

  it("keeps them from everyone else, and from the officer once moved to another office (PRM-3)", async () => {
    const [ready] = await released("200200000061");
    const notice = await db.notification.findFirstOrThrow({ where: { caseId: ready.id, userId: dsA.userId } });

    expect(await openNotification(db, dsB, notice.id)).toBeNull();
    expect(await openNotification(db, ho, notice.id)).toBeNull();
    const moved: Actor = { ...dsA, dsOfficeId: dsB.dsOfficeId };
    expect((await listNotifications(db, moved)).some((n) => n.id === notice.id)).toBe(false);
    expect(await openNotification(db, moved, notice.id)).toBeNull();
    expect(await listNotifications(db, admin)).toEqual([]);
  });
});
