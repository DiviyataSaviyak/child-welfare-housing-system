import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId, testApplicationNumber } from "../../../tests/db/client";
import { addDays, colomboDay, dayToDate } from "@/lib/dates";
import type { CaseValues } from "@/lib/validation/case";
import type { DsReleaseField } from "@/lib/validation/ds-release";
import { NOTE_ONLY } from "@/lib/validation/progress";
import { type Actor, saveCase } from "../cases/commands";
import { getCase } from "../cases/queries";
import { fileForViewer, uploadLetterScan } from "../files/uploads";
import { caseHistory } from "../history/queries";
import { openNotification } from "../notifications/commands";
import { listNotifications } from "../notifications/queries";
import { recordStageUpdate } from "../stages/commands";
import { correctDsRelease, correctRelease, type DsReleaseInput, recordDsRelease, recordLetter } from "./commands";
import { awaitingDsRelease, casesForDsRelease, dsOfficesWaiting, getDsRelease, recentDsReleases } from "./queries";

const db = createTestClient();

const today = () => colomboDay(new Date());
const daysAgo = (days: number) => addDays(today(), -days);

let nicCounter = 0;
/** A made-up NIC (SEC-11), different for every case so the tests don't match each other. */
const nextNic = () => `2004${String(++nicCounter).padStart(8, "0")}`;

const values = (): CaseValues => ({
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
  applicationNumber: testApplicationNumber(),
  childName: null,
  name: "මුදා හැරීම් පරීක්ෂණ",
  nic: nextNic(),
  address: "නො. 4, පරීක්ෂණ පාර",
  gnDivision: null,
  mobile1: "0710000004",
  mobile2: null,
  remark: null,
});

const actor = (
  userId: string,
  role: Actor["role"],
  designation: string,
  place: Partial<Pick<Actor, "dsOfficeId" | "districtId">> = {},
): Actor => ({
  userId,
  role,
  designation,
  dsOfficeId: place.dsOfficeId ?? null,
  districtId: place.districtId ?? null,
  provinceId: null,
});

async function account(who: Actor, name: string) {
  await db.user.create({
    data: {
      id: who.userId,
      name,
      email: `${who.userId}@no-email.invalid`,
      role: who.role,
      designation: who.designation,
      dsOfficeId: who.dsOfficeId,
      districtId: who.districtId,
    },
  });
  return who;
}

let dsA: Actor;
let dsB: Actor;
let ministry: Actor;
/** The District CRPO of dsA's district, who releases its cases. */
let crpo: Actor;
/** That district's District Secretary, who only views (PRM-5). */
let secretary: Actor;
/** The CRPO of another district. */
let otherCrpo: Actor;
let districtA: number;
/** An active DS office of dsA's district other than dsA's own. */
let neighbour: number;
/** An active DS office of another district. */
let elsewhere: { id: number; districtId: number };

const load = (id: string) => db.case.findUniqueOrThrow({ where: { id } });

/** A case of dsA's office (or built in `buildDsOfficeId`), saved, then allocated on a letter `letterDaysAgo` ago. */
async function allocated(options: { buildDsOfficeId?: number; letterDaysAgo?: number } = {}) {
  const saved = await saveCase(db, dsA, {
    id: randomUUID(),
    version: null,
    dsOfficeId: null,
    buildDsOfficeId: options.buildDsOfficeId ?? null,
    values: values(),
    documentIds: [],
  });
  if (!saved.ok) throw new Error(saved.error);
  const letterDay = daysAgo(options.letterDaysAgo ?? 0);
  // Entered before the letter's day, so the letter can be dated then (REL-2).
  await db.case.update({ where: { id: saved.value.id }, data: { createdAt: dayToDate(addDays(letterDay, -1)) } });
  const ready = await load(saved.value.id);
  const office = await db.dsOffice.findUniqueOrThrow({ where: { id: ready.buildDsOfficeId } });
  const letter = await recordLetter(db, ministry, {
    districtId: office.districtId,
    cases: [{ id: ready.id, version: ready.version }],
    form: { letterNumber: "MWCA/DS/7", letterDate: letterDay, validUntil: "2099-12-31", note: "" },
    scanId: null,
  });
  if (!letter.ok) throw new Error(String(letter.error ?? JSON.stringify(letter.errors)));
  return load(ready.id);
}

const form = (overrides: Partial<Record<DsReleaseField, string>> = {}): Record<DsReleaseField, string> => ({
  referenceNumber: "DS/2026/01",
  releasedOn: today(),
  note: "",
  ...overrides,
});

function release(
  by: Actor,
  cases: { id: string; version: number }[],
  overrides: Partial<Omit<DsReleaseInput, "form">> & { form?: Partial<Record<DsReleaseField, string>> } = {},
) {
  return recordDsRelease(db, by, {
    dsOfficeId: dsA.dsOfficeId!,
    cases: cases.map((c) => ({ id: c.id, version: c.version })),
    scanId: null,
    ...overrides,
    form: form(overrides.form),
  });
}

beforeAll(async () => {
  await seed(db);
  const officeA = await freeOfficeId(db);
  dsA = await account(actor("ds-release-test-a", "DS_OFFICER", "DS_CRPO", { dsOfficeId: officeA }), "ප. පළමු");
  const officeB = await freeOfficeId(db);
  dsB = await account(actor("ds-release-test-b", "DS_OFFICER", "DS_CRPO", { dsOfficeId: officeB }), "ප. දෙවන");
  districtA = (await db.dsOffice.findUniqueOrThrow({ where: { id: officeA } })).districtId;
  neighbour = (
    await db.dsOffice.findFirstOrThrow({
      where: { active: true, districtId: districtA, id: { not: officeA } },
      select: { id: true },
    })
  ).id;
  elsewhere = await db.dsOffice.findFirstOrThrow({
    where: { active: true, districtId: { not: districtA } },
    orderBy: { id: "asc" },
    select: { id: true, districtId: true },
  });
  ministry = await account(
    actor("ds-release-test-ministry", "MINISTRY_OFFICER", "MINISTRY_PROGRAMME_OFFICER"),
    "අ. පරීක්ෂණ",
  );
  crpo = await account(
    actor("ds-release-test-crpo", "DISTRICT_OFFICER", "DISTRICT_CRPO", { districtId: districtA }),
    "ද. පරීක්ෂණ",
  );
  secretary = await account(
    actor("ds-release-test-secretary", "VIEWER", "DISTRICT_SECRETARY", { districtId: districtA }),
    "ද. ලේකම්",
  );
  otherCrpo = await account(
    actor("ds-release-test-other-crpo", "DISTRICT_OFFICER", "DISTRICT_CRPO", { districtId: elsewhere.districtId }),
    "ද. වෙනත්",
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("the District's release to a DS office (REL-5 to REL-7, AC-53)", () => {
  it("releases the ticked cases with their installments, tells their DS, and leaves the others waiting", async () => {
    const first = await allocated({ letterDaysAgo: 3 });
    const second = await allocated({ letterDaysAgo: 2 });
    const left = await allocated();
    const waitingBefore = (await awaitingDsRelease(db, crpo)).count;

    // REL-5: the office waits with its three cases, the oldest letter shown; REL-6: its cases, oldest letter first.
    const office = (await dsOfficesWaiting(db, crpo, "si")).find((o) => o.id === dsA.dsOfficeId);
    expect(office).toMatchObject({ oldestLetter: daysAgo(3) });
    expect(office?.count).toBeGreaterThanOrEqual(3);
    const form = await casesForDsRelease(db, crpo, dsA.dsOfficeId!, "si");
    const order = form?.cases.map((c) => c.id).filter((id) => [first.id, second.id, left.id].includes(id));
    expect(order).toEqual([first.id, second.id, left.id]);
    expect(form?.cases.find((c) => c.id === first.id)).toMatchObject({
      letterNumber: "MWCA/DS/7",
      letterDate: daysAgo(3),
      residenceName: null,
    });

    const result = await release(crpo, [first, second], {
      form: { referenceNumber: " DS/2026/02 ", releasedOn: daysAgo(1), note: "පළමු මුදා හැරීම" },
    });
    expect(result).toMatchObject({ ok: true });
    const dsReleaseId = result.ok ? result.dsReleaseId : "";
    expect(await db.dsRelease.findUniqueOrThrow({ where: { id: dsReleaseId } })).toMatchObject({
      districtId: districtA,
      dsOfficeId: dsA.dsOfficeId,
      referenceNumber: "DS/2026/02",
      releasedOn: dayToDate(daysAgo(1)),
      note: "පළමු මුදා හැරීම",
      byId: crpo.userId,
    });
    for (const c of [first, second]) {
      expect((await load(c.id)).status).toBe("ALLOCATION_RECEIVED");
      expect(await db.release.findUniqueOrThrow({ where: { caseId: c.id } })).toMatchObject({
        dsReleaseId,
        dsReleasedOn: dayToDate(daysAgo(1)),
      });
      const installments = await db.installment.findMany({ where: { caseId: c.id }, orderBy: { number: "asc" } });
      expect(installments.map((i) => [i.number, i.amount, i.status])).toEqual([
        [1, 500_000, "NOT_STARTED"],
        [2, 500_000, "NOT_STARTED"],
        [3, 500_000, "NOT_STARTED"],
        [4, 500_000, "NOT_STARTED"],
      ]);
      expect(await db.notification.count({ where: { caseId: c.id, userId: dsA.userId, type: "RELEASED" } })).toBe(1);
      const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "case_ds_released" } });
      expect(audit).toMatchObject({ actorId: crpo.userId });
      expect(audit.after).toMatchObject({
        status: "ALLOCATION_RECEIVED",
        dsReleaseId,
        referenceNumber: "DS/2026/02",
        releasedOn: daysAgo(1),
        cases: 2,
      });
    }
    expect(await db.auditLog.count({ where: { entityId: dsReleaseId, action: "ds_release_recorded" } })).toBe(1);
    expect((await load(left.id)).status).toBe("ALLOCATED_TO_DISTRICT");
    expect((await awaitingDsRelease(db, crpo)).count).toBe(waitingBefore - 2);

    // REL-7: the case pages show the Ministry's letter and, under it, the District's release.
    const details = await getCase(db, dsA, first.id, "si");
    expect(details?.release?.dsRelease).toMatchObject({
      id: dsReleaseId,
      referenceNumber: "DS/2026/02",
      releasedOn: daysAgo(1),
      note: "පළමු මුදා හැරීම",
      cases: 2,
      latestLetter: daysAgo(2),
      scanId: null,
    });
    expect(details?.installments).toHaveLength(4);
    expect(details?.actsOn.release).toBe(false);
    expect((await getCase(db, crpo, first.id, "si"))?.actsOn.release).toBe(true);
    expect((await getCase(db, secretary, first.id, "si"))?.actsOn.release).toBe(false);
    const history = await caseHistory(db, dsA, first.id, "si");
    // The history names the district and office in the screen's language, from the release.
    expect(history?.find((e) => e.action === "case_ds_released")?.after).toMatchObject({
      referenceNumber: "DS/2026/02",
      office: details?.buildOfficeName,
      district: details?.buildDistrictName,
    });

    expect(await getDsRelease(db, crpo, dsReleaseId, "si")).toMatchObject({ count: 2, referenceNumber: "DS/2026/02" });
    expect((await recentDsReleases(db, crpo, "si"))[0]?.id).toBe(dsReleaseId);
    // Nobody else has the District's screen (REL-9).
    for (const other of [dsA, ministry, secretary, otherCrpo]) {
      expect(await getDsRelease(db, other, dsReleaseId, "si")).toBeNull();
      expect(await casesForDsRelease(db, other, dsA.dsOfficeId!, "si")).toBeNull();
      expect(await dsOfficesWaiting(db, other, "si")).not.toContainEqual(
        expect.objectContaining({ id: dsA.dsOfficeId }),
      );
    }
    expect((await awaitingDsRelease(db, ministry)).count).toBe(0);
  });

  it("refuses a missing reference, a future date and a date before a case's letter", async () => {
    const ready = await allocated({ letterDaysAgo: 5 });
    expect(await release(crpo, [ready], { form: { referenceNumber: "  " } })).toEqual({
      ok: false,
      error: null,
      errors: { referenceNumber: "referenceRequired" },
    });
    expect(await release(crpo, [ready], { form: { referenceNumber: "x".repeat(51) } })).toMatchObject({
      errors: { referenceNumber: "referenceTooLong" },
    });
    expect(await release(crpo, [ready], { form: { releasedOn: addDays(today(), 1) } })).toMatchObject({
      errors: { releasedOn: "releaseInFuture" },
    });
    expect(await release(crpo, [ready], { form: { releasedOn: daysAgo(6) } })).toMatchObject({
      errors: { releasedOn: "releaseBeforeLetter" },
    });
    expect(await release(crpo, [ready], { form: { releasedOn: daysAgo(5) } })).toMatchObject({ ok: true });
  });

  it("releases all or nothing, and refuses no case, another office, an old form and anyone but the district's CRPO (AC-54)", async () => {
    const ready = await allocated();
    const there = await allocated({ buildDsOfficeId: neighbour });
    const waiting = await saveCase(db, dsA, {
      id: randomUUID(),
      version: null,
      dsOfficeId: null,
      buildDsOfficeId: null,
      values: values(),
      documentIds: [],
    });
    if (!waiting.ok) throw new Error(waiting.error);
    const awaiting = await load(waiting.value.id);

    expect(await release(crpo, [])).toEqual({ ok: false, error: "noCases", errors: {} });
    // A case built in another DS office of the district can't go on this office's release.
    expect(await release(crpo, [ready, there])).toEqual({ ok: false, error: "notFound", errors: {} });
    expect(await release(crpo, [ready, awaiting])).toEqual({ ok: false, error: "notAllowedNow", errors: {} });
    expect(await release(crpo, [{ ...ready, version: ready.version - 1 }])).toEqual({
      ok: false,
      error: "conflict",
      errors: {},
    });
    expect(await release(secretary, [ready])).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await release(ministry, [ready])).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await release(dsA, [ready])).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await release(otherCrpo, [ready])).toEqual({ ok: false, error: "notFound", errors: {} });
    expect((await load(ready.id)).status).toBe("ALLOCATED_TO_DISTRICT");
    expect(await db.installment.count({ where: { caseId: ready.id } })).toBe(0);

    expect(await release(crpo, [ready])).toMatchObject({ ok: true });
    expect(await release(crpo, [ready])).toEqual({ ok: false, error: "notAllowedNow", errors: {} });
    expect(await db.installment.count({ where: { caseId: ready.id } })).toBe(4);
    expect(await release(crpo, [there], { dsOfficeId: neighbour })).toMatchObject({ ok: true });
  });

  it("is released by the district where it is built, while the district where the beneficiary lives only sees it (CASE-13, REL-9)", async () => {
    const built = await allocated({ buildDsOfficeId: elsewhere.id });
    const there = { dsOfficeId: elsewhere.id };
    expect((await getCase(db, crpo, built.id, "si"))?.actsOn.release).toBe(false);
    expect(await release(crpo, [built], there)).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect((await casesForDsRelease(db, otherCrpo, elsewhere.id, "si"))?.cases.map((c) => c.id)).toContain(built.id);
    expect(
      (await casesForDsRelease(db, otherCrpo, elsewhere.id, "si"))?.cases.find((c) => c.id === built.id),
    ).toMatchObject({
      residenceName: expect.any(String),
    });
    expect(await release(otherCrpo, [built], there)).toMatchObject({ ok: true });
    // Both DS offices hear of it (NTF-1).
    for (const officer of [dsA]) {
      expect(
        await db.notification.count({ where: { caseId: built.id, userId: officer.userId, type: "RELEASED" } }),
      ).toBe(1);
    }
  });

  it("keeps the CRPO's own scan with the release, which only those who see one of its cases may open", async () => {
    const ready = await allocated();
    const pdf = { name: "මුදා හැරීම.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n% test release\n") };
    expect(await uploadLetterScan(db, secretary, pdf)).toEqual({ ok: false, error: "notAllowed" });
    const theirs = await uploadLetterScan(db, otherCrpo, pdf);
    if (!theirs.ok) throw new Error(theirs.error);
    expect(await release(crpo, [ready], { scanId: theirs.value.id })).toEqual({
      ok: false,
      error: "scanUnavailable",
      errors: {},
    });
    expect((await load(ready.id)).status).toBe("ALLOCATED_TO_DISTRICT");

    const scan = await uploadLetterScan(db, crpo, pdf);
    if (!scan.ok) throw new Error(scan.error);
    const result = await release(crpo, [ready], { scanId: scan.value.id });
    expect(result).toMatchObject({ ok: true });
    expect(await db.storedFile.findUniqueOrThrow({ where: { id: scan.value.id } })).toMatchObject({
      kind: "LETTER",
      dsReleaseId: result.ok ? result.dsReleaseId : "",
      letterId: null,
      caseId: null,
    });
    expect((await getCase(db, dsA, ready.id, "si"))?.release?.dsRelease?.scanId).toBe(scan.value.id);
    for (const viewer of [dsA, crpo, secretary, ministry]) {
      expect(await fileForViewer(db, viewer, scan.value.id), viewer.userId).not.toBeNull();
    }
    expect(await fileForViewer(db, dsB, scan.value.id)).toBeNull();
    expect(await fileForViewer(db, otherCrpo, scan.value.id)).toBeNull();
  });
});

describe("correcting a District release (REL-8, AC-57)", () => {
  it("changes it for every case on it, logging the old and new value on each", async () => {
    const first = await allocated({ letterDaysAgo: 10 });
    const second = await allocated({ letterDaysAgo: 9 });
    const result = await release(crpo, [first, second], { form: { releasedOn: daysAgo(8) } });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const version = (await load(first.id)).version;
    const correct = (by: Actor, fields: Partial<Record<DsReleaseField, string>>, v = version) =>
      correctDsRelease(db, by, { caseId: first.id, version: v, form: form({ releasedOn: daysAgo(8), ...fields }) });

    expect(await correct(dsA, {})).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await correct(ministry, {})).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await correct(secretary, {})).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await correct(otherCrpo, {})).toEqual({ ok: false, error: "notFound", errors: {} });
    expect(await correct(crpo, { releasedOn: daysAgo(10) })).toEqual({
      ok: false,
      error: null,
      errors: { releasedOn: "releaseBeforeLetter" },
    });
    expect(await correct(crpo, {}, version - 1)).toEqual({ ok: false, error: "conflict", errors: {} });
    // Nothing changed: nothing is written.
    expect(await correct(crpo, {})).toEqual({ ok: true });

    expect(await correct(crpo, { referenceNumber: "DS/2026/09", releasedOn: daysAgo(7) })).toEqual({ ok: true });
    expect(await db.dsRelease.findUniqueOrThrow({ where: { id: result.dsReleaseId } })).toMatchObject({
      referenceNumber: "DS/2026/09",
      releasedOn: dayToDate(daysAgo(7)),
    });
    for (const c of [first, second]) {
      expect((await db.release.findUniqueOrThrow({ where: { caseId: c.id } })).dsReleasedOn).toEqual(
        dayToDate(daysAgo(7)),
      );
      const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "ds_release_corrected" } });
      expect(audit).toMatchObject({
        actorId: crpo.userId,
        before: { referenceNumber: "DS/2026/01", releasedOn: daysAgo(8) },
        after: { referenceNumber: "DS/2026/09", releasedOn: daysAgo(7) },
      });
    }
    // The case changed, so a form opened before the correction is refused.
    expect(await correct(crpo, { note: "පසුව" })).toEqual({ ok: false, error: "conflict", errors: {} });

    // REL-4: the Ministry's letter can't move after the District's release.
    const letterVersion = (await load(first.id)).version;
    expect(
      await correctRelease(db, ministry, {
        caseId: first.id,
        version: letterVersion,
        form: { letterNumber: "MWCA/DS/7", letterDate: daysAgo(6), validUntil: "2099-12-31", note: "" },
      }),
    ).toEqual({ ok: false, error: null, errors: { letterDate: "dateAfterDsRelease" } });
  });

  it("can't move past an installment or a stage already recorded on one of its cases", async () => {
    const paid = await allocated({ letterDaysAgo: 20 });
    const visited = await allocated({ letterDaysAgo: 20 });
    const result = await release(crpo, [paid, visited], { form: { releasedOn: daysAgo(15) } });
    if (!result.ok) throw new Error(JSON.stringify(result));
    await db.installment.updateMany({
      where: { caseId: paid.id, number: 1 },
      data: { status: "PROCESSING", expectedOn: dayToDate(daysAgo(10)) },
    });
    const correct = async (releasedOn: string) =>
      correctDsRelease(db, crpo, {
        caseId: visited.id,
        version: (await load(visited.id)).version,
        form: form({ releasedOn }),
      });

    expect(await correct(daysAgo(9))).toEqual({
      ok: false,
      error: null,
      errors: { releasedOn: "releaseAfterInstallment" },
    });
    expect(await correct(daysAgo(10))).toEqual({ ok: true });

    // A stage can be recorded as soon as the allocation is received (STG-5).
    const stage = await recordStageUpdate(db, dsA, {
      caseId: visited.id,
      version: (await load(visited.id)).version,
      form: { stageId: NOTE_ONLY, visitedOn: daysAgo(10), note: "පරීක්ෂණ සංචාරය" },
      photoIds: [],
    });
    expect(stage).toMatchObject({ ok: true });
    await db.installment.updateMany({
      where: { caseId: paid.id, number: 1 },
      data: { expectedOn: dayToDate(daysAgo(5)) },
    });
    expect(await correct(daysAgo(9))).toEqual({ ok: false, error: null, errors: { releasedOn: "releaseAfterStage" } });

    const notYet = await allocated();
    expect(await correctDsRelease(db, crpo, { caseId: notYet.id, version: notYet.version, form: form() })).toEqual({
      ok: false,
      error: "noDsRelease",
      errors: {},
    });
  });
});

describe("the District officer's notifications (NTF-1)", () => {
  it("names each Ministry letter and how many cases it allocates, and opens the release screen", async () => {
    const first = await allocated();
    const notices = (await listNotifications(db, crpo)).filter((n) => n.caseId === first.id);
    expect(notices.map((n) => [n.type, n.letter])).toEqual([["DISTRICT_LETTER", { number: "MWCA/DS/7", count: 1 }]]);
    expect(await openNotification(db, crpo, notices[0]!.id)).toEqual({ caseId: first.id, type: "DISTRICT_LETTER" });
    expect(await openNotification(db, secretary, notices[0]!.id)).toBeNull();
    // The DS officer's own notices name no letter.
    expect((await listNotifications(db, dsA)).find((n) => n.caseId === first.id)?.letter).toBeNull();
  });
});
