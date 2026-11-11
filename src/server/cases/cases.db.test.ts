import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../../../tests/db/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import { colomboDay, dayToDate } from "@/lib/dates";
import type { CaseValues } from "@/lib/validation/case";
import { fileForViewer, uploadDocument } from "../files/uploads";
import { type Actor, deleteCase, removeDocument, saveCase, type SaveCaseInput } from "./commands";
import { findNicMatches } from "./duplicates";
import { getCase, listCases, officeMoney, todoItems } from "./queries";

const filesDir = mkdtempSync(join(tmpdir(), "diviyata-files-"));
process.env.FILES_DIR = filesDir;

const db = createTestClient();
const PDF = new TextEncoder().encode("%PDF-1.7\n% a made-up document\n");
const REASON = "දෙවරක් ඇතුළත් කර ඇත.";

let dsA: Actor;
let dsB: Actor;
let ho: Actor;
const admin: Actor = {
  userId: "cases-test-admin",
  role: "ADMIN",
  designation: null,
  districtId: null,
  provinceId: null,
  dsOfficeId: null,
};
let inactiveOfficeId: number;
let numberSeq = 0;

/** A complete, made-up case (SEC-11). Each test gives its own NIC so tests don't match each other. */
const values = (nic: string, overrides: Partial<CaseValues> = {}): CaseValues => ({
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
  applicationNumber: `CT/${(numberSeq += 1)}`,
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

const newCase = (nic: string, overrides: Partial<SaveCaseInput> = {}): SaveCaseInput => ({
  id: randomUUID(),
  version: null,
  dsOfficeId: null,
  buildDsOfficeId: null,
  values: values(nic),
  documentIds: [],
  ...overrides,
});

async function saved(actor: Actor, input: SaveCaseInput) {
  const result = await saveCase(db, actor, input);
  if (!result.ok) throw new Error(result.error);
  return db.case.findUniqueOrThrow({ where: { id: result.value.id } });
}

/** A change to a saved case, sending back what it holds with `changes` (CASE-9). */
async function change(actor: Actor, id: string, changes: Partial<CaseValues> = {}, input: Partial<SaveCaseInput> = {}) {
  const current = await db.case.findUniqueOrThrow({ where: { id } });
  return saveCase(db, actor, {
    id,
    version: current.version,
    dsOfficeId: null,
    buildDsOfficeId: current.buildDsOfficeId === current.dsOfficeId ? null : current.buildDsOfficeId,
    values: {
      category: current.category,
      kind: current.kind,
      applicationNumber: current.applicationNumber,
      childName: current.childName,
      name: current.name,
      nic: current.nic,
      address: current.address,
      gnDivision: current.gnDivision,
      mobile1: current.mobile1,
      mobile2: current.mobile2,
      remark: current.remark,
      ...changes,
    },
    documentIds: [],
    ...input,
  });
}

/** The Ministry's letter and the District's release are tasks 6 and 7; here the status is set directly. */
async function moveTo(id: string, status: CaseStatus) {
  return db.case.update({ where: { id }, data: { status, version: { increment: 1 } } });
}

/**
 * A case whose allocation its DS where built has received (REL-7): the Ministry's letter, the District's
 * release dated `day`, and its four installments, written directly until tasks 6 and 7 build them.
 */
async function received(id: string, day: string) {
  const found = await db.case.findUniqueOrThrow({
    where: { id },
    select: { buildDsOfficeId: true, buildDsOffice: { select: { districtId: true } } },
  });
  const letter = await db.releaseLetter.create({
    data: {
      id: randomUUID(),
      districtId: found.buildDsOffice.districtId,
      letterNumber: "CT/LETTER",
      letterDate: dayToDate(day),
      validUntil: dayToDate(day),
      byId: ho.userId,
    },
  });
  const dsRelease = await db.dsRelease.create({
    data: {
      id: randomUUID(),
      districtId: found.buildDsOffice.districtId,
      dsOfficeId: found.buildDsOfficeId,
      referenceNumber: "CT/DS",
      releasedOn: dayToDate(day),
      byId: ho.userId,
    },
  });
  await db.release.create({
    data: {
      id: randomUUID(),
      caseId: id,
      letterId: letter.id,
      releasedOn: dayToDate(day),
      dsReleaseId: dsRelease.id,
      dsReleasedOn: dayToDate(day),
      amount: 2_000_000,
      byId: ho.userId,
    },
  });
  await db.installment.createMany({
    data: [1, 2, 3, 4].map((number) => ({ id: randomUUID(), caseId: id, number, amount: 500_000 })),
  });
  return moveTo(id, "ALLOCATION_RECEIVED");
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
  dsA = await officer("cases-test-ds-a");
  dsB = await officer("cases-test-ds-b");
  await db.user.create({
    data: {
      id: "cases-test-ho",
      name: "ප්‍ර. පරීක්ෂණ",
      email: "cases-test-ho@no-email.invalid",
      role: "MINISTRY_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
    },
  });
  ho = {
    userId: "cases-test-ho",
    role: "MINISTRY_OFFICER",
    designation: "MINISTRY_PROGRAMME_OFFICER",
    districtId: null,
    provinceId: null,
    dsOfficeId: null,
  };
  await db.user.create({
    data: { id: admin.userId, name: "පරිපාලක", email: "cases-test-admin@no-email.invalid", role: "ADMIN" },
  });
  const district = await db.district.findFirstOrThrow();
  inactiveOfficeId = (
    await db.dsOffice.create({
      data: {
        code: "QQC",
        nameEn: "Cases Test Closed",
        nameSi: "පරීක්ෂණ වසා ඇත",
        nameTa: "சோதனை மூடப்பட்டது",
        districtId: district.id,
        active: false,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe("saving a new case (CASE-5, CASE-12, AC-50)", () => {
  it("goes straight to awaiting fund allocation, with the Application Number as typed and no decision", async () => {
    const input = newCase("200100000010", { values: values("200100000010", { applicationNumber: "KDW/147" }) });
    const result = await saveCase(db, dsA, input);
    expect(result).toEqual({
      ok: true,
      value: { id: input.id, applicationNumber: "KDW/147", status: "AWAITING_ALLOCATION", created: true },
    });

    const row = await db.case.findUniqueOrThrow({ where: { id: input.id } });
    expect(row).toMatchObject({
      status: "AWAITING_ALLOCATION",
      applicationNumber: "KDW/147",
      applicationKey: "KDW/147",
      version: 1,
      dsOfficeId: dsA.dsOfficeId,
      buildDsOfficeId: dsA.dsOfficeId,
    });
    expect(await db.decision.count({ where: { caseId: input.id } })).toBe(0);
    const actions = await db.auditLog.findMany({ where: { caseId: input.id }, orderBy: { id: "asc" } });
    expect(actions.map((a) => [a.action, a.actorId])).toEqual([["case_created", dsA.userId]]);
    expect(actions[0]?.after).toMatchObject({ applicationNumber: "KDW/147", status: "AWAITING_ALLOCATION" });
  });

  it("refuses the same number in the same DS, without case or spaces, but not in another DS", async () => {
    await saved(dsA, newCase("200100000011", { values: values("200100000011", { applicationNumber: "QQ/9" }) }));
    const again = await saveCase(
      db,
      dsA,
      newCase("200100000012", { values: values("200100000012", { applicationNumber: "qq / 9" }) }),
    );
    expect(again).toEqual({ ok: false, error: "applicationNumberTaken" });
    const elsewhere = await saved(
      dsB,
      newCase("200100000013", { values: values("200100000013", { applicationNumber: "qq / 9" }) }),
    );
    expect(elsewhere.applicationKey).toBe("QQ/9");
  });

  it("gives a number to one case only, even when two are saved at the same moment", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        saveCase(db, dsB, newCase(`20010000002${i}`, { values: values("", { applicationNumber: "SAME/1" }) })),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error)).toEqual(Array(3).fill("applicationNumberTaken"));
  });

  it("refuses a case with a required field empty, the Application Number included", async () => {
    for (const empty of [{ name: null }, { applicationNumber: null }, { kind: null }] as const) {
      expect(await saveCase(db, dsA, newCase("", { values: values("", empty) }))).toEqual({
        ok: false,
        error: "incomplete",
      });
    }
  });

  it("ignores an office a DS officer sends: theirs comes from the account (CASE-3)", async () => {
    const row = await saved(dsA, newCase("200100000001", { dsOfficeId: dsB.dsOfficeId }));
    expect(row.dsOfficeId).toBe(dsA.dsOfficeId);
  });

  it("creates one case when the same new form arrives twice (ERR-8)", async () => {
    const input = newCase("200100000002");
    await saveCase(db, dsA, input);
    const again = await saveCase(db, dsA, input);
    expect(again).toMatchObject({ ok: true, value: { id: input.id, status: "AWAITING_ALLOCATION" } });
    expect(await db.case.count({ where: { id: input.id } })).toBe(1);
  });

  it("stores the NIC's 12-digit key next to the NIC", async () => {
    const row = await saved(dsA, newCase("880101234V"));
    expect(row).toMatchObject({ nic: "880101234V", nicKey: "198801001234" });
  });
});

describe("where it is built (CASE-13)", () => {
  it("records another active DS office, or the DS of residence by default", async () => {
    const elsewhere = await saved(dsA, newCase("200100000030", { buildDsOfficeId: dsB.dsOfficeId }));
    expect(elsewhere).toMatchObject({ dsOfficeId: dsA.dsOfficeId, buildDsOfficeId: dsB.dsOfficeId });
    // Naming the DS of residence is the same as "the same DS division".
    const same = await saved(dsA, newCase("200100000031", { buildDsOfficeId: dsA.dsOfficeId }));
    expect(same.buildDsOfficeId).toBe(dsA.dsOfficeId);
  });

  it("refuses an inactive office or one that doesn't exist", async () => {
    expect(await saveCase(db, dsA, newCase("200100000032", { buildDsOfficeId: inactiveOfficeId }))).toEqual({
      ok: false,
      error: "officeInactive",
    });
    expect(await saveCase(db, dsA, newCase("200100000032", { buildDsOfficeId: 999_999 }))).toEqual({
      ok: false,
      error: "buildOfficeRequired",
    });
  });

  it("can change while the case awaits its allocation, and not after", async () => {
    const row = await saved(dsA, newCase("200100000033", { buildDsOfficeId: dsB.dsOfficeId }));
    expect(await change(dsA, row.id, {}, { buildDsOfficeId: null })).toMatchObject({ ok: true });
    expect((await db.case.findUniqueOrThrow({ where: { id: row.id } })).buildDsOfficeId).toBe(dsA.dsOfficeId);

    await moveTo(row.id, "ALLOCATED_TO_DISTRICT");
    expect(await change(ho, row.id, {}, { buildDsOfficeId: dsB.dsOfficeId })).toEqual({
      ok: false,
      error: "notEditable",
    });
    expect(await change(ho, row.id, { remark: "නිවැරදි කළා" })).toMatchObject({ ok: true });
  });

  it("lets the DS where it is built see the case but not change or delete it", async () => {
    const row = await saved(dsA, newCase("200100000034", { buildDsOfficeId: dsB.dsOfficeId }));
    expect(await getCase(db, dsB, row.id, "si")).toMatchObject({
      buildDsOfficeId: dsB.dsOfficeId,
      actsOn: { edit: false, progress: true, release: false },
    });
    expect(await change(dsB, row.id, { remark: "x" })).toEqual({ ok: false, error: "notEditable" });
    expect(await deleteCase(db, dsB, { caseId: row.id, version: row.version, reason: REASON })).toEqual({
      ok: false,
      error: "notAllowedNow",
    });
  });
});

describe("changing a case (CASE-9, CASE-10, AC-51)", () => {
  it("lets the DS change any detail while it awaits its allocation, logged with the old and new values", async () => {
    const row = await saved(dsA, newCase("200100000040"));
    const result = await change(dsA, row.id, { name: "නව නම", nic: "200100000049", applicationNumber: "CT/NEW" });
    expect(result).toMatchObject({ ok: true, value: { created: false, status: "AWAITING_ALLOCATION" } });

    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: row.id, action: "case_updated" } });
    expect(audit.before).toEqual({ applicationNumber: row.applicationNumber, name: row.name, nic: "200100000040" });
    expect(audit.after).toEqual({
      applicationNumber: "CT/NEW",
      name: "නව නම",
      nic: "200100000049",
      documentsAdded: [],
    });
    expect((await db.case.findUniqueOrThrow({ where: { id: row.id } })).applicationKey).toBe("CT/NEW");
  });

  it("refuses a form opened before someone else saved", async () => {
    const row = await saved(dsA, newCase("200100000041"));
    expect(await change(ho, row.id, { remark: "අමාත්‍යංශය" })).toMatchObject({ ok: true });

    const stale = await saveCase(db, dsA, { ...newCase("200100000041"), id: row.id, version: row.version });
    expect(stale).toEqual({ ok: false, error: "conflict" });
    expect((await db.case.findUniqueOrThrow({ where: { id: row.id } })).remark).toBe("අමාත්‍යංශය");
  });

  it("after the Ministry's letter, lets only the Ministry change it, logged, until it is completed", async () => {
    const row = await saved(dsA, newCase("200100000042"));
    await moveTo(row.id, "ALLOCATED_TO_DISTRICT");
    expect(await change(dsA, row.id, { name: "වෙනත් නමක්" })).toEqual({ ok: false, error: "notEditable" });

    expect(await change(ho, row.id, { name: "අමාත්‍යංශයේ නම" })).toMatchObject({ ok: true });
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: row.id, action: "case_updated" } });
    expect(audit).toMatchObject({ actorId: ho.userId, before: { name: row.name }, after: { name: "අමාත්‍යංශයේ නම" } });

    await moveTo(row.id, "COMPLETED");
    expect(await change(ho, row.id, { name: "තවත් නමක්" })).toEqual({ ok: false, error: "notEditable" });
  });

  it("answers 'not found' to another office and to an admin (PRM-1, PRM-2)", async () => {
    const row = await saved(dsA, newCase("200100000043"));
    for (const actor of [dsB, admin]) {
      expect(await change(actor, row.id)).toEqual({ ok: false, error: "notFound" });
      expect(await deleteCase(db, actor, { caseId: row.id, version: row.version, reason: REASON })).toEqual({
        ok: false,
        error: "notFound",
      });
      expect(await getCase(db, actor, row.id, "si")).toBeNull();
    }
    expect(await getCase(db, ho, row.id, "si")).not.toBeNull();
    expect(await saveCase(db, admin, newCase("200100000044"))).toEqual({ ok: false, error: "notFound" });
  });

  it("makes the Ministry choose an active office for a new case (CASE-3, LST-3)", async () => {
    expect(await saveCase(db, ho, newCase("200100000045"))).toEqual({ ok: false, error: "officeRequired" });
    expect(await saveCase(db, ho, newCase("200100000045", { dsOfficeId: inactiveOfficeId }))).toEqual({
      ok: false,
      error: "officeInactive",
    });
    const row = await saved(ho, newCase("200100000045", { dsOfficeId: dsB.dsOfficeId }));
    expect(row).toMatchObject({ dsOfficeId: dsB.dsOfficeId, buildDsOfficeId: dsB.dsOfficeId, createdById: ho.userId });
  });

  it("lets the Ministry move a case to another office while it awaits its allocation, and not after", async () => {
    const row = await saved(ho, newCase("200100000046", { dsOfficeId: dsA.dsOfficeId }));
    expect(await change(ho, row.id, {}, { dsOfficeId: dsB.dsOfficeId })).toMatchObject({ ok: true });
    // Built "in the same DS division", it moves with the case.
    expect(await db.case.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      dsOfficeId: dsB.dsOfficeId,
      buildDsOfficeId: dsB.dsOfficeId,
    });

    await moveTo(row.id, "ALLOCATED_TO_DISTRICT");
    expect(await change(ho, row.id, {}, { dsOfficeId: dsA.dsOfficeId })).toEqual({ ok: false, error: "notEditable" });
  });
});

describe("deleting a case (CASE-8, AC-51)", () => {
  it("removes a case awaiting its allocation and its documents, logging the number, office and reason", async () => {
    const upload = await uploadDocument(db, dsA, { name: "ලේඛනය.pdf", bytes: PDF });
    if (!upload.ok) throw new Error(upload.error);
    const row = await saved(dsA, newCase("200100000050", { documentIds: [upload.value.id] }));

    expect(await deleteCase(db, dsA, { caseId: row.id, version: row.version, reason: `  ${REASON}  ` })).toEqual({
      ok: true,
    });
    expect(await db.case.count({ where: { id: row.id } })).toBe(0);
    expect(await db.storedFile.count({ where: { id: upload.value.id } })).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: row.id, action: "case_deleted" } });
    expect(audit).toMatchObject({ actorId: dsA.userId, entityId: row.id });
    expect(audit.after).toEqual({
      applicationNumber: row.applicationNumber,
      dsOfficeId: dsA.dsOfficeId,
      reason: REASON,
    });
  });

  it("frees its Application Number", async () => {
    const row = await saved(
      dsA,
      newCase("200100000051", { values: values("200100000051", { applicationNumber: "CT/FREE" }) }),
    );
    await deleteCase(db, dsA, { caseId: row.id, version: row.version, reason: REASON });
    expect(
      await saveCase(
        db,
        dsA,
        newCase("200100000051", { values: values("200100000051", { applicationNumber: "CT/FREE" }) }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("needs a reason of 5 to 1,000 characters, and the version the page showed", async () => {
    const row = await saved(ho, newCase("200100000052", { dsOfficeId: dsA.dsOfficeId }));
    const remove = (reason: string, version = row.version) => deleteCase(db, ho, { caseId: row.id, version, reason });
    expect(await remove("")).toEqual({ ok: false, error: "reasonRequired" });
    expect(await remove("අඩු")).toEqual({ ok: false, error: "reasonTooShort" });
    expect(await remove("x".repeat(1001))).toEqual({ ok: false, error: "reasonTooLong" });
    expect(await remove(REASON, row.version - 1)).toEqual({ ok: false, error: "conflict" });
    expect(await remove(REASON)).toEqual({ ok: true });
  });

  it("refuses once the Ministry has allocated it, for the DS and the Ministry alike", async () => {
    const row = await saved(dsA, newCase("200100000053"));
    const moved = await moveTo(row.id, "ALLOCATED_TO_DISTRICT");
    for (const actor of [dsA, ho]) {
      expect(await deleteCase(db, actor, { caseId: row.id, version: moved.version, reason: REASON })).toEqual({
        ok: false,
        error: "notAllowedNow",
      });
    }
    expect(await db.case.count({ where: { id: row.id } })).toBe(1);
  });
});

describe("duplicate NIC (CASE-6, AC-7)", () => {
  it("matches old and new formats, and shows less about another office's case", async () => {
    const own = await saved(dsA, newCase("198802001234"));
    const elsewhere = await saved(dsB, newCase("880201234V"));

    const asA = await findNicMatches(db, dsA, { nic: "880201234v", dsOfficeId: null, exceptCaseId: null }, "si");
    expect(asA).toEqual([
      { applicationNumber: own.applicationNumber, name: own.name, officeName: null },
      { applicationNumber: elsewhere.applicationNumber, name: null, officeName: expect.any(String) },
    ]);

    const asHo = await findNicMatches(db, ho, { nic: "198802001234", dsOfficeId: null, exceptCaseId: own.id }, "si");
    expect(asHo).toEqual([
      { applicationNumber: elsewhere.applicationNumber, name: elsewhere.name, officeName: expect.any(String) },
    ]);
  });

  it("finds nothing for an invalid NIC, or for an admin", async () => {
    await saved(dsA, newCase("198803001234"));
    expect(await findNicMatches(db, dsA, { nic: "12345", dsOfficeId: null, exceptCaseId: null }, "si")).toEqual([]);
    expect(await findNicMatches(db, admin, { nic: "880301234V", dsOfficeId: null, exceptCaseId: null }, "si")).toEqual(
      [],
    );
  });
});

describe("documents (CASE-2, SEC-7)", () => {
  it("stores an upload under a random name, and only its uploader can open it until the case is saved", async () => {
    const upload = await uploadDocument(db, dsA, { name: "C:\\fakepath\\ලේඛනය.pdf", bytes: PDF });
    if (!upload.ok) throw new Error(upload.error);
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: upload.value.id } });

    expect(row).toMatchObject({
      originalName: "ලේඛනය.pdf",
      mimeType: "application/pdf",
      size: PDF.length,
      caseId: null,
    });
    expect(row.storedName).not.toContain("ලේඛනය");
    expect(await fileForViewer(db, dsA, row.id)).not.toBeNull();
    expect(await fileForViewer(db, ho, row.id)).toBeNull();

    const saved_ = await saved(dsA, newCase("200100000060", { documentIds: [row.id] }));
    expect(await fileForViewer(db, ho, row.id)).not.toBeNull();
    expect(await fileForViewer(db, dsB, row.id)).toBeNull();
    expect(await fileForViewer(db, admin, row.id)).toBeNull();
    expect((await getCase(db, dsA, saved_.id, "si"))?.documents).toEqual([{ id: row.id, name: "ලේඛනය.pdf" }]);
  });

  it("refuses a file whose contents are not a PDF, JPEG or PNG, whatever its name (ERR-5)", async () => {
    const result = await uploadDocument(db, dsA, { name: "ලේඛනය.pdf", bytes: new TextEncoder().encode("<html>") });
    expect(result).toEqual({ ok: false, error: "fileType" });
    expect(await uploadDocument(db, admin, { name: "a.pdf", bytes: PDF })).toEqual({ ok: false, error: "notAllowed" });
  });

  it("attaches only the person's own new uploads, at most 10 per case", async () => {
    const others = await uploadDocument(db, dsB, { name: "b.pdf", bytes: PDF });
    if (!others.ok) throw new Error(others.error);
    expect(await saveCase(db, dsA, newCase("200100000061", { documentIds: [others.value.id] }))).toEqual({
      ok: false,
      error: "fileUnavailable",
    });

    const eleven = [];
    for (let i = 0; i < 11; i += 1) {
      const upload = await uploadDocument(db, dsA, { name: `${i}.pdf`, bytes: PDF });
      if (upload.ok) eleven.push(upload.value.id);
    }
    expect(await saveCase(db, dsA, newCase("200100000062", { documentIds: eleven }))).toEqual({
      ok: false,
      error: "tooManyFiles",
    });
  });

  it("takes a document off a case awaiting its allocation without deleting the file", async () => {
    const upload = await uploadDocument(db, dsA, { name: "c.pdf", bytes: PDF });
    if (!upload.ok) throw new Error(upload.error);
    const row = await saved(dsA, newCase("200100000063", { documentIds: [upload.value.id] }));

    expect(await removeDocument(db, dsB, row.id, upload.value.id)).toEqual({ ok: false, error: "notFound" });
    expect(await removeDocument(db, dsA, row.id, upload.value.id)).toEqual({ ok: true, value: null });
    expect((await getCase(db, dsA, row.id, "si"))?.documents).toEqual([]);
    expect(await fileForViewer(db, dsA, upload.value.id)).toBeNull();
    expect(await db.storedFile.count({ where: { id: upload.value.id } })).toBe(1);
  });
});

describe("lists, to-do and money (HOME-1 to HOME-4, FND-1)", () => {
  it("finds a case by either NIC format or its Application Number, only within the viewer's offices", async () => {
    const own = await saved(
      dsA,
      newCase("198804001234", { values: values("198804001234", { applicationNumber: "Find Me/7" }) }),
    );
    const search = (actor: Actor, q: string) =>
      listCases(db, actor, { q }, "si").then((r) => r.rows.map((row) => row.id));

    expect(await search(dsA, "880401234V")).toEqual([own.id]);
    expect(await search(dsA, "198804001234")).toEqual([own.id]);
    expect(await search(dsA, "findme / 7")).toEqual([own.id]);
    expect(await search(dsB, "880401234V")).toEqual([]);
    expect(await search(ho, "880401234V")).toEqual([own.id]);
    expect(await search(admin, "880401234V")).toEqual([]);
  });

  it("lists a case built in another DS under both offices, with both names", async () => {
    const row = await saved(dsA, newCase("200100000071", { buildDsOfficeId: dsB.dsOfficeId }));
    for (const actor of [dsA, dsB]) {
      const list = await listCases(db, actor, { q: row.applicationNumber ?? "" }, "si");
      expect(list.rows).toEqual([
        expect.objectContaining({
          id: row.id,
          dsOfficeId: dsA.dsOfficeId,
          buildDsOfficeId: dsB.dsOfficeId,
          buildOfficeName: expect.any(String),
        }),
      ]);
    }
  });

  it("puts a received allocation in the to-do panel of the DS where it is built, and counts its money there", async () => {
    const before = await officeMoney(db, dsB);
    const row = await saved(dsA, newCase("200100000072", { buildDsOfficeId: dsB.dsOfficeId }));
    const day = colomboDay(new Date());
    await received(row.id, day);

    expect(await todoItems(db, dsB)).toContainEqual(
      expect.objectContaining({ id: row.id, type: "received", releasedOn: day }),
    );
    expect((await todoItems(db, dsA)).some((item) => item.id === row.id)).toBe(false);
    // HOME-4: the District's release counts as received, where the house is built.
    expect(await officeMoney(db, dsB)).toEqual({
      received: (before?.received ?? 0) + 2_000_000,
      paidOut: before?.paidOut ?? 0,
      balance: (before?.balance ?? 0) + 2_000_000,
    });
  });

  it("leaves a case out of the to-do panel once its first installment has started", async () => {
    const row = await saved(dsB, newCase("200100000073"));
    await received(row.id, colomboDay(new Date()));
    await db.installment.update({
      where: { caseId_number: { caseId: row.id, number: 1 } },
      data: { status: "PROCESSING", expectedOn: dayToDate(colomboDay(new Date())) },
    });
    const items = (await todoItems(db, dsB)).filter((item) => item.id === row.id);
    expect(items).toEqual([expect.objectContaining({ type: "due", number: 1, overdue: false })]);
  });
});
