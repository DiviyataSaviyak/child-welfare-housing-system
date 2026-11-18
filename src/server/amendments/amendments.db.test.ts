import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { CARE_LEAVER_DETAILS, createTestClient, freeOfficeId, testApplicationNumber } from "../../../tests/db/client";
import { releaseToDsForTests } from "../../../tests/db/ds-release";
import { addDays, colomboDay, dayToDate } from "@/lib/dates";
import type { CaseValues } from "@/lib/validation/case";
import { NOTE_ONLY } from "@/lib/validation/progress";
import { type Actor, deleteCase, saveCase } from "../cases/commands";
import { getCase, officeMoney, todoItems } from "../cases/queries";
import { fileForViewer, uploadDocument } from "../files/uploads";
import { caseHistory } from "../history/queries";
import { markInstallmentPaid, startInstallment } from "../installments/commands";
import { listNotifications } from "../notifications/queries";
import { recordLetter } from "../releases/commands";
import {
  casesForDsRelease,
  casesForLetter,
  dsReleaseWithCases,
  getDsRelease,
  letterWithCases,
  recentLetters,
} from "../releases/queries";
import { recordStageUpdate } from "../stages/commands";
import { approveAmendment, rejectAmendment, type SubmitAmendmentInput, submitAmendment } from "./commands";
import { askNomination, sendBackNomination } from "./nominations";
import {
  amendmentsWaiting,
  countAmendments,
  getAmendment,
  getNomination,
  listAmendments,
  listNominations,
  nominationsWaiting,
} from "./queries";

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
/** The Ministry's Secretary, who only views (PRM-4, AC-48). */
let secretary: Actor;
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
  if (!result.ok) throw new Error(String(result.error));
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
  secretary = await account(actor("amend-test-secretary", "VIEWER", "MINISTRY_SECRETARY"), "සං. ලේකම්");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("submitting an amendment (AMD-1)", () => {
  it("keeps the new beneficiary and the reason for the Ministry, and leaves the case as it was", async () => {
    const existing = await newCase("පවතින ප්‍රතිලාභී");
    const upload = await uploadDocument(db, dsA, { name: "නව ලේඛනය.pdf", bytes: PDF });
    if (!upload.ok) throw new Error(String(upload.error));
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

  it("may be built in any active DS office before the letter, and in the letter's district after it (AMD-8, AC-77)", async () => {
    const waiting = await newCase("ප්‍රතිපාදන නොලැබූ");
    expect(await amend(waiting, { buildDsOfficeId: far.id })).toMatchObject({ ok: true });

    const onLetter = await allocate((await newCase("ලිපියට ඇතුළත්")).id);
    expect(onLetter.status).toBe("ALLOCATED_TO_DISTRICT");
    expect(await amend(onLetter, { buildDsOfficeId: far.id })).toEqual({ ok: false, error: "buildOfficeNotAllowed" });
    expect(await amend(onLetter, { buildDsOfficeId: dsBuilt.dsOfficeId })).toMatchObject({ ok: true });

    const released = await received("ප්‍රතිපාදන ලැබූ");
    expect(released.status).toBe("ALLOCATION_RECEIVED");
    expect(await amend(released, { buildDsOfficeId: far.id })).toEqual({ ok: false, error: "buildOfficeNotAllowed" });
    expect(await amend(released, { buildDsOfficeId: dsBuilt.dsOfficeId })).toMatchObject({ ok: true });

    const builtElsewhere = await received("අසල ඉදිවන", dsBuilt.dsOfficeId);
    expect(await amend(builtElsewhere)).toMatchObject({ ok: true });
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
    const { letterId } = await db.release.findUniqueOrThrow({ where: { caseId: onLetter.id } });
    const releaseForm = await casesForDsRelease(db, await districtOfficer(), dsA.dsOfficeId!, letterId, "si");
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
    expect(
      await rejectAmendment(db, ministry, { amendmentId: first.value.id, version: 1, reason: "ලේඛන ප්‍රමාණවත් නැත" }),
    ).toEqual({ ok: true, caseId: row.id });

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

/** Submits an amendment and gives its id, failing the test if it is refused. */
async function submitted(existing: { id: string; version: number }, overrides: Partial<SubmitAmendmentInput> = {}) {
  const result = await amend(existing, overrides);
  if (!result.ok) throw new Error(String(result.error));
  return result.value.id;
}

/** The Ministry approves, with the versions it was shown, and the return's fields when it asks for them (AMD-11). */
async function approve(
  amendmentId: string,
  by: Actor = ministry,
  returned: { returnedOn: string; referenceNumber: string; note: string } | null = null,
) {
  const row = await db.amendment.findUnique({ where: { id: amendmentId }, select: { version: true, caseId: true } });
  const caseVersion = row ? (await load(row.caseId)).version : 1;
  return approveAmendment(db, by, { amendmentId, version: row?.version ?? 1, caseVersion, returned });
}

const RETURN = { returnedOn: "", referenceNumber: "RET/AMD/11", note: "" };

const noticesOf = async (who: Actor, caseId: string) =>
  (await listNotifications(db, who, 200)).filter((n) => n.caseId === caseId).map((n) => n.type);

describe("approving an amendment (AMD-5, AC-44, AC-45)", () => {
  it("makes the new beneficiary's case in the existing one's place, before the allocation", async () => {
    const existing = await newCase("ප්‍රතිස්ථාපනය වන");
    const upload = await uploadDocument(db, dsA, { name: "නව ලේඛනය.pdf", bytes: PDF });
    if (!upload.ok) throw new Error(String(upload.error));
    const id = await submitted(existing, {
      values: values("අනුමත නව", { applicationNumber: "amd/44" }),
      buildDsOfficeId: dsBuilt.dsOfficeId,
      documentIds: [upload.value.id],
    });

    const result = await approve(id);
    if (!result.ok) throw new Error(String(result.error));
    const made = await db.case.findUniqueOrThrow({ where: { id: result.caseId }, include: { centres: true } });
    expect(made).toMatchObject({
      status: "AWAITING_ALLOCATION",
      name: "අනුමත නව",
      applicationNumber: "amd/44",
      applicationKey: "AMD/44",
      dsOfficeId: dsA.dsOfficeId,
      buildDsOfficeId: dsBuilt.dsOfficeId,
      replacesCaseId: existing.id,
      createdById: dsA.userId,
    });
    expect(made.centres.length).toBe(CARE_LEAVER_DETAILS.centres.length);
    expect(await load(existing.id)).toMatchObject({ status: "REPLACED", name: existing.name });
    expect(await db.amendment.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "APPROVED",
      decidedById: ministry.userId,
      newCaseId: made.id,
      version: 2,
    });
    // The documents follow the new beneficiary.
    expect(await db.storedFile.findUniqueOrThrow({ where: { id: upload.value.id } })).toMatchObject({
      caseId: made.id,
      amendmentId: null,
    });

    // Each links to the other through the amendment.
    const before = await getCase(db, dsA, existing.id, "si");
    expect(before?.replacedBy).toMatchObject({ id: made.id, amendment: { id } });
    expect(before?.amendment).toBeNull();
    const after = await getCase(db, dsA, made.id, "si");
    expect(after?.replaces).toMatchObject({ id: existing.id, decision: null, amendment: { id } });
    expect(after?.documents.map((d) => d.id)).toEqual([upload.value.id]);

    // Both histories say who approved it, and name the other case (AMD-5).
    const oldHistory = await caseHistory(db, dsA, existing.id, "si");
    expect(oldHistory?.find((e) => e.action === "case_replaced")).toMatchObject({
      actor: { role: "MINISTRY_OFFICER" },
      after: { newCaseId: made.id, newApplicationNumber: "amd/44", newName: "අනුමත නව", allocationMoved: false },
    });
    const newHistory = await caseHistory(db, dsA, made.id, "si");
    expect(newHistory?.find((e) => e.action === "amendment_approved")).toMatchObject({
      actor: { role: "MINISTRY_OFFICER" },
      after: {
        replacesCaseId: existing.id,
        replacedApplicationNumber: existing.applicationNumber,
        applicationNumber: "amd/44",
        reason: REASON,
        status: "AWAITING_ALLOCATION",
        documentsAdded: [upload.value.id],
      },
    });

    // AMD-10: the CRPOs of both DS offices, on the new case; no District officer before a letter.
    expect(await noticesOf(dsA, made.id)).toEqual(["AMENDMENT_APPROVED"]);
    expect(await noticesOf(dsBuilt, made.id)).toEqual(["AMENDMENT_APPROVED"]);
    expect(await db.notification.count({ where: { caseId: made.id, user: { role: "DISTRICT_OFFICER" } } })).toBe(0);

    // The page shows both beneficiaries to whoever sees the case, and nobody else (AMD-4, PRM-1).
    const view = await getAmendment(db, accountant, id, "si");
    expect(view).toMatchObject({ status: "APPROVED", newCase: { id: made.id }, proposed: { name: "අනුමත නව" } });
    expect(view?.documents.map((d) => d.id)).toEqual([upload.value.id]);
    expect(await getAmendment(db, dsFar, id, "si")).toBeNull();
  });

  it("moves the allocation and its District release, with new installments by the new kind", async () => {
    const existing = await received("ලැබුණු ප්‍රතිස්ථාපිත");
    const release = await db.release.findUniqueOrThrow({ where: { caseId: existing.id } });
    // An installment started before the amendment stays on the replaced case, unpaid.
    expect(await start(dsA, existing)).toMatchObject({ ok: true });
    const id = await submitted(await load(existing.id));
    const officer = await districtOfficer();

    const result = await approve(id);
    if (!result.ok) throw new Error(String(result.error));
    const made = await db.case.findUniqueOrThrow({
      where: { id: result.caseId },
      include: { release: true, installments: { orderBy: { number: "asc" } } },
    });
    expect(made.status).toBe("ALLOCATION_RECEIVED");
    expect(made.release).toMatchObject({
      id: release.id,
      letterId: release.letterId,
      dsReleaseId: release.dsReleaseId,
      amount: 2_000_000,
    });
    expect(made.installments.map((i) => [i.number, i.status, i.amount])).toEqual([
      [1, "NOT_STARTED", 500_000],
      [2, "NOT_STARTED", 500_000],
      [3, "NOT_STARTED", 500_000],
      [4, "NOT_STARTED", 500_000],
    ]);
    const old = await db.case.findUniqueOrThrow({
      where: { id: existing.id },
      include: { release: true, installments: { orderBy: { number: "asc" } } },
    });
    expect(old.status).toBe("REPLACED");
    expect(old.release).toBeNull();
    expect(old.installments.map((i) => i.status)).toEqual(["PROCESSING", "NOT_STARTED", "NOT_STARTED", "NOT_STARTED"]);
    // The letter and the District release still count one case each for it.
    expect(await db.release.count({ where: { letterId: release.letterId } })).toBe(1);

    // AMD-10: the district holds the money, so its District officers hear of it too.
    expect(await noticesOf(officer, made.id)).toEqual(["AMENDMENT_APPROVED"]);
    // AMD-5 + STS-2: the replaced case's installment can't change any more.
    const replaced = await load(existing.id);
    expect(await pay(dsA, replaced)).toMatchObject({ ok: false });
    expect(await getCase(db, dsA, made.id, "si")).toMatchObject({
      release: { dsRelease: { id: release.dsReleaseId } },
    });
  });

  it("puts the new beneficiary on the same letter, and makes no installment for a land kind", async () => {
    const onLetter = await allocate((await newCase("ලිපියේ ප්‍රතිස්ථාපිත")).id);
    const letterId = (await db.release.findUniqueOrThrow({ where: { caseId: onLetter.id } })).letterId;
    const id = await submitted(onLetter, {
      values: values("ඉඩම් නව", { kind: "LAND_ONLY" }),
      buildDsOfficeId: dsBuilt.dsOfficeId,
    });
    const result = await approve(id);
    if (!result.ok) throw new Error(String(result.error));
    expect(
      await db.case.findUniqueOrThrow({ where: { id: result.caseId }, include: { release: true, installments: true } }),
    ).toMatchObject({
      status: "ALLOCATED_TO_DISTRICT",
      kind: "LAND_ONLY",
      buildDsOfficeId: dsBuilt.dsOfficeId,
      release: { letterId, dsReleaseId: null },
      installments: [],
    });

    const land = await received("ඉඩම් ලැබුණු");
    const landId = await submitted(land, { values: values("ඉඩම් පමණක්", { kind: "LAND_ONLY" }) });
    const approved = await approve(landId);
    if (!approved.ok) throw new Error(String(approved.error));
    expect(await db.installment.count({ where: { caseId: approved.caseId } })).toBe(0);
  });
});

describe("a replacement built outside the place the money has reached (AMD-11, AC-76, AC-77)", () => {
  it("sends a DS office's allocation back to the District, which releases it to the new DS office (AC-76)", async () => {
    const existing = await received("කඩුවෙල ලැබූ");
    const release = await db.release.findUniqueOrThrow({ where: { caseId: existing.id } });
    const officer = await districtOfficer();
    const id = await submitted(existing, { buildDsOfficeId: dsBuilt.dsOfficeId });
    const before = (await officeMoney(db, dsA))?.received ?? 0;

    // The return's date and reference are required, and the date can't be before the District's release.
    expect(await approve(id, ministry, { ...RETURN, returnedOn: "", referenceNumber: "" })).toEqual({
      ok: false,
      error: null,
      errors: { returnedOn: "dateRequired", referenceNumber: "referenceRequired" },
    });
    expect(await approve(id, ministry, { ...RETURN, returnedOn: daysAgo(3) })).toEqual({
      ok: false,
      error: null,
      errors: { returnedOn: "dateBeforeAllocation" },
    });
    expect(await approve(id)).toEqual({ ok: false, error: "conflict" });
    expect((await load(existing.id)).status).toBe("ALLOCATION_RECEIVED");

    const result = await approve(id, ministry, { ...RETURN, returnedOn: today(), note: "ආපසු යවන ලදී" });
    if (!result.ok) throw new Error(String(result.error));
    const made = await db.case.findUniqueOrThrow({
      where: { id: result.caseId },
      include: { release: true, installments: true },
    });
    // On the same letter, waiting for the District's release to the new DS office; no installment yet.
    expect(made).toMatchObject({
      status: "ALLOCATED_TO_DISTRICT",
      buildDsOfficeId: dsBuilt.dsOfficeId,
      release: { id: release.id, letterId: release.letterId, dsReleaseId: null, dsReleasedOn: null },
      installments: [],
    });
    expect(await db.allocationReturn.findUniqueOrThrow({ where: { amendmentId: id } })).toMatchObject({
      caseId: existing.id,
      newCaseId: made.id,
      letterId: release.letterId,
      dsReleaseId: release.dsReleaseId,
      districtId: districtA,
      dsOfficeId: dsA.dsOfficeId,
      returnedTo: "DISTRICT",
      amount: 2_000_000,
      referenceNumber: "RET/AMD/11",
      note: "ආපසු යවන ලදී",
      byId: ministry.userId,
    });
    // HOME-4: the DS office no longer counts the Rs. 2,000,000.
    expect((await officeMoney(db, dsA))?.received).toBe(before - 2_000_000);
    // REL-10, REL-11: the existing beneficiary never received it, so neither the letter nor the District's
    // release lists or counts them; the letter lists the new one.
    const onLetter = await letterWithCases(db, ministry, release.letterId, "si");
    expect(onLetter?.cases.map((c) => c.id)).toContain(made.id);
    expect(onLetter?.cases.map((c) => c.id)).not.toContain(existing.id);
    const onRelease = await dsReleaseWithCases(db, officer, release.dsReleaseId!, "si");
    expect(onRelease?.cases.map((c) => c.id)).not.toContain(existing.id);
    expect((await getDsRelease(db, officer, release.dsReleaseId!, "si"))?.count).toBe(onRelease?.cases.length);

    // Both case pages and both histories show it.
    expect((await getCase(db, dsA, existing.id, "si"))?.allocationReturn).toMatchObject({
      side: "replaced",
      returnedTo: "DISTRICT",
      referenceNumber: "RET/AMD/11",
      returnedOn: today(),
    });
    expect((await getCase(db, dsBuilt, made.id, "si"))?.allocationReturn).toMatchObject({ side: "new" });
    expect(
      (await caseHistory(db, dsA, existing.id, "si"))?.find((e) => e.action === "case_replaced")?.after,
    ).toMatchObject({ allocationMoved: true, returned: { to: "DISTRICT", referenceNumber: "RET/AMD/11" } });
    expect(
      (await caseHistory(db, dsBuilt, made.id, "si"))?.find((e) => e.action === "amendment_approved")?.after,
    ).toMatchObject({ returned: { to: "DISTRICT", returnedOn: today() } });

    // AMD-10: the District officer hears of the new case, which waits for its release to the new DS office.
    expect(await noticesOf(officer, made.id)).toEqual(["AMENDMENT_APPROVED"]);
    const { letterId } = await db.release.findUniqueOrThrow({ where: { caseId: made.id } });
    const waiting = await casesForDsRelease(db, officer, dsBuilt.dsOfficeId!, letterId, "si");
    expect(waiting?.cases.map((c) => c.id)).toContain(made.id);
    await releaseToDsForTests(db, [made.id], { on: dayToDate(daysAgo(2)) });
    const now = await load(made.id);
    expect(now.status).toBe("ALLOCATION_RECEIVED");
    expect(await start(dsBuilt, now)).toMatchObject({ ok: true });
    expect(await pay(dsBuilt, await load(made.id))).toMatchObject({ ok: true });
  });

  it("never sends the money back to the Ministry: another district is refused after the letter (AC-77)", async () => {
    const existing = await received("ගම්පහට යන");
    const release = await db.release.findUniqueOrThrow({ where: { caseId: existing.id } });
    const letters = await recentLetters(db, ministry, "si", 50);
    expect(letters.find((l) => l.id === release.letterId)?.count).toBe(1);

    // An amendment submitted before the letter, built in another district, can't be approved after it.
    const early = await newCase("ලිපියට පෙර දුර");
    const earlyId = await submitted(early, { buildDsOfficeId: far.id });
    await allocate(early.id);
    expect(await approve(earlyId, ministry, { ...RETURN, returnedOn: today() })).toEqual({
      ok: false,
      error: "buildOfficeNotAllowed",
    });
    expect((await load(early.id)).status).toBe("ALLOCATED_TO_DISTRICT");
    expect(await db.allocationReturn.count({ where: { caseId: early.id } })).toBe(0);

    // A case awaiting its allocation may still be replaced by one built in another district.
    const waiting = await newCase("ප්‍රතිපාදන නැති දුර");
    const waitingId = await submitted(waiting, { buildDsOfficeId: far.id });
    const made = await approve(waitingId);
    if (!made.ok) throw new Error(String(made.error));
    expect(await load(made.caseId)).toMatchObject({ status: "AWAITING_ALLOCATION", buildDsOfficeId: far.id });
    expect(await db.allocationReturn.count({ where: { amendmentId: waitingId } })).toBe(0);

    // A replacement built in the same DS office asks for no return, as before.
    const same = await received("එම කාර්යාලයේ");
    const sameId = await submitted(same);
    const kept = await approve(sameId);
    if (!kept.ok) throw new Error(String(kept.error));
    expect(await db.allocationReturn.count({ where: { amendmentId: sameId } })).toBe(0);
  });
});

/** The DS's request that the District nominate a new beneficiary (AMD-12). */
async function asked(existing: { id: string; version: number }, by: Actor = dsA) {
  const id = randomUUID();
  const result = await askNomination(db, by, {
    id,
    caseId: existing.id,
    caseVersion: existing.version,
    reason: "මෙම කොට්ඨාසයේ වෙනත් ප්‍රතිලාභියෙකු නැත",
  });
  if (!result.ok) throw new Error(String(result.error));
  return id;
}

/** The District nominates the new beneficiary for the request, living in `dsOfficeId` (AMD-13). */
function nominate(
  existing: { id: string },
  nominationId: string,
  dsOfficeId: number,
  by: Actor,
  overrides: Partial<SubmitAmendmentInput> = {},
) {
  return db.nomination.findUniqueOrThrow({ where: { id: nominationId } }).then(async (request) =>
    submitAmendment(db, by, {
      id: randomUUID(),
      caseId: existing.id,
      caseVersion: (await load(existing.id)).version,
      buildDsOfficeId: null,
      values: values("නාමයෝජිත"),
      reason: REASON,
      documentIds: [],
      nomination: { id: nominationId, version: request.version, dsOfficeId },
      ...overrides,
    }),
  );
}

describe("a new beneficiary nominated by the District (AMD-12, AMD-13, AC-78, AC-79)", () => {
  it("asks the District, holds the case, and the District's nomination goes to the Ministry, which approves it (AC-78)", async () => {
    const existing = await received("නාමයෝජනය ඉල්ලූ");
    const officer = await districtOfficer();
    const nominationId = await asked(existing);

    // AMD-12: the District hears of it and sees it under "to nominate"; the DS can't pay or amend.
    expect(await noticesOf(officer, existing.id)).toContain("NOMINATION_ASKED");
    const list = await listNominations(db, officer, {}, "si");
    expect(list.rows.map((r) => r.id)).toContain(nominationId);
    expect((await nominationsWaiting(db, officer)).count).toBeGreaterThan(0);
    expect((await nominationsWaiting(db, ministry)).count).toBe(0);
    expect(await start(dsA, await load(existing.id))).toMatchObject({ ok: false, error: "amendmentWaiting" });
    expect(await amend(await load(existing.id))).toEqual({ ok: false, error: "amendmentWaiting" });
    expect(
      await askNomination(db, dsA, {
        id: randomUUID(),
        caseId: existing.id,
        caseVersion: existing.version,
        reason: REASON,
      }),
    ).toEqual({ ok: false, error: "amendmentWaiting" });
    expect((await getCase(db, dsA, existing.id, "si"))?.nomination).toMatchObject({ status: "WAITING" });

    // AMD-13: the District enters a beneficiary who lives and builds in another DS office of the district.
    const nominated = await nominate(existing, nominationId, dsBuilt.dsOfficeId!, officer, {
      values: values("නාමයෝජිත නව", { applicationNumber: "nom/78" }),
    });
    if (!nominated.ok) throw new Error(String(nominated.error));
    const amendmentId = nominated.value.id;
    expect(await db.amendment.findUniqueOrThrow({ where: { id: amendmentId } })).toMatchObject({
      dsOfficeId: dsBuilt.dsOfficeId,
      submittedById: officer.userId,
      status: "WAITING",
    });
    expect(await db.nomination.findUniqueOrThrow({ where: { id: nominationId } })).toMatchObject({
      status: "NOMINATED",
      amendmentId,
    });
    expect((await getAmendment(db, ministry, amendmentId, "si"))?.nominatedByName).toBeTruthy();
    // Still held, now by the amendment.
    expect(await start(dsA, await load(existing.id))).toMatchObject({ ok: false, error: "amendmentWaiting" });

    // The Ministry approves it with the return: the new case is the nominated DS's, back with the District.
    const before = (await officeMoney(db, dsA))?.received ?? 0;
    const result = await approve(amendmentId, ministry, { ...RETURN, returnedOn: today() });
    if (!result.ok) throw new Error(String(result.error));
    const made = await load(result.caseId);
    expect(made).toMatchObject({
      dsOfficeId: dsBuilt.dsOfficeId,
      buildDsOfficeId: dsBuilt.dsOfficeId,
      status: "ALLOCATED_TO_DISTRICT",
      createdById: officer.userId,
    });
    expect((await officeMoney(db, dsA))?.received).toBe(before - 2_000_000);
    expect(await noticesOf(dsBuilt, made.id)).toContain("AMENDMENT_APPROVED");
    expect(await noticesOf(dsA, existing.id)).toContain("AMENDMENT_APPROVED");
    expect(await noticesOf(officer, made.id)).toContain("AMENDMENT_APPROVED");
    expect(await getCase(db, dsBuilt, made.id, "si")).toMatchObject({ actsOn: { edit: true } });

    // The District releases it to the new DS office, which pays installment 1.
    await releaseToDsForTests(db, [made.id], { on: dayToDate(daysAgo(1)) });
    expect(await start(dsBuilt, await load(made.id))).toMatchObject({ ok: true });
    expect(await pay(dsBuilt, await load(made.id))).toMatchObject({ ok: true });

    // Both histories show the request, the nomination and the approval.
    const actions = (await caseHistory(db, dsA, existing.id, "si"))?.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["nomination_asked", "amendment_nominated", "case_replaced"]));
    expect((await caseHistory(db, dsBuilt, made.id, "si"))?.map((e) => e.action)).toContain("amendment_approved");
  });

  it("is sent back with a reason, and the case is no longer held (AC-79)", async () => {
    const existing = await received("ආපසු යවන ඉල්ලීම");
    const officer = await districtOfficer();
    const nominationId = await asked(existing);
    const request = await db.nomination.findUniqueOrThrow({ where: { id: nominationId } });

    expect(await sendBackNomination(db, officer, { nominationId, version: request.version, reason: "ab" })).toEqual({
      ok: false,
      error: "reasonTooShort",
    });
    expect(
      await sendBackNomination(db, officer, {
        nominationId,
        version: request.version,
        reason: "වෙනත් ප්‍රතිලාභියෙකු නැත",
      }),
    ).toEqual({ ok: true, id: nominationId });
    expect(await noticesOf(dsA, existing.id)).toContain("NOMINATION_SENT_BACK");
    expect((await getCase(db, dsA, existing.id, "si"))?.nomination).toMatchObject({
      status: "SENT_BACK",
      sentBackReason: "වෙනත් ප්‍රතිලාභියෙකු නැත",
    });
    // Sent back once: it can't be nominated or sent back again.
    expect(await nominate(existing, nominationId, dsBuilt.dsOfficeId!, officer)).toEqual({
      ok: false,
      error: "nominationDecided",
    });
    // The case can have an installment again, and its history says so.
    expect(await start(dsA, await load(existing.id))).toMatchObject({ ok: true });
    expect((await caseHistory(db, dsA, existing.id, "si"))?.map((e) => e.action)).toContain("nomination_sent_back");
    // Once the DS submits an amendment, the sent-back request is no longer shown.
    const other = await received("ආපසු පසු සංශෝධනය");
    const second = await asked(other);
    const secondVersion = (await db.nomination.findUniqueOrThrow({ where: { id: second } })).version;
    await sendBackNomination(db, officer, { nominationId: second, version: secondVersion, reason: REASON });
    expect(await amend(await load(other.id))).toMatchObject({ ok: true });
    expect((await getCase(db, dsA, other.id, "si"))?.nomination).toBeNull();
  });

  it("refuses everyone else, another district's places, and an Application Number already used (AC-79)", async () => {
    const existing = await allocate((await newCase("නාමයෝජන සීමා")).id);
    const officer = await districtOfficer();
    const farOfficer = await account(
      actor("amend-test-far-district", "DISTRICT_OFFICER", "DISTRICT_CRPO", { districtId: far.districtId }),
      "සං. දුර දිස්ත්‍රික්",
    );
    // Only a CRPO of the DS of residence asks.
    for (const who of [accountant, ministry, officer]) {
      expect(
        await askNomination(db, who, {
          id: randomUUID(),
          caseId: existing.id,
          caseVersion: existing.version,
          reason: REASON,
        }),
      ).toEqual({ ok: false, error: "roleNotAllowed" });
    }
    for (const who of [dsBuilt, dsFar]) {
      expect(
        await askNomination(db, who, {
          id: randomUUID(),
          caseId: existing.id,
          caseVersion: existing.version,
          reason: REASON,
        }),
      ).toEqual({ ok: false, error: "notFound" });
    }
    const nominationId = await asked(existing);
    const version = (await db.nomination.findUniqueOrThrow({ where: { id: nominationId } })).version;

    // Only a District officer of the district where it is built nominates or sends back.
    for (const who of [dsA, accountant, secretary, ministry]) {
      expect(await nominate(existing, nominationId, dsBuilt.dsOfficeId!, who)).toMatchObject({
        ok: false,
        error: "roleNotAllowed",
      });
      expect(await sendBackNomination(db, who, { nominationId, version, reason: REASON })).toEqual({
        ok: false,
        error: "roleNotAllowed",
      });
    }
    expect(await nominate(existing, nominationId, dsBuilt.dsOfficeId!, farOfficer)).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await sendBackNomination(db, farOfficer, { nominationId, version, reason: REASON })).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await listNominations(db, farOfficer, {}, "si")).toMatchObject({ total: 0 });
    expect(await getNomination(db, farOfficer, nominationId, "si")).toBeNull();
    expect(await getNomination(db, accountant, nominationId, "si")).toMatchObject({ id: nominationId });

    // AMD-13: the DS of residence is another DS office of the same district, never another district's or the case's own.
    expect(await nominate(existing, nominationId, far.id, officer)).toEqual({
      ok: false,
      error: "residenceNotAllowed",
    });
    expect(await nominate(existing, nominationId, dsA.dsOfficeId!, officer)).toEqual({
      ok: false,
      error: "residenceNotAllowed",
    });
    // AMD-8: after the letter, the land is in its district.
    expect(await nominate(existing, nominationId, dsBuilt.dsOfficeId!, officer, { buildDsOfficeId: far.id })).toEqual({
      ok: false,
      error: "buildOfficeNotAllowed",
    });
    // CASE-12: the Application Number must be free in the nominated DS office.
    const taken = await saveCase(db, dsBuilt, {
      id: randomUUID(),
      version: null,
      dsOfficeId: null,
      buildDsOfficeId: null,
      values: values("අංකය ගත්", { applicationNumber: "nom/79" }),
      documentIds: [],
    });
    expect(taken).toMatchObject({ ok: true });
    expect(
      await nominate(existing, nominationId, dsBuilt.dsOfficeId!, officer, {
        values: values("අංකය එකම", { applicationNumber: "NOM/79" }),
      }),
    ).toEqual({ ok: false, error: "applicationNumberTaken" });
    expect((await db.nomination.findUniqueOrThrow({ where: { id: nominationId } })).status).toBe("WAITING");

    // A rejection tells the District officer who nominated, and the DS may ask again.
    const nominated = await nominate(existing, nominationId, dsBuilt.dsOfficeId!, officer);
    if (!nominated.ok) throw new Error(String(nominated.error));
    expect(
      await rejectAmendment(db, ministry, { amendmentId: nominated.value.id, version: 1, reason: REASON }),
    ).toMatchObject({ ok: true });
    expect(await noticesOf(officer, existing.id)).toContain("AMENDMENT_REJECTED");
    expect(await asked(await load(existing.id))).toBeTruthy();
  });

  it("leaves a CRPO's amendment of the same DS as before, with no District step (AC-79)", async () => {
    const existing = await received("එම කොට්ඨාසය");
    const id = await submitted(existing);
    expect(await db.nomination.count({ where: { caseId: existing.id } })).toBe(0);
    const result = await approve(id);
    if (!result.ok) throw new Error(String(result.error));
    expect(await load(result.caseId)).toMatchObject({ dsOfficeId: dsA.dsOfficeId, status: "ALLOCATION_RECEIVED" });
  });
});

describe("an approval refused (AMD-4, AMD-5, AC-46, AC-48, AC-66)", () => {
  it("is only for a Ministry officer, and only for an amendment the account may see", async () => {
    const existing = await newCase("අනුමත කළ නොහැකි");
    const id = await submitted(existing);
    for (const who of [dsA, accountant, secretary, await districtOfficer()]) {
      expect(await approve(id, who)).toEqual({ ok: false, error: "roleNotAllowed" });
      expect(await rejectAmendment(db, who, { amendmentId: id, version: 1, reason: REASON })).toEqual({
        ok: false,
        error: "roleNotAllowed",
      });
    }
    expect(await approve(id, dsFar)).toEqual({ ok: false, error: "notFound" });
    expect(await approve(randomUUID())).toEqual({ ok: false, error: "notFound" });
    expect((await db.amendment.findUniqueOrThrow({ where: { id } })).status).toBe("WAITING");
    expect((await load(existing.id)).status).toBe("AWAITING_ALLOCATION");
  });

  it("asks again when the District's release moved the money after the page was shown (AMD-11)", async () => {
    const existing = await allocate((await newCase("අසල ඉඩම")).id);
    const id = await submitted(existing, { buildDsOfficeId: dsBuilt.dsOfficeId });
    await releaseToDsForTests(db, [existing.id], { on: dayToDate(daysAgo(2)) });
    // The page asked for no return: it must be shown again, now asking for one.
    expect(await approve(id)).toEqual({ ok: false, error: "conflict" });
    const unchanged = await load(existing.id);
    expect(unchanged.status).toBe("ALLOCATION_RECEIVED");
    expect(await db.case.count({ where: { replacesCaseId: existing.id } })).toBe(0);
    // The Ministry can still reject it.
    expect(await rejectAmendment(db, ministry, { amendmentId: id, version: 1, reason: "ඉඩම වෙනත් කොට්ඨාසයක" })).toEqual(
      { ok: true, caseId: existing.id },
    );
  });

  it("is refused once an installment is paid, or decided, or changed meanwhile", async () => {
    const existing = await received("ගෙවූ පසු");
    const id = await submitted(existing);
    // AMD-3 holds the payment, so only a change made around the rules can do it; AMD-5 still refuses.
    await db.installment.updateMany({
      where: { caseId: existing.id, number: 1 },
      data: { status: "RELEASED", expectedOn: dayToDate(daysAgo(1)), releasedOn: dayToDate(today()) },
    });
    expect(await approve(id)).toEqual({ ok: false, error: "amendmentNotAllowed" });

    const other = await newCase("වෙනස් වූ");
    const otherId = await submitted(other);
    // CASE-10: the amendment or the case as the page showed it.
    expect(
      await approveAmendment(db, ministry, { amendmentId: otherId, version: 0, caseVersion: other.version }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await approveAmendment(db, ministry, { amendmentId: otherId, version: 1, caseVersion: other.version - 1 }),
    ).toEqual({ ok: false, error: "conflict" });
    expect(await approve(otherId)).toMatchObject({ ok: true });
    // Decided once only.
    expect(await approve(otherId)).toEqual({ ok: false, error: "amendmentDecided" });
    expect(await rejectAmendment(db, ministry, { amendmentId: otherId, version: 2, reason: REASON })).toEqual({
      ok: false,
      error: "amendmentDecided",
    });
  });
});

describe("rejecting an amendment (AMD-6, AC-47)", () => {
  it("leaves the case as it was, tells its CRPOs with the reason, and needs a reason", async () => {
    const existing = await newCase("ප්‍රතික්ෂේප වන", dsBuilt.dsOfficeId);
    const id = await submitted(existing, { buildDsOfficeId: dsBuilt.dsOfficeId });
    expect(await rejectAmendment(db, ministry, { amendmentId: id, version: 1, reason: "කෙටි" })).toEqual({
      ok: false,
      error: "reasonTooShort",
    });

    expect(await rejectAmendment(db, ministry, { amendmentId: id, version: 1, reason: "ලේඛන නොමැත" })).toEqual({
      ok: true,
      caseId: existing.id,
    });
    expect(await db.amendment.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "REJECTED",
      rejectionReason: "ලේඛන නොමැත",
      decidedById: ministry.userId,
      newCaseId: null,
    });
    expect(await load(existing.id)).toMatchObject({ status: "AWAITING_ALLOCATION", version: existing.version });
    expect(await noticesOf(dsA, existing.id)).toEqual(["AMENDMENT_REJECTED"]);
    expect(await noticesOf(dsBuilt, existing.id)).toEqual(["AMENDMENT_REJECTED"]);
    const history = await caseHistory(db, dsA, existing.id, "si");
    expect(history?.find((e) => e.action === "amendment_rejected")?.after).toMatchObject({
      reason: "ලේඛන නොමැත",
      name: "නව ප්‍රතිලාභී",
    });
    // The DS may submit another.
    expect(await amend(await load(existing.id), { buildDsOfficeId: dsBuilt.dsOfficeId })).toMatchObject({ ok: true });
  });
});

describe("a replaced case (STS-2, CASE-9, AC-71)", () => {
  it("can't be edited, deleted or given an installment or stage, and leaves the to-do panel", async () => {
    const existing = await received("අවසන් ප්‍රතිස්ථාපිත");
    const id = await submitted(existing);
    const result = await approve(id);
    if (!result.ok) throw new Error(String(result.error));
    const replaced = await db.case.findUniqueOrThrow({ where: { id: existing.id }, include: { centres: true } });
    expect(replaced.status).toBe("REPLACED");

    for (const who of [dsA, ministry]) {
      expect(
        await saveCase(db, who, {
          id: replaced.id,
          version: replaced.version,
          dsOfficeId: null,
          buildDsOfficeId: null,
          values: values("වෙනස් කළ නොහැකි", { applicationNumber: replaced.applicationNumber }),
          documentIds: [],
        }),
      ).toEqual({ ok: false, error: "notEditable" });
      expect(
        await deleteCase(db, who, { caseId: replaced.id, version: replaced.version, reason: "මකා දැමිය යුතුයි" }),
      ).toMatchObject({ ok: false });
    }
    expect(await start(dsA, replaced)).toMatchObject({ ok: false });
    expect(
      await recordStageUpdate(db, dsA, {
        caseId: replaced.id,
        version: replaced.version,
        form: { stageId: NOTE_ONLY, visitedOn: today(), note: "" },
        photoIds: [],
      }),
    ).toMatchObject({ ok: false });
    expect(await amend(replaced)).toEqual({ ok: false, error: "amendmentNotAllowed" });
    expect((await todoItems(db, dsA)).some((item) => item.id === replaced.id)).toBe(false);
  });
});

describe("the amendments lists (AMD-9, AC-67, AC-68)", () => {
  /** What each account should see: the amendments whose case is in its area (PRM-4), by a query of its own. */
  const visibleTo = (officeId: number | null, status: "WAITING" | "APPROVED" | "REJECTED") =>
    db.amendment.findMany({
      where: {
        status,
        ...(officeId === null ? {} : { case: { OR: [{ dsOfficeId: officeId }, { buildDsOfficeId: officeId }] } }),
      },
      select: { id: true },
    });
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

  it("lists each tab in the viewer's area only, waiting oldest first and decided newest first", async () => {
    // Two waiting, oldest first whatever order they were made in; one approved, two rejected a day apart.
    const later = await submitted(await newCase("ලැයිස්තු පසු"), {
      values: values("ලැයිස්තු නව පසු", { applicationNumber: "LST/2" }),
    });
    const earlier = await submitted(await newCase("ලැයිස්තු පෙර"), {
      values: values("ලැයිස්තු නව පෙර", { applicationNumber: "LST/1" }),
    });
    await db.amendment.update({ where: { id: earlier }, data: { submittedAt: new Date("2026-01-01T03:00:00Z") } });
    await db.amendment.update({ where: { id: later }, data: { submittedAt: new Date("2026-01-02T03:00:00Z") } });
    const approved = await submitted(await newCase("ලැයිස්තු අනුමත"));
    expect(await approve(approved)).toMatchObject({ ok: true });
    const rejectedFirst = await submitted(await newCase("ලැයිස්තු ප්‍රතික්ෂේප 1"));
    const rejectedLast = await submitted(await newCase("ලැයිස්තු ප්‍රතික්ෂේප 2"));
    for (const id of [rejectedFirst, rejectedLast]) {
      expect(await rejectAmendment(db, ministry, { amendmentId: id, version: 1, reason: "ලේඛන නොමැත" })).toMatchObject({
        ok: true,
      });
    }
    await db.amendment.update({ where: { id: rejectedFirst }, data: { decidedAt: new Date("2026-02-01T03:00:00Z") } });

    // dsA and its accountant see the office's amendments, each tab with its count.
    for (const who of [dsA, accountant]) {
      const counts = await countAmendments(db, who);
      for (const status of ["WAITING", "APPROVED", "REJECTED"] as const) {
        const expected = ids(await visibleTo(dsA.dsOfficeId, status));
        const list = await listAmendments(db, who, { status }, "si");
        expect(ids(list.rows), `${who.userId} ${status}`).toEqual(expected);
        expect(list.total).toBe(expected.length);
        expect(counts[status]).toBe(expected.length);
      }
    }

    const waiting = (await listAmendments(db, dsA, { status: "WAITING" }, "si")).rows.map((row) => row.id);
    expect(waiting.indexOf(earlier)).toBeLessThan(waiting.indexOf(later));
    const rejected = (await listAmendments(db, dsA, { status: "REJECTED" }, "si")).rows.map((row) => row.id);
    expect(rejected.indexOf(rejectedLast)).toBeLessThan(rejected.indexOf(rejectedFirst));

    // Each row names both beneficiaries and the DS office; a rejected one has its reason.
    const row = (await listAmendments(db, dsA, { status: "WAITING" }, "si")).rows.find((r) => r.id === earlier);
    const office = await db.dsOffice.findUniqueOrThrow({ where: { id: dsA.dsOfficeId ?? 0 } });
    expect(row).toMatchObject({
      status: "WAITING",
      decidedAt: null,
      officeName: office.nameSi,
      existing: { name: "ලැයිස්තු පෙර" },
      proposed: { name: "ලැයිස්තු නව පෙර", applicationNumber: "LST/1" },
    });
    expect((await listAmendments(db, dsA, { status: "REJECTED" }, "si")).rows[0]).toMatchObject({
      rejectionReason: "ලේඛන නොමැත",
    });

    // Another district's CRPO sees none of them; the Ministry and its Secretary see them all.
    for (const status of ["WAITING", "APPROVED", "REJECTED"] as const) {
      const far = ids((await listAmendments(db, dsFar, { status }, "si")).rows);
      expect(far).toEqual(ids(await visibleTo(dsFar.dsOfficeId, status)));
      expect(far).not.toContain(earlier);
      const all = ids(await visibleTo(null, status));
      for (const who of [ministry, secretary]) {
        expect((await countAmendments(db, who))[status]).toBe(all.length);
        expect((await listAmendments(db, who, { status }, "si")).total).toBe(all.length);
      }
    }
  });

  it("counts the waiting ones in the Ministry's menu only, and nothing for an admin", async () => {
    const waiting = await db.amendment.count({ where: { status: "WAITING" } });
    expect(waiting).toBeGreaterThan(0);
    expect((await amendmentsWaiting(db, ministry)).count).toBe(waiting);
    for (const who of [dsA, secretary]) expect((await amendmentsWaiting(db, who)).count).toBe(0);

    const admin = actor("amend-test-admin", "ADMIN", "");
    expect(await countAmendments(db, admin)).toEqual({ WAITING: 0, APPROVED: 0, REJECTED: 0 });
    expect(await listAmendments(db, admin, { status: "WAITING" }, "si")).toEqual({ rows: [], total: 0 });
  });
});
