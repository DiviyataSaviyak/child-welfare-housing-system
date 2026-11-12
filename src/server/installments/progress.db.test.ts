import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId, testApplicationNumber, CARE_LEAVER_DETAILS } from "../../../tests/db/client";
import { addDays, colomboDay, colomboStartOf, dayToDate } from "@/lib/dates";
import type { CaseValues } from "@/lib/validation/case";
import { NOTE_ONLY } from "@/lib/validation/progress";
import { type Actor, saveCase, type SaveCaseInput } from "../cases/commands";
import { getCase, listCases, officeMoney, todoItems } from "../cases/queries";
import { readStoredFile } from "../files/storage";
import { fileForViewer, uploadPhoto } from "../files/uploads";
import { caseHistory } from "../history/queries";
import { recordLetter } from "../releases/commands";
import { releaseToDsForTests } from "../../../tests/db/ds-release";
import { recordStageUpdate } from "../stages/commands";
import { getStageProgress } from "../stages/queries";
import { markInstallmentPaid, startInstallment, undoInstallmentPayment } from "./commands";

const filesDir = mkdtempSync(join(tmpdir(), "diviyata-progress-"));
process.env.FILES_DIR = filesDir;

const db = createTestClient();

let dsA: Actor;
let dsB: Actor;
let ho: Actor;
const admin: Actor = {
  userId: "progress-test-admin",
  role: "ADMIN",
  designation: null,
  districtId: null,
  provinceId: null,
  dsOfficeId: null,
};

const today = () => colomboDay(new Date());
const daysAgo = (days: number) => addDays(today(), -days);
/**
 * Every case's District release is 50 days ago, so each test has room for earlier and later days. The
 * Ministry's letter is 5 days before it, so a day between them shows which one the date rules read.
 */
const RELEASED_DAYS_AGO = 50;
const LETTER_DAYS_AGO = RELEASED_DAYS_AGO + 5;

let nicCounter = 0;
/** A made-up NIC (SEC-11), different for every case so the tests don't match each other. */
const nextNic = () => `2003${String(++nicCounter).padStart(8, "0")}`;

const values = (overrides: Partial<CaseValues> = {}): CaseValues => ({
  ...CARE_LEAVER_DETAILS,
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
  applicationNumber: testApplicationNumber(),
  childName: null,
  name: "ප්‍රගති පරීක්ෂණ",
  nic: nextNic(),
  address: "නො. 3, පරීක්ෂණ පාර",
  gnDivision: null,
  mobile1: "0710000003",
  mobile2: null,
  remark: null,
  ...overrides,
});

const load = (id: string) => db.case.findUniqueOrThrow({ where: { id } });

/** A case of dsA's office awaiting its allocation, entered 60 days ago so the letter can be earlier than today. */
async function awaiting(overrides: Partial<CaseValues> = {}) {
  const input: SaveCaseInput = {
    id: randomUUID(),
    version: null,
    dsOfficeId: null,
    buildDsOfficeId: null,
    values: values(overrides),
    documentIds: [],
  };
  const saved = await saveCase(db, dsA, input);
  if (!saved.ok) throw new Error(saved.error);
  await db.case.update({ where: { id: saved.value.id }, data: { createdAt: colomboStartOf(daysAgo(60)) } });
  return load(saved.value.id);
}

/** A case awaiting its allocation, then allocated to its district by the Ministry's letter 55 days ago. */
async function allocated(overrides: Partial<CaseValues> = {}) {
  const ready = await awaiting(overrides);
  const { districtId } = await db.dsOffice.findUniqueOrThrow({ where: { id: ready.dsOfficeId } });
  const release = await recordLetter(db, ho, {
    districtId,
    cases: [{ id: ready.id, version: ready.version }],
    form: { letterNumber: "MWCA/2026/P6", letterDate: daysAgo(LETTER_DAYS_AGO), validUntil: "2099-12-31", note: "" },
    scanId: null,
  });
  if (!release.ok) throw new Error(String(release.error ?? JSON.stringify(release.errors)));
  return load(ready.id);
}

/**
 * A case whose allocation its DS received: allocated, then released by the District 50 days ago, with its
 * four installments not started. Paying installment 1 moves it on to in progress (INS-5).
 */
async function running(overrides: Partial<CaseValues> = {}) {
  const ready = await allocated(overrides);
  await releaseToDsForTests(db, [ready.id], { on: dayToDate(daysAgo(RELEASED_DAYS_AGO)) });
  return load(ready.id);
}

const version = async (id: string) => (await load(id)).version;

function start(actor: Actor, caseId: string, caseVersion: number, number: number, expectedOn = daysAgo(40)) {
  return startInstallment(db, actor, {
    caseId,
    version: caseVersion,
    number,
    form: { expectedOn, purpose: "", note: "" },
  });
}

function pay(actor: Actor, caseId: string, caseVersion: number, number: number, releasedOn = daysAgo(30)) {
  return markInstallmentPaid(db, actor, { caseId, version: caseVersion, number, form: { releasedOn, note: "" } });
}

/** Starts and pays one installment as the office, on the given day. */
async function payNext(caseId: string, number: number, day = daysAgo(30)) {
  const started = await start(dsA, caseId, await version(caseId), number, day);
  if (!started.ok) throw new Error(JSON.stringify(started));
  const paid = await pay(dsA, caseId, await version(caseId), number, day);
  if (!paid.ok) throw new Error(JSON.stringify(paid));
  return paid;
}

function stage(
  caseId: string,
  caseVersion: number,
  stageId: number | null,
  visitedOn = daysAgo(20),
  photoIds: string[] = [],
) {
  return recordStageUpdate(db, dsA, {
    caseId,
    version: caseVersion,
    form: { stageId: stageId === null ? NOTE_ONLY : String(stageId), visitedOn, note: "" },
    photoIds,
  });
}

/** The active new-house stages, in order, as the admin has left them. */
async function newHouseStages() {
  return db.stageDefinition.findMany({
    where: { kind: "NEW_HOUSE", active: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, nameSi: true, nameTa: true, nameEn: true },
  });
}

async function officer(id: string): Promise<Actor> {
  const dsOfficeId = await freeOfficeId(db);
  await db.user.create({
    data: {
      id,
      name: "ප්‍රා. පරීක්ෂණ",
      email: `${id}@no-email.invalid`,
      role: "DS_OFFICER",
      designation: "DS_CRPO",
      dsOfficeId,
    },
  });
  return { userId: id, role: "DS_OFFICER", designation: "DS_CRPO", districtId: null, provinceId: null, dsOfficeId };
}

/** A made-up phone photo with a GPS position in its metadata (AC-16). */
function photoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#8a6b4f" } })
    .jpeg()
    .withExifMerge({
      IFD0: { Make: "ProgressTestPhone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "6/1 54/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "79/1 51/1 0/1" },
    })
    .toBuffer();
}

beforeAll(async () => {
  await seed(db);
  dsA = await officer("progress-test-ds-a");
  dsB = await officer("progress-test-ds-b");
  await db.user.create({
    data: {
      id: "progress-test-ho",
      name: "ප්‍ර. පරීක්ෂණ",
      email: "progress-test-ho@no-email.invalid",
      role: "MINISTRY_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
    },
  });
  ho = {
    userId: "progress-test-ho",
    role: "MINISTRY_OFFICER",
    designation: "MINISTRY_PROGRAMME_OFFICER",
    districtId: null,
    provinceId: null,
    dsOfficeId: null,
  };
  await db.user.create({
    data: { id: admin.userId, name: "පරිපාලක", email: "progress-test-admin@no-email.invalid", role: "ADMIN" },
  });
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe("installments (INS-1 to INS-6)", () => {
  it("lets only the next installment change, even through a direct call to the server (AC-11, ERR-7)", async () => {
    const c = await running();
    expect(await start(dsA, c.id, c.version, 2)).toMatchObject({ ok: false, error: "notNext" });
    expect(await pay(dsA, c.id, c.version, 1)).toMatchObject({ ok: false, error: "notStartedYet" });
    expect(await start(dsA, c.id, c.version, 5)).toMatchObject({ ok: false, error: "notFound" });

    await payNext(c.id, 1, daysAgo(35));
    const v = await version(c.id);
    expect(await start(dsA, c.id, v, 1)).toMatchObject({ ok: false, error: "alreadyPaid" });
    expect(await start(dsA, c.id, v, 3)).toMatchObject({ ok: false, error: "notNext" });
    expect(await start(dsA, c.id, v, 2)).toMatchObject({ ok: true });
    // Installment 3 can't change while installment 2 is under way but not released.
    const v2 = await version(c.id);
    expect(await start(dsA, c.id, v2, 3)).toMatchObject({ ok: false, error: "notNext" });
    expect(await pay(dsA, c.id, v2, 3)).toMatchObject({ ok: false, error: "notNext" });

    const list = await db.installment.findMany({ where: { caseId: c.id }, orderBy: { number: "asc" } });
    expect(list.map((i) => i.status)).toEqual(["RELEASED", "PROCESSING", "NOT_STARTED", "NOT_STARTED"]);
  });

  it("keeps the dates in order: expected and paid on or after the District's release, paid no later than today and after the previous one (INS-3, INS-4)", async () => {
    const c = await running();
    expect(await start(dsA, c.id, c.version, 1, daysAgo(RELEASED_DAYS_AGO + 1))).toMatchObject({
      ok: false,
      errors: { expectedOn: "dateBeforeRelease" },
    });
    // The expected day may be in the future.
    expect(await start(dsA, c.id, c.version, 1, addDays(today(), 10))).toMatchObject({ ok: true });
    const v = await version(c.id);
    expect(await pay(dsA, c.id, v, 1, addDays(today(), 1))).toMatchObject({ errors: { releasedOn: "dateInFuture" } });
    expect(await pay(dsA, c.id, v, 1, daysAgo(RELEASED_DAYS_AGO + 1))).toMatchObject({
      errors: { releasedOn: "dateBeforeRelease" },
    });
    expect(await pay(dsA, c.id, v, 1, daysAgo(20))).toMatchObject({ ok: true, completed: false });

    expect(await start(dsA, c.id, await version(c.id), 2, daysAgo(25))).toMatchObject({ ok: true });
    expect(await pay(dsA, c.id, await version(c.id), 2, daysAgo(21))).toMatchObject({
      errors: { releasedOn: "dateBeforePrevious" },
    });
    expect(await pay(dsA, c.id, await version(c.id), 2, daysAgo(20))).toMatchObject({ ok: true });
  });

  it("is the case's own office's to change: another office finds nothing, the Ministry and the admin may not", async () => {
    const c = await running();
    expect(await start(dsB, c.id, c.version, 1)).toMatchObject({ ok: false, error: "notFound" });
    expect(await start(ho, c.id, c.version, 1)).toMatchObject({ ok: false, error: "roleNotAllowed" });
    expect(await start(admin, c.id, c.version, 1)).toMatchObject({ ok: false, error: "notFound" });
  });

  it("refuses a form opened before someone else's change (CASE-10)", async () => {
    const c = await running();
    expect(await start(dsA, c.id, c.version, 1)).toMatchObject({ ok: true });
    // The same form sent again, for example after a network drop, changes nothing (ERR-8).
    expect(await start(dsA, c.id, c.version, 1)).toMatchObject({ ok: false, error: "alreadyStarted" });
    expect(await pay(dsA, c.id, c.version, 1)).toMatchObject({ ok: false, error: "conflict" });
  });

  it("lets the Ministry move the most recently paid installment back, with a reason (INS-6)", async () => {
    const c = await running();
    await payNext(c.id, 1, daysAgo(35));
    await payNext(c.id, 2, daysAgo(30));
    const undo = async (actor: Actor, number: number, reason: string) =>
      undoInstallmentPayment(db, actor, { caseId: c.id, version: await version(c.id), number, reason });

    expect(await undo(dsA, 2, "වැරදි දිනයක් යෙදුවා")).toMatchObject({ ok: false, error: "roleNotAllowed" });
    expect(await undo(ho, 2, "")).toMatchObject({ ok: false, error: "reasonRequired" });
    expect(await undo(ho, 1, "වැරදි දිනයක් යෙදුවා")).toMatchObject({ ok: false, error: "conflict" });
    expect(await undo(ho, 2, "වැරදි දිනයක් යෙදුවා")).toMatchObject({ ok: true });

    const second = await db.installment.findFirstOrThrow({ where: { caseId: c.id, number: 2 } });
    expect(second).toMatchObject({ status: "PROCESSING", releasedOn: null });
    expect(second.expectedOn).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "installment_payment_undone" } });
    expect(audit).toMatchObject({ actorId: ho.userId, after: { number: 2, reason: "වැරදි දිනයක් යෙදුවා" } });
    // The office pays it again, on the right day.
    expect(await pay(dsA, c.id, await version(c.id), 2, daysAgo(29))).toMatchObject({ ok: true });
  });
});

describe("the case's status as it is paid (STS-1, INS-5, INS-6, STG-5, AC-55)", () => {
  it("takes no installment or stage while the case awaits its allocation or is released to the district", async () => {
    const [first] = await newHouseStages();
    for (const c of [await awaiting(), await allocated()]) {
      expect(await start(dsA, c.id, c.version, 1)).toMatchObject({ ok: false, error: "caseNotRunning" });
      expect(await pay(dsA, c.id, c.version, 1)).toMatchObject({ ok: false, error: "caseNotRunning" });
      expect(await stage(c.id, c.version, first!.id)).toMatchObject({ ok: false, error: "caseNotRunning" });
      expect(await stage(c.id, c.version, null)).toMatchObject({ ok: false, error: "caseNotRunning" });
      expect(await load(c.id)).toMatchObject({ status: c.status, version: c.version });
    }
  });

  it("moves to in progress when installment 1 is paid, and back when the Ministry undoes that payment", async () => {
    const c = await running();
    expect(c.status).toBe("ALLOCATION_RECEIVED");
    // Starting the payment and recording a stage leave the status as it is; nothing is paid to undo.
    expect(await start(dsA, c.id, c.version, 1, daysAgo(40))).toMatchObject({ ok: true });
    expect(await stage(c.id, await version(c.id), null, daysAgo(40))).toMatchObject({ ok: true });
    expect((await load(c.id)).status).toBe("ALLOCATION_RECEIVED");
    const undo = async (number: number) =>
      undoInstallmentPayment(db, ho, { caseId: c.id, version: await version(c.id), number, reason: "වැරදි දිනයක්" });
    expect(await undo(1)).toMatchObject({ ok: false, error: "nothingToUndo" });

    expect(await pay(dsA, c.id, await version(c.id), 1, daysAgo(35))).toEqual({ ok: true, completed: false });
    expect((await load(c.id)).status).toBe("IN_PROGRESS");
    const started = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "case_started" } });
    expect(started).toMatchObject({
      actorId: null,
      before: { status: "ALLOCATION_RECEIVED" },
      after: { status: "IN_PROGRESS" },
    });

    // Undoing a later installment leaves it in progress; undoing installment 1 moves it back.
    await payNext(c.id, 2, daysAgo(30));
    expect(await undo(2)).toMatchObject({ ok: true });
    expect((await load(c.id)).status).toBe("IN_PROGRESS");
    expect(await undo(1)).toMatchObject({ ok: true });
    expect((await load(c.id)).status).toBe("ALLOCATION_RECEIVED");
    const unstarted = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "case_unstarted" } });
    expect(unstarted).toMatchObject({
      actorId: null,
      before: { status: "IN_PROGRESS" },
      after: { status: "ALLOCATION_RECEIVED" },
    });

    // Paid again, it moves on again.
    expect(await pay(dsA, c.id, await version(c.id), 1, daysAgo(34))).toMatchObject({ ok: true });
    expect((await load(c.id)).status).toBe("IN_PROGRESS");
  });
});

describe("building progress (STG-1 to STG-5)", () => {
  it("marks the stages a later choice skips as reached on the same day (STG-2, AC-12)", async () => {
    const c = await running();
    const stages = await newHouseStages();
    const third = stages[2]!;
    expect(await stage(c.id, c.version, third.id, daysAgo(20))).toEqual({ ok: true, completed: false });

    const rows = await db.stageUpdate.findMany({ where: { caseId: c.id }, orderBy: { at: "asc" } });
    expect(rows.map((r) => r.stageId)).toEqual(stages.slice(0, 3).map((s) => s.id));
    expect(new Set(rows.map((r) => r.visitedOn.toISOString()))).toEqual(
      new Set([dayToDate(daysAgo(20)).toISOString()]),
    );

    const progress = await getStageProgress(db, c.id, "NEW_HOUSE", "si");
    expect(progress.current).toEqual({ id: third.id, reachedOn: daysAgo(20) });
    expect(progress.choices.map((s) => s.id)).toEqual(stages.slice(3).map((s) => s.id));
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "stage_updated" } });
    expect(audit.after).toMatchObject({ stages: stages.slice(0, 3).map((s) => s.nameSi), visitedOn: daysAgo(20) });

    // An installment can be released at any stage (INS-5).
    expect(await payNext(c.id, 1, daysAgo(10))).toMatchObject({ ok: true });
  });

  it("needs a later stage, a day within its limits, or a note-only visit (STG-1)", async () => {
    const c = await running();
    const stages = await newHouseStages();
    expect(await stage(c.id, c.version, stages[1]!.id, daysAgo(20))).toMatchObject({ ok: true });
    const v = await version(c.id);
    expect(await stage(c.id, v, stages[0]!.id)).toMatchObject({ ok: false, errors: { stageId: "stageNotLater" } });
    expect(await stage(c.id, v, stages[1]!.id)).toMatchObject({ ok: false, errors: { stageId: "stageNotLater" } });
    expect(await stage(c.id, v, stages[2]!.id, daysAgo(21))).toMatchObject({
      errors: { visitedOn: "dateBeforeStage" },
    });
    expect(await stage(c.id, v, stages[2]!.id, addDays(today(), 1))).toMatchObject({
      errors: { visitedOn: "dateInFuture" },
    });
    // A note-only visit may be earlier than the current stage, but not before the release.
    expect(await stage(c.id, v, null, daysAgo(RELEASED_DAYS_AGO + 1))).toMatchObject({
      errors: { visitedOn: "dateBeforeRelease" },
    });
    expect(await stage(c.id, v, null, daysAgo(30))).toEqual({ ok: true, completed: false });
    const progress = await getStageProgress(db, c.id, "NEW_HOUSE", "si");
    expect(progress.visits).toHaveLength(1);
    expect(progress.current?.id).toBe(stages[1]!.id);
  });

  it("takes only note-only updates for a kind with no active stages (STG-4)", async () => {
    // Other test files may leave renovation stages behind; set them aside for this test, then put them back.
    const active = await db.stageDefinition.findMany({
      where: { kind: "RENOVATION", active: true },
      select: { id: true },
    });
    await db.stageDefinition.updateMany({ where: { id: { in: active.map((s) => s.id) } }, data: { active: false } });
    try {
      const c = await running({ kind: "RENOVATION" });
      const progress = await getStageProgress(db, c.id, "RENOVATION", "si");
      expect(progress.choices).toEqual([]);
      const [anyStage] = await newHouseStages();
      expect(await stage(c.id, c.version, anyStage!.id)).toMatchObject({ errors: { stageId: "stageNotLater" } });
      expect(await stage(c.id, c.version, null)).toMatchObject({ ok: true });
    } finally {
      await db.stageDefinition.updateMany({ where: { id: { in: active.map((s) => s.id) } }, data: { active: true } });
    }
  });

  it("is the office's to record, and only once the allocation is received (STG-5)", async () => {
    const c = await running();
    const [first] = await newHouseStages();
    expect(
      await recordStageUpdate(db, ho, {
        caseId: c.id,
        version: c.version,
        form: { stageId: String(first!.id), visitedOn: today(), note: "" },
        photoIds: [],
      }),
    ).toMatchObject({ ok: false, error: "roleNotAllowed" });
    expect(
      await recordStageUpdate(db, dsB, {
        caseId: c.id,
        version: c.version,
        form: { stageId: String(first!.id), visitedOn: today(), note: "" },
        photoIds: [],
      }),
    ).toMatchObject({ ok: false, error: "notFound" });

    const saved = await saveCase(db, dsA, {
      id: randomUUID(),
      version: null,
      dsOfficeId: null,
      buildDsOfficeId: null,
      values: values(),
      documentIds: [],
    });
    if (!saved.ok) throw new Error(saved.error);
    expect(await stage(saved.value.id, await version(saved.value.id), first!.id)).toMatchObject({
      ok: false,
      error: "caseNotRunning",
    });
  });

  it("stores a photo without its GPS position, and opens it only for those who may see the case (STG-3, AC-16)", async () => {
    const c = await running();
    const uploaded = await uploadPhoto(db, dsA, { name: "IMG_0001.png", bytes: await photoWithGps() });
    if (!uploaded.ok) throw new Error(uploaded.error);
    expect(uploaded.value.name).toBe("IMG_0001.jpg");

    // Until the update is saved, only the officer who uploaded it can open it.
    expect(await fileForViewer(db, dsA, uploaded.value.id)).not.toBeNull();
    expect(await fileForViewer(db, { ...ho }, uploaded.value.id)).toBeNull();

    const [first] = await newHouseStages();
    expect(await stage(c.id, c.version, first!.id, daysAgo(5), [uploaded.value.id])).toMatchObject({ ok: true });

    const row = await db.storedFile.findUniqueOrThrow({ where: { id: uploaded.value.id } });
    expect(row).toMatchObject({ kind: "PHOTO", caseId: c.id, mimeType: "image/jpeg" });
    expect(row.stageUpdateId).not.toBeNull();
    for (const name of [row.storedName, row.thumbName!]) {
      const stored = await readStoredFile(name);
      const meta = await sharp(stored).metadata();
      expect(meta.exif).toBeUndefined();
      expect(stored.includes(Buffer.from("ProgressTestPhone"))).toBe(false);
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600);
    }

    expect(await fileForViewer(db, dsA, row.id)).not.toBeNull();
    expect(await fileForViewer(db, ho, row.id, "thumb")).toMatchObject({ storedName: row.thumbName });
    expect(await fileForViewer(db, dsB, row.id)).toBeNull();
    expect(await fileForViewer(db, dsB, row.id, "thumb")).toBeNull();
    expect(await fileForViewer(db, admin, row.id)).toBeNull();
    const progress = await getStageProgress(db, c.id, "NEW_HOUSE", "si");
    expect(progress.stages[0]?.photos).toEqual([{ id: row.id, name: "IMG_0001.jpg" }]);
    // A photo is not one of the case's documents.
    expect((await getCase(db, dsA, c.id, "si"))?.documents).toEqual([]);
  });

  it("attaches only the officer's own new photos, never a document, and at most 10", async () => {
    const c = await running();
    const theirs = await uploadPhoto(
      db,
      { ...dsA, userId: dsB.userId, dsOfficeId: dsB.dsOfficeId },
      {
        name: "b.jpg",
        bytes: await photoWithGps(),
      },
    );
    if (!theirs.ok) throw new Error(theirs.error);
    expect(await stage(c.id, c.version, null, today(), [theirs.value.id])).toMatchObject({
      ok: false,
      error: "photoUnavailable",
    });
    expect(
      await stage(
        c.id,
        c.version,
        null,
        today(),
        Array.from({ length: 11 }, () => randomUUID()),
      ),
    ).toMatchObject({
      ok: false,
      error: "tooManyPhotos",
    });
    expect(await uploadPhoto(db, ho, { name: "x.jpg", bytes: await photoWithGps() })).toEqual({
      ok: false,
      error: "notAllowed",
    });
    expect(
      await uploadPhoto(db, dsA, { name: "x.pdf", bytes: new TextEncoder().encode("%PDF-1.7 not a photo") }),
    ).toEqual({
      ok: false,
      error: "fileType",
    });
  });
});

describe("completing a case (CLS-1, AC-13)", () => {
  it("finishes when installment 4 is paid after the last stage is reached, and tells the office", async () => {
    const c = await running();
    const stages = await newHouseStages();
    expect(await stage(c.id, c.version, stages.at(-1)!.id, daysAgo(40))).toEqual({ ok: true, completed: false });
    for (const number of [1, 2, 3]) await payNext(c.id, number, daysAgo(30 - number));
    expect((await load(c.id)).status).toBe("IN_PROGRESS");

    expect(await start(dsA, c.id, await version(c.id), 4, daysAgo(5))).toMatchObject({ ok: true });
    expect(await pay(dsA, c.id, await version(c.id), 4, daysAgo(5))).toEqual({ ok: true, completed: true });
    const done = await load(c.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "case_completed" } });
    expect(audit).toMatchObject({ actorId: null, before: { status: "IN_PROGRESS" }, after: { status: "COMPLETED" } });
    expect(await db.notification.count({ where: { caseId: c.id, userId: dsA.userId, type: "COMPLETED" } })).toBe(1);

    // A finished case takes no more changes (STS-2).
    expect(await stage(c.id, await version(c.id), null)).toMatchObject({ ok: false, error: "caseNotRunning" });
    const undo = await undoInstallmentPayment(db, ho, {
      caseId: c.id,
      version: await version(c.id),
      number: 4,
      reason: "පරීක්ෂා කිරීමට",
    });
    expect(undo).toMatchObject({ ok: false, error: "caseNotRunning" });
  });

  it("finishes when the last stage is reached after installment 4 is paid", async () => {
    const c = await running();
    for (const number of [1, 2, 3, 4]) await payNext(c.id, number, daysAgo(40 - number));
    expect((await load(c.id)).status).toBe("IN_PROGRESS");
    const stages = await newHouseStages();
    expect(await stage(c.id, await version(c.id), stages.at(-2)!.id, daysAgo(10))).toEqual({
      ok: true,
      completed: false,
    });
    expect(await stage(c.id, await version(c.id), null, daysAgo(5))).toEqual({ ok: true, completed: false });
    expect(await stage(c.id, await version(c.id), stages.at(-1)!.id, daysAgo(2))).toEqual({
      ok: true,
      completed: true,
    });
    expect((await load(c.id)).status).toBe("COMPLETED");
  });

  it("needs only installment 4 for a kind with no active stages", async () => {
    const active = await db.stageDefinition.findMany({
      where: { kind: "RENOVATION", active: true },
      select: { id: true },
    });
    await db.stageDefinition.updateMany({ where: { id: { in: active.map((s) => s.id) } }, data: { active: false } });
    try {
      const c = await running({ kind: "RENOVATION" });
      for (const number of [1, 2, 3]) await payNext(c.id, number, daysAgo(40 - number));
      expect(await payNext(c.id, 4, daysAgo(30))).toEqual({ ok: true, completed: true });
    } finally {
      await db.stageDefinition.updateMany({ where: { id: { in: active.map((s) => s.id) } }, data: { active: true } });
    }
  });
});

describe("the Ministry's edits to a running case (CASE-9)", () => {
  it("can change the kind of help only until a stage is recorded", async () => {
    const c = await running();
    const details = { ...values(), nic: (await load(c.id)).nic };
    const edit = async (kind: "NEW_HOUSE" | "RENOVATION") =>
      saveCase(db, ho, {
        id: c.id,
        version: await version(c.id),
        dsOfficeId: null,
        buildDsOfficeId: null,
        values: { ...details, kind },
        documentIds: [],
      });
    expect(await edit("RENOVATION")).toMatchObject({ ok: true });
    expect(await edit("NEW_HOUSE")).toMatchObject({ ok: true });
    // A note-only visit doesn't fix the kind; a stage does.
    expect(await stage(c.id, await version(c.id), null)).toMatchObject({ ok: true });
    expect(await edit("RENOVATION")).toMatchObject({ ok: true });
    expect(await edit("NEW_HOUSE")).toMatchObject({ ok: true });
    const [first] = await newHouseStages();
    expect(await stage(c.id, await version(c.id), first!.id)).toMatchObject({ ok: true });
    expect(await edit("RENOVATION")).toEqual({ ok: false, error: "kindLocked" });
    expect(await edit("NEW_HOUSE")).toMatchObject({ ok: true });
  });
});

describe("the case history (HIS-1 to HIS-3, AC-15)", () => {
  it("shows every change, newest first, with who made it and when; the system's own step has no person", async () => {
    const c = await running();
    const stages = await newHouseStages();
    await stage(c.id, c.version, stages.at(-1)!.id, daysAgo(45));
    for (const number of [1, 2, 3, 4]) await payNext(c.id, number, daysAgo(40 - number));

    const history = await caseHistory(db, ho, c.id, "si");
    expect(history?.map((e) => e.action)).toEqual([
      "case_completed",
      "installment_paid",
      "installment_started",
      "installment_paid",
      "installment_started",
      "installment_paid",
      "installment_started",
      "case_started",
      "installment_paid",
      "installment_started",
      "stage_updated",
      "case_ds_released",
      "case_allocated",
      "case_created",
    ]);
    expect(history?.[0]).toMatchObject({ actor: null });
    expect(history?.[1]).toMatchObject({ actor: { name: "ප්‍රා. පරීක්ෂණ", role: "DS_OFFICER" }, after: { number: 4 } });
    expect(history?.find((e) => e.action === "case_allocated")).toMatchObject({ actor: { role: "MINISTRY_OFFICER" } });
    expect(history?.find((e) => e.action === "case_ds_released")).toMatchObject({
      actor: { role: "DISTRICT_OFFICER" },
    });
    expect(history?.every((e) => e.at instanceof Date)).toBe(true);

    expect(await caseHistory(db, dsB, c.id, "si")).toBeNull();
    expect(await caseHistory(db, admin, c.id, "si")).toBeNull();
    // The database refuses any change to the record (HIS-3).
    const row = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "case_completed" } });
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});

describe("an account with no name in the case history (ADM-10, AC-40)", () => {
  it("shows its designation and office instead", async () => {
    const c = await running();
    const office = await db.dsOffice.findUniqueOrThrow({ where: { id: c.dsOfficeId } });
    const nameless = await db.user.create({
      data: {
        id: randomUUID(),
        name: "",
        email: `${randomUUID()}@no-email.invalid`,
        username: "ds9310",
        role: "DS_OFFICER",
        designation: "DS_CRPO",
        dsOfficeId: c.dsOfficeId,
      },
    });
    await db.auditLog.create({
      data: {
        actorId: nameless.id,
        action: "stage_updated",
        entityType: "stage_update",
        entityId: randomUUID(),
        caseId: c.id,
        before: { stageId: null },
        after: { stageIds: [], visitedOn: daysAgo(1), note: "බැලුවා", photos: [] },
      },
    });
    const [latest] = (await caseHistory(db, ho, c.id, "en")) ?? [];
    expect(latest.actor).toEqual({ name: `${en.users.designations.DS_CRPO}, ${office.nameEn}`, role: "DS_OFFICER" });
  });
});

describe("the case history in Tamil and English (UI-9)", () => {
  const stagesOf = (history: Awaited<ReturnType<typeof caseHistory>>) =>
    history?.filter((e) => e.action === "stage_updated").map((e) => e.after.stages);

  it("names the district and the stages reached in the screen's language", async () => {
    const c = await running();
    const [first, second] = await newHouseStages();
    expect(await stage(c.id, c.version, second!.id, daysAgo(10))).toMatchObject({ ok: true });

    const [si, ta, en] = await Promise.all(
      (["si", "ta", "en"] as const).map((locale) => caseHistory(db, ho, c.id, locale)),
    );
    expect(stagesOf(si)).toEqual([[first!.nameSi, second!.nameSi]]);
    expect(stagesOf(ta)).toEqual([[first!.nameTa, second!.nameTa]]);
    expect(stagesOf(en)).toEqual([[first!.nameEn, second!.nameEn]]);

    const district = await db.district.findFirstOrThrow({ where: { dsOffices: { some: { id: c.dsOfficeId } } } });
    const released = (history: typeof si) => history?.find((e) => e.action === "case_allocated")?.after.district;
    expect([released(si), released(ta), released(en)]).toEqual([district.nameSi, district.nameTa, district.nameEn]);
  });

  it("reads an older record's stages by id, except on the Sinhala screen, which keeps the names of the day", async () => {
    const c = await running();
    const [first] = await newHouseStages();
    // As recorded before 7 Oct 2026: Sinhala names only.
    await db.auditLog.create({
      data: {
        actorId: dsA.userId,
        action: "stage_updated",
        entityType: "stage_update",
        entityId: randomUUID(),
        caseId: c.id,
        before: { stageId: null },
        after: { stageIds: [first!.id], stages: ["පැරණි නම"], visitedOn: daysAgo(5), note: null, photos: [] },
      },
    });
    expect(stagesOf(await caseHistory(db, ho, c.id, "si"))).toEqual([["පැරණි නම"]]);
    expect(stagesOf(await caseHistory(db, ho, c.id, "ta"))).toEqual([[first!.nameTa]]);
    expect(stagesOf(await caseHistory(db, ho, c.id, "en"))).toEqual([[first!.nameEn]]);
  });
});

describe("the DS home (HOME-1, HOME-3, HOME-4)", () => {
  it("lists installments due within 7 days or overdue, and cases with no update for 30 days", async () => {
    const soon = await running({ name: "ප්‍රගති පරීක්ෂණ ළඟදී" });
    await start(dsA, soon.id, soon.version, 1, addDays(today(), 6));
    const late = await running({ name: "ප්‍රගති පරීක්ෂණ ප්‍රමාද" });
    await start(dsA, late.id, late.version, 1, daysAgo(3));
    const later = await running({ name: "ප්‍රගති පරීක්ෂණ පසුව" });
    await start(dsA, later.id, later.version, 1, addDays(today(), 8));
    // Only a case in progress can be stale (HOME-3), so its installment 1 is paid first.
    const quiet = await running({ name: "ප්‍රගති පරීක්ෂණ නිශ්ශබ්ද" });
    await payNext(quiet.id, 1, daysAgo(40));
    await db.case.update({ where: { id: quiet.id }, data: { updatedAt: colomboStartOf(daysAgo(31)) } });

    const todo = await todoItems(db, dsA);
    expect(todo.find((i) => i.id === soon.id)).toMatchObject({ type: "due", number: 1, overdue: false });
    expect(todo.find((i) => i.id === late.id)).toMatchObject({ type: "due", number: 1, overdue: true });
    expect(todo.find((i) => i.id === later.id)).toBeUndefined();
    expect(todo.find((i) => i.id === quiet.id)).toMatchObject({ type: "stale", days: 31 });
    expect(await todoItems(db, dsB)).not.toContainEqual(expect.objectContaining({ id: quiet.id }));
  });

  it("shows the office's money and each case's installments paid and stage reached", async () => {
    const before = await officeMoney(db, dsA);
    const c = await running();
    await payNext(c.id, 1, daysAgo(30));
    const [first] = await newHouseStages();
    await stage(c.id, await version(c.id), first!.id);

    expect(await officeMoney(db, dsA)).toEqual({
      received: before!.received + 2_000_000,
      paidOut: before!.paidOut + 500_000,
      balance: before!.balance + 1_500_000,
    });
    expect(await officeMoney(db, admin)).toBeNull();
    const { rows } = await listCases(db, dsA, { q: (await load(c.id)).applicationNumber ?? "" }, "si");
    expect(rows).toEqual([expect.objectContaining({ id: c.id, paid: 1, stageName: first!.nameSi })]);
  });
});
