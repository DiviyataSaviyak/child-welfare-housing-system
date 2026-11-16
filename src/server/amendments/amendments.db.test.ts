import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { CARE_LEAVER_DETAILS, createTestClient, freeOfficeId, testApplicationNumber } from "../../../tests/db/client";
import { releaseToDsForTests } from "../../../tests/db/ds-release";
import { addDays, colomboDay, dayToDate } from "@/lib/dates";
import type { CaseValues } from "@/lib/validation/case";
import { NOTE_ONLY } from "@/lib/validation/progress";
import { type Actor, deleteCase, saveCase } from "../cases/commands";
import { getCase, todoItems } from "../cases/queries";
import { fileForViewer, uploadDocument } from "../files/uploads";
import { caseHistory } from "../history/queries";
import { markInstallmentPaid, startInstallment } from "../installments/commands";
import { recordLetter } from "../releases/commands";
import { casesForDsRelease, casesForLetter } from "../releases/queries";
import { recordStageUpdate } from "../stages/commands";
import { type SubmitAmendmentInput, submitAmendment } from "./commands";

const db = createTestClient();

const today = () => colomboDay(new Date());
const daysAgo = (days: number) => addDays(today(), -days);
const PDF = new TextEncoder().encode("%PDF-1.7\n% a made-up document\n");
const REASON = "ඉඩමේ අයිතිය පිළිබඳ ගැටලුවක් ඇත";

let nicCounter = 0;
/** A made-up NIC (SEC-11), different for every beneficiary. */
const nextNic = () => `2005${String(++nicCounter).padStart(8, "0")}`;

/** A made-up care leaver (SEC-11). */
const values = (name: string, overrides: Partial<CaseValues> = {}): CaseValues => ({
  ...CARE_LEAVER_DETAILS,
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
  applicationNumber: testApplicationNumber(),
  childName: null,
  name,
  nic: nextNic(),
  address: "නො. 8, සංශෝධන පාර",
  gnDivision: null,
  mobile1: "0710000008",
  mobile2: null,
  remark: null,
  ...overrides,
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

/** The CRPO of the DS of residence, who submits the amendments. */
let dsA: Actor;
/** The accountant of the same DS, who only views (PRM-5). */
let accountant: Actor;
/** The CRPO of a DS of the same district, where some cases are built (CASE-13). */
let dsBuilt: Actor;
/** The CRPO of a DS of another district. */
let dsFar: Actor;
let ministry: Actor;
let districtA: number;
/** An active DS office of another district. */
let far: { id: number; districtId: number };

const load = (id: string) => db.case.findUniqueOrThrow({ where: { id } });

/** A case of dsA's office awaiting its allocation, built there or in `buildDsOfficeId` (CASE-13). */
async function newCase(name: string, buildDsOfficeId: number | null = null) {
  const result = await saveCase(db, dsA, {
    id: randomUUID(),
    version: null,
    dsOfficeId: null,
    buildDsOfficeId,
    values: values(name),
    documentIds: [],
  });
  if (!result.ok) throw new Error(result.error);
  // Entered a few days ago, so a letter can be dated before today.
  await db.case.update({ where: { id: result.value.id }, data: { createdAt: dayToDate(daysAgo(5)) } });
  return load(result.value.id);
}

/** The Ministry's letter to the district where the case is built (REL-2). */
async function allocate(id: string) {
  const row = await load(id);
  const office = await db.dsOffice.findUniqueOrThrow({ where: { id: row.buildDsOfficeId } });
  const letter = await recordLetter(db, ministry, {
    districtId: office.districtId,
    cases: [{ id: row.id, version: row.version }],
    form: { letterNumber: "MWCA/AMD/1", letterDate: daysAgo(3), validUntil: "2099-12-31", note: "" },
    scanId: null,
  });
  if (!letter.ok) throw new Error(String(letter.error ?? JSON.stringify(letter.errors)));
  return load(id);
}

/** Allocated, then released by the District to the DS where it is built: `ALLOCATION_RECEIVED`. */
async function received(name: string, buildDsOfficeId: number | null = null) {
  const row = await newCase(name, buildDsOfficeId);
  await allocate(row.id);
  await releaseToDsForTests(db, [row.id], { on: dayToDate(daysAgo(2)) });
  return load(row.id);
}

function amend(
  existing: { id: string; version: number },
  overrides: Partial<SubmitAmendmentInput> = {},
  by: Actor = dsA,
) {
  return submitAmendment(db, by, {
    id: randomUUID(),
    caseId: existing.id,
    caseVersion: existing.version,
    buildDsOfficeId: null,
    values: values("නව ප්‍රතිලාභී"),
    reason: REASON,
    documentIds: [],
    ...overrides,
  });
}

const start = (by: Actor, row: { id: string; version: number }) =>
  startInstallment(db, by, {
    caseId: row.id,
    version: row.version,
    number: 1,
    form: { amount: "", expectedOn: daysAgo(1), purpose: "", note: "" },
  });

const pay = (by: Actor, row: { id: string; version: number }) =>
  markInstallmentPaid(db, by, {
    caseId: row.id,
    version: row.version,
    number: 1,
    form: { releasedOn: today(), note: "" },
  });

beforeAll(async () => {
  await seed(db);
  const officeA = await freeOfficeId(db);
  dsA = await account(actor("amend-test-a", "DS_OFFICER", "DS_CRPO", { dsOfficeId: officeA }), "සං. පළමු");
  accountant = await account(
    actor("amend-test-accountant", "VIEWER", "DS_ACCOUNTANT", { dsOfficeId: officeA }),
    "සං. ගණකාධිකාරී",
  );
  districtA = (await db.dsOffice.findUniqueOrThrow({ where: { id: officeA } })).districtId;
  const neighbour = await db.dsOffice.findFirstOrThrow({
    where: { active: true, districtId: districtA, id: { not: officeA } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  dsBuilt = await account(
    actor("amend-test-built", "DS_OFFICER", "DS_CRPO", { dsOfficeId: neighbour.id }),
    "සං. ඉදිකිරීම",
  );
  far = await db.dsOffice.findFirstOrThrow({
    where: { active: true, districtId: { not: districtA } },
    orderBy: { id: "asc" },
    select: { id: true, districtId: true },
  });
  dsFar = await account(actor("amend-test-far", "DS_OFFICER", "DS_CRPO", { dsOfficeId: far.id }), "සං. දුර");
  ministry = await account(
    actor("amend-test-ministry", "MINISTRY_OFFICER", "MINISTRY_PROGRAMME_OFFICER"),
    "සං. අමාත්‍යාංශ",
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("submitting an amendment (AMD-1)", () => {
  it("keeps the new beneficiary and the reason for the Ministry, and leaves the case as it was", async () => {
    const existing = await newCase("පවතින ප්‍රතිලාභී");
    const upload = await uploadDocument(db, dsA, { name: "නව ලේඛනය.pdf", bytes: PDF });
    if (!upload.ok) throw new Error(upload.error);
    const id = randomUUID();
    const newcomer = values("නව ප්‍රතිලාභී", { applicationNumber: "amd/7" });

    const result = await amend(existing, { id, values: newcomer, documentIds: [upload.value.id] });
    expect(result).toEqual({ ok: true, value: { id, caseId: existing.id } });

    const row = await db.amendment.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      caseId: existing.id,
      dsOfficeId: dsA.dsOfficeId,
      applicationKey: "AMD/7",
      reason: REASON,
      status: "WAITING",
      submittedById: dsA.userId,
      decidedById: null,
      newCaseId: null,
    });
    expect(row.details).toMatchObject({
      name: "නව ප්‍රතිලාභී",
      applicationNumber: "amd/7",
      nic: newcomer.nic,
      buildDsOfficeId: dsA.dsOfficeId,
    });
    // AMD-3: the case doesn't change because of it.
    const after = await load(existing.id);
    expect(after).toMatchObject({ status: "AWAITING_ALLOCATION", version: existing.version, name: existing.name });

    // The document waits on the amendment, and opens for whoever sees the case (SEC-7).
    const file = await db.storedFile.findUniqueOrThrow({ where: { id: upload.value.id } });
    expect(file).toMatchObject({ amendmentId: id, caseId: null });
    expect(await fileForViewer(db, accountant, file.id)).not.toBeNull();
    expect(await fileForViewer(db, dsFar, file.id)).toBeNull();

    // The case pages show it, and its history says so (AMD-1).
    const details = await getCase(db, dsA, existing.id, "si");
    expect(details?.amendment).toMatchObject({
      id,
      status: "WAITING",
      name: "නව ප්‍රතිලාභී",
      applicationNumber: "amd/7",
      reason: REASON,
    });
    expect(details?.hasAmendments).toBe(true);
    const history = await caseHistory(db, dsA, existing.id, "si");
    expect(history?.find((entry) => entry.action === "amendment_submitted")?.after).toMatchObject({
      name: "නව ප්‍රතිලාභී",
      applicationNumber: "amd/7",
      reason: REASON,
      documentsAdded: [upload.value.id],
    });
  });

  it("makes one amendment when the same form is sent twice (ERR-8)", async () => {
    const existing = await newCase("දෙවරක් යවන ලද");
    const id = randomUUID();
    const input = { id, values: values("නව දෙවරක්") };
    expect(await amend(existing, input)).toMatchObject({ ok: true });
    expect(await amend(existing, input)).toMatchObject({ ok: true, value: { id } });
    expect(await db.amendment.count({ where: { caseId: existing.id } })).toBe(1);
  });

  it("refuses a missing reason, and incomplete details, saving nothing", async () => {
    const existing = await newCase("හේතුව නැති");
    expect(await amend(existing, { reason: "  " })).toEqual({ ok: false, error: null, reasonError: "reasonRequired" });
    expect(await amend(existing, { reason: "අඩු" })).toEqual({ ok: false, error: null, reasonError: "reasonTooShort" });
    expect(await amend(existing, { values: values("නම", { familyMembers: null }) })).toEqual({
      ok: false,
      error: "incomplete",
    });
    expect(await amend({ ...existing, version: existing.version - 1 })).toEqual({ ok: false, error: "conflict" });
    expect(await db.amendment.count({ where: { caseId: existing.id } })).toBe(0);
  });

  it("is only for a CRPO of the DS of residence (AMD-1, AC-48)", async () => {
    const elsewhere = await newCase("වෙනත් තැනක ඉදිවන", dsBuilt.dsOfficeId);
    // A view-only account of the same DS, the Ministry, and the DS where it is built: refused.
    expect(await amend(elsewhere, {}, accountant)).toEqual({ ok: false, error: "roleNotAllowed" });
    expect(await amend(elsewhere, {}, ministry)).toEqual({ ok: false, error: "roleNotAllowed" });
    expect(await amend(elsewhere, {}, dsBuilt)).toEqual({ ok: false, error: "roleNotAllowed" });
    // Another DS doesn't see it (PRM-1).
    expect(await amend(elsewhere, {}, dsFar)).toEqual({ ok: false, error: "notFound" });
    expect(await db.amendment.count({ where: { caseId: elsewhere.id } })).toBe(0);
    // The DS of residence may (AMD-1), from either kind of office.
    expect(await amend(elsewhere, { buildDsOfficeId: dsBuilt.dsOfficeId })).toMatchObject({ ok: true });
  });
});

describe("the new beneficiary (AMD-8, AC-66)", () => {
  it("needs an Application Number free in the DS: no case or waiting amendment holds it", async () => {
    const holder = await newCase("අංකය ඇති");
    const existing = await newCase("අංකය ගැටෙන");
    expect(await amend(existing, { values: values("නව", { applicationNumber: holder.applicationNumber }) })).toEqual({
      ok: false,
      error: "applicationNumberTaken",
    });

    const number = testApplicationNumber();
    expect(await amend(holder, { values: values("පළමු නව", { applicationNumber: number }) })).toMatchObject({
      ok: true,
    });
    // Without case or spaces (CASE-12).
    const spaced = ` ${number.toLowerCase()} `;
    expect(await amend(existing, { values: values("දෙවන නව", { applicationNumber: spaced }) })).toEqual({
      ok: false,
      error: "applicationNumberTaken",
    });
    // A new case can't take it either while the amendment waits.
    const another = await saveCase(db, dsA, {
      id: randomUUID(),
      version: null,
      dsOfficeId: null,
      buildDsOfficeId: null,
      values: values("තවත්", { applicationNumber: number }),
      documentIds: [],
    });
    expect(another).toEqual({ ok: false, error: "applicationNumberTaken" });
  });

  it("is built where the money has gone: any DS before the letter, the district after it, the DS after the release", async () => {
    // Awaiting its allocation: anywhere.
    const waiting = await newCase("ප්‍රතිපාදන නොලැබූ");
    expect(await amend(waiting, { buildDsOfficeId: far.id })).toMatchObject({ ok: true });

    // On a letter to its district: a DS office of that district only.
    const onLetter = await allocate((await newCase("ලිපියට ඇතුළත්")).id);
    expect(onLetter.status).toBe("ALLOCATED_TO_DISTRICT");
    expect(await amend(onLetter, { buildDsOfficeId: far.id })).toEqual({ ok: false, error: "buildOfficeNotAllowed" });
    expect(await amend(onLetter, { buildDsOfficeId: dsBuilt.dsOfficeId })).toMatchObject({ ok: true });

    // Released to its DS: that DS only.
    const released = await received("ප්‍රතිපාදන ලැබූ");
    expect(released.status).toBe("ALLOCATION_RECEIVED");
    expect(await amend(released, { buildDsOfficeId: dsBuilt.dsOfficeId })).toEqual({
      ok: false,
      error: "buildOfficeNotAllowed",
    });
    expect(await amend(released)).toMatchObject({ ok: true });

    // A case released to the DS where it is built, in another DS: the new beneficiary is built there too.
    const builtElsewhere = await received("අසල ඉදිවන", dsBuilt.dsOfficeId);
    expect(await amend(builtElsewhere)).toEqual({ ok: false, error: "buildOfficeNotAllowed" });
    expect(await amend(builtElsewhere, { buildDsOfficeId: dsBuilt.dsOfficeId })).toMatchObject({ ok: true });
  });
});

describe("no amendment once paid, completed or replaced (AMD-2, AC-46)", () => {
  it("is refused after installment 1 is paid, but not while it is only being paid", async () => {
    const row = await received("ගෙවීම් අරඹන");
    expect(await start(dsA, row)).toMatchObject({ ok: true });
    const paying = await load(row.id);
    expect(paying.status).toBe("ALLOCATION_RECEIVED");
    expect(await pay(dsA, paying)).toMatchObject({ ok: true });

    const paid = await load(row.id);
    expect(paid.status).toBe("IN_PROGRESS");
    expect(await amend(paid)).toEqual({ ok: false, error: "amendmentNotAllowed" });
  });

  it("is refused for a completed or replaced case", async () => {
    for (const status of ["COMPLETED", "REPLACED"] as const) {
      const row = await newCase(`අවසන් ${status}`);
      await db.case.update({ where: { id: row.id }, data: { status } });
      expect(await amend(await load(row.id))).toEqual({ ok: false, error: "amendmentNotAllowed" });
    }
  });
});

describe("while an amendment waits (AMD-3, AC-47)", () => {
  it("holds installments and stages, but not the letter or the District's release, which flag the case", async () => {
    // Allocated and on its letter: the District's release form flags it, and it can still be released.
    const onLetter = await allocate((await newCase("ලිපියේ සංශෝධිත")).id);
    expect(await amend(onLetter)).toMatchObject({ ok: true });
    const releaseForm = await casesForDsRelease(db, await districtOfficer(), dsA.dsOfficeId!, "si");
    expect(releaseForm?.cases.find((c) => c.id === onLetter.id)?.amendmentWaiting).toBe(true);
    await releaseToDsForTests(db, [onLetter.id], { on: dayToDate(daysAgo(2)) });

    // Received, with installment 1 being paid: the amendment is allowed (AMD-1), then holds the payment.
    const row = await load(onLetter.id);
    expect(row.status).toBe("ALLOCATION_RECEIVED");
    expect(await start(dsA, row)).toEqual({ ok: false, error: "amendmentWaiting", errors: {} });
    expect(
      await recordStageUpdate(db, dsA, {
        caseId: row.id,
        version: row.version,
        form: { stageId: NOTE_ONLY, visitedOn: today(), note: "" },
        photoIds: [],
      }),
    ).toEqual({ ok: false, error: "amendmentWaiting", errors: {} });
    // AMD-3: no second amendment.
    expect(await amend(row)).toEqual({ ok: false, error: "amendmentWaiting" });

    // An installment started before the amendment can't be paid while it waits.
    const paying = await received("ගෙවමින් සංශෝධිත");
    expect(await start(dsA, paying)).toMatchObject({ ok: true });
    const started = await load(paying.id);
    expect(await amend(started)).toMatchObject({ ok: true });
    expect(await pay(dsA, started)).toEqual({ ok: false, error: "amendmentWaiting", errors: {} });
    expect((await load(paying.id)).status).toBe("ALLOCATION_RECEIVED");

    // HOME-3: neither is on the to-do panel of the DS where it is built.
    const todo = await todoItems(db, dsA);
    expect(todo.filter((item) => item.id === row.id || item.id === paying.id)).toEqual([]);
  });

  it("flags the case on the Ministry's letter form, where it can still be ticked (REL-2)", async () => {
    const row = await newCase("ලිපිය බලාපොරොත්තු");
    expect(await amend(row)).toMatchObject({ ok: true });
    const form = await casesForLetter(db, ministry, districtA, "si");
    expect(form.find((c) => c.id === row.id)?.amendmentWaiting).toBe(true);
    expect((await allocate(row.id)).status).toBe("ALLOCATED_TO_DISTRICT");
  });

  it("keeps a case with an amendment from being deleted (CASE-8)", async () => {
    const row = await newCase("මකා නොදැමිය හැකි");
    expect(await amend(row)).toMatchObject({ ok: true });
    const current = await load(row.id);
    for (const who of [dsA, ministry]) {
      expect(
        await deleteCase(db, who, { caseId: row.id, version: current.version, reason: "දෙවරක් ඇතුළත් කළා" }),
      ).toEqual({ ok: false, error: "hasAmendment" });
    }
    expect(await db.case.count({ where: { id: row.id } })).toBe(1);
  });
});

describe("a rejected amendment (AMD-6, HOME-3)", () => {
  it("shows on the DS's to-do panel and case page with the Ministry's reason, until another is submitted", async () => {
    const row = await newCase("ප්‍රතික්ෂේපිත");
    const first = await amend(row);
    if (!first.ok) throw new Error(String(first.error));
    // The Ministry's rejection is task 3's command; the row is set as it will set it.
    await db.amendment.update({
      where: { id: first.value.id },
      data: {
        status: "REJECTED",
        decidedById: ministry.userId,
        decidedAt: new Date(),
        rejectionReason: "ලේඛන ප්‍රමාණවත් නැත",
      },
    });

    const todo = await todoItems(db, dsA);
    expect(todo.find((item) => item.type === "amendmentRejected" && item.amendmentId === first.value.id)).toMatchObject(
      { id: row.id, name: row.name, rejectedOn: today(), reason: "ලේඛන ප්‍රමාණවත් නැත" },
    );
    // Only for the DS of residence.
    expect((await todoItems(db, dsBuilt)).some((item) => item.type === "amendmentRejected")).toBe(false);
    expect((await getCase(db, dsA, row.id, "si"))?.amendment).toMatchObject({
      status: "REJECTED",
      rejectionReason: "ලේඛන ප්‍රමාණවත් නැත",
    });

    // The DS may submit another, which takes its place on the page and on the panel.
    const second = await amend(await load(row.id));
    expect(second).toMatchObject({ ok: true });
    expect((await getCase(db, dsA, row.id, "si"))?.amendment).toMatchObject({ status: "WAITING" });
    expect((await todoItems(db, dsA)).some((item) => item.id === row.id)).toBe(false);
  });
});

/** The District CRPO of dsA's district: the one releaseToDsForTests uses, or made for the tests. */
async function districtOfficer(): Promise<Actor> {
  const found = await db.user.findFirst({
    where: { districtId: districtA, role: "DISTRICT_OFFICER", banned: false },
    orderBy: { createdAt: "asc" },
  });
  const user =
    found ??
    (await db.user.create({
      data: {
        id: "amend-test-district",
        name: "සං. දිස්ත්‍රික්",
        email: "amend-test-district@no-email.invalid",
        role: "DISTRICT_OFFICER",
        designation: "DISTRICT_CRPO",
        districtId: districtA,
      },
    }));
  return actor(user.id, "DISTRICT_OFFICER", "DISTRICT_CRPO", { districtId: districtA });
}
