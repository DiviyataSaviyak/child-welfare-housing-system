import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../../../tests/db/client";
import { colomboYear } from "@/lib/dates";
import type { CaseValues } from "@/lib/validation/case";
import { fileForViewer, uploadDocument } from "../files/uploads";
import { type Actor, deleteDraft, removeDocument, saveCase, type SaveCaseInput } from "./commands";
import { decideCase } from "./decide";
import { findNicMatches } from "./duplicates";
import { getCase, listCases, todoItems } from "./queries";

const filesDir = mkdtempSync(join(tmpdir(), "diviyata-files-"));
process.env.FILES_DIR = filesDir;

const db = createTestClient();
const YEAR = colomboYear(new Date());
const PDF = new TextEncoder().encode("%PDF-1.7\n% a made-up document\n");

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
let codeA: string;
let inactiveOfficeId: number;

/** A complete, made-up case (SEC-11). Each test gives its own NIC so tests don't match each other. */
const values = (nic: string, overrides: Partial<CaseValues> = {}): CaseValues => ({
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
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
  values: values(nic),
  documentIds: [],
  submit: false,
  ...overrides,
});

async function saved(actor: Actor, input: SaveCaseInput) {
  const result = await saveCase(db, actor, input);
  if (!result.ok) throw new Error(result.error);
  return db.case.findUniqueOrThrow({ where: { id: result.value.id } });
}

/** Head Office sends a submitted case back to its office (CHK-3). */
async function sendBack(id: string, reason = "ලිපිනය සම්පූර්ණ නැත.") {
  const sent = await db.case.findUniqueOrThrow({ where: { id } });
  const result = await decideCase(db, ho, { caseId: id, version: sent.version, decision: "sendBack", reason });
  if (!result.ok) throw new Error(result.error);
  return db.case.findUniqueOrThrow({ where: { id } });
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
  codeA = (await db.dsOffice.findUniqueOrThrow({ where: { id: dsA.dsOfficeId as number } })).code;
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

describe("saving a draft (CASE-4)", () => {
  it("keeps whatever is filled in, in the officer's own office, and logs it", async () => {
    const input = newCase("", { values: { ...values(""), category: null, kind: null, address: null } });
    const draft = await saved(dsA, input);

    expect(draft).toMatchObject({ status: "DRAFT", caseNumber: null, version: 1, dsOfficeId: dsA.dsOfficeId });
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: draft.id, action: "case_created" } });
    expect(audit.actorId).toBe(dsA.userId);
  });

  it("ignores an office a DS officer sends: theirs comes from the account (CASE-3)", async () => {
    const draft = await saved(dsA, newCase("200100000001", { dsOfficeId: dsB.dsOfficeId }));
    expect(draft.dsOfficeId).toBe(dsA.dsOfficeId);
  });

  it("creates one case when the same new form arrives twice (ERR-8)", async () => {
    const input = newCase("200100000002");
    await saveCase(db, dsA, input);
    const again = await saveCase(db, dsA, input);
    expect(again).toMatchObject({ ok: true, value: { id: input.id, status: "DRAFT" } });
    expect(await db.case.count({ where: { id: input.id } })).toBe(1);
  });

  it("stores the NIC's 12-digit key next to the NIC", async () => {
    const draft = await saved(dsA, newCase("880101234V"));
    expect(draft).toMatchObject({ nic: "880101234V", nicKey: "198801001234" });
  });
});

describe("submitting (CASE-5)", () => {
  it("gives the office's next number for the year, and records the decision", async () => {
    const first = await saved(dsA, newCase("200100000010", { submit: true }));
    const second = await saved(dsA, newCase("200100000011", { submit: true }));

    expect(first.status).toBe("SUBMITTED");
    expect(first.caseNumber).toMatch(new RegExp(`^${codeA}-${YEAR}-\\d{3,}$`));
    expect(Number(second.caseNumber?.split("-")[2])).toBe(Number(first.caseNumber?.split("-")[2]) + 1);
    expect(first.submittedAt).not.toBeNull();
    expect(await db.decision.count({ where: { caseId: first.id, type: "SUBMIT", byId: dsA.userId } })).toBe(1);
    const actions = await db.auditLog.findMany({ where: { caseId: first.id }, orderBy: { id: "asc" } });
    expect(actions.map((a) => a.action)).toEqual(["case_created", "case_submitted"]);
  });

  it("never gives two cases the same number, even when submitted at the same moment", async () => {
    const drafts = await Promise.all(Array.from({ length: 8 }, (_, i) => saved(dsB, newCase(`20010000002${i}`))));
    const results = await Promise.all(
      drafts.map((d) => saveCase(db, dsB, { ...newCase(d.nic ?? ""), id: d.id, version: d.version, submit: true })),
    );
    const numbers = results.map((r) => (r.ok ? r.value.caseNumber : r.error));
    const sequences = numbers.map((n) => Number(n?.split("-")[2])).sort((a, b) => a - b);

    expect(new Set(numbers).size).toBe(8);
    expect(sequences.at(-1)! - sequences[0]!).toBe(7);
  });

  it("refuses a case with a required field empty", async () => {
    const result = await saveCase(db, dsA, newCase("", { submit: true, values: values("", { name: null }) }));
    expect(result).toEqual({ ok: false, error: "incomplete" });
  });

  it("keeps the number when a returned case is submitted again", async () => {
    const first = await saved(dsA, newCase("200100000030", { submit: true }));
    const returned = await sendBack(first.id);

    const again = await saved(dsA, {
      ...newCase("200100000030"),
      id: first.id,
      version: returned.version,
      submit: true,
    });
    expect(again).toMatchObject({ status: "SUBMITTED", caseNumber: first.caseNumber });
  });
});

describe("who may change a case", () => {
  it("refuses a form opened before someone else saved (CASE-10)", async () => {
    const draft = await saved(dsA, newCase("200100000040"));
    await saved(ho, {
      ...newCase("200100000040"),
      id: draft.id,
      version: draft.version,
      values: values("200100000040", { remark: "අමාත්‍යංශය" }),
    });

    const stale = await saveCase(db, dsA, { ...newCase("200100000040"), id: draft.id, version: draft.version });
    expect(stale).toEqual({ ok: false, error: "conflict" });
    expect((await db.case.findUniqueOrThrow({ where: { id: draft.id } })).remark).toBe("අමාත්‍යංශය");
  });

  it("lets nobody change a case while Head Office checks it (STS-3)", async () => {
    const sent = await saved(dsA, newCase("200100000041", { submit: true }));
    for (const actor of [dsA, ho]) {
      const result = await saveCase(db, actor, { ...newCase("200100000041"), id: sent.id, version: sent.version });
      expect(result).toEqual({ ok: false, error: "notEditable" });
    }
  });

  it("answers 'not found' to another office and to an admin (PRM-1, PRM-2)", async () => {
    const draft = await saved(dsA, newCase("200100000042"));
    for (const actor of [dsB, admin]) {
      expect(await saveCase(db, actor, { ...newCase("200100000042"), id: draft.id, version: draft.version })).toEqual({
        ok: false,
        error: "notFound",
      });
      expect(await deleteDraft(db, actor, draft.id)).toEqual({ ok: false, error: "notFound" });
      expect(await getCase(db, actor, draft.id, "si")).toBeNull();
    }
    expect(await getCase(db, ho, draft.id, "si")).not.toBeNull();
    expect(await saveCase(db, admin, newCase("200100000043"))).toEqual({ ok: false, error: "notFound" });
  });

  it("makes Head Office choose an active office for a new case (CASE-3, LST-3)", async () => {
    expect(await saveCase(db, ho, newCase("200100000044"))).toEqual({ ok: false, error: "officeRequired" });
    expect(await saveCase(db, ho, newCase("200100000044", { dsOfficeId: inactiveOfficeId }))).toEqual({
      ok: false,
      error: "officeInactive",
    });
    const draft = await saved(ho, newCase("200100000044", { dsOfficeId: dsB.dsOfficeId }));
    expect(draft).toMatchObject({ dsOfficeId: dsB.dsOfficeId, createdById: ho.userId });
  });

  it("lets Head Office move a draft to another office, but not a numbered case", async () => {
    const draft = await saved(ho, newCase("200100000045", { dsOfficeId: dsA.dsOfficeId }));
    const moved = await saved(ho, {
      ...newCase("200100000045"),
      id: draft.id,
      version: draft.version,
      dsOfficeId: dsB.dsOfficeId,
    });
    expect(moved.dsOfficeId).toBe(dsB.dsOfficeId);

    const sent = await saved(ho, { ...newCase("200100000045"), id: draft.id, version: moved.version, submit: true });
    const returned = await sendBack(sent.id);
    const result = await saveCase(db, ho, {
      ...newCase("200100000045"),
      id: draft.id,
      version: returned.version,
      dsOfficeId: dsA.dsOfficeId,
    });
    expect(result).toEqual({ ok: false, error: "notEditable" });
  });
});

describe("deleting a draft (CASE-8)", () => {
  it("removes the draft and its documents, and logs it without personal details", async () => {
    const upload = await uploadDocument(db, dsA, { name: "ලේඛනය.pdf", bytes: PDF });
    if (!upload.ok) throw new Error(upload.error);
    const draft = await saved(dsA, newCase("200100000050", { documentIds: [upload.value.id] }));

    expect(await deleteDraft(db, dsA, draft.id)).toEqual({ ok: true, value: null });
    expect(await db.case.count({ where: { id: draft.id } })).toBe(0);
    expect(await db.storedFile.count({ where: { id: upload.value.id } })).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: draft.id, action: "case_draft_deleted" } });
    expect(audit.after).toEqual({ dsOfficeId: dsA.dsOfficeId });
  });

  it("refuses a case that has been submitted", async () => {
    const sent = await saved(dsA, newCase("200100000051", { submit: true }));
    expect(await deleteDraft(db, dsA, sent.id)).toEqual({ ok: false, error: "notEditable" });
  });
});

describe("duplicate NIC (CASE-6, AC-7)", () => {
  it("matches old and new formats, and shows less about another office's case", async () => {
    const own = await saved(dsA, newCase("198802001234", { submit: true }));
    const elsewhere = await saved(dsB, newCase("880201234V", { submit: true }));
    await saved(dsB, newCase("880201234V")); // a draft in the other office stays out of sight

    const asA = await findNicMatches(db, dsA, { nic: "880201234v", dsOfficeId: null, exceptCaseId: null }, "si");
    expect(asA).toEqual([
      { caseNumber: own.caseNumber, name: own.name, officeName: null },
      { caseNumber: elsewhere.caseNumber, name: null, officeName: expect.any(String) },
    ]);

    const asHo = await findNicMatches(db, ho, { nic: "198802001234", dsOfficeId: null, exceptCaseId: own.id }, "si");
    expect(asHo).toEqual([{ caseNumber: elsewhere.caseNumber, name: elsewhere.name, officeName: expect.any(String) }]);
  });

  it("includes the office's own drafts, and finds nothing for an invalid NIC", async () => {
    const draft = await saved(dsA, newCase("198803001234"));
    expect(await findNicMatches(db, dsA, { nic: "880301234V", dsOfficeId: null, exceptCaseId: null }, "si")).toEqual([
      { caseNumber: null, name: draft.name, officeName: null },
    ]);
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

    const draft = await saved(dsA, newCase("200100000060", { documentIds: [row.id] }));
    expect(await fileForViewer(db, ho, row.id)).not.toBeNull();
    expect(await fileForViewer(db, dsB, row.id)).toBeNull();
    expect(await fileForViewer(db, admin, row.id)).toBeNull();
    expect((await getCase(db, dsA, draft.id, "si"))?.documents).toEqual([{ id: row.id, name: "ලේඛනය.pdf" }]);
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

  it("takes a document off a draft without deleting the file", async () => {
    const upload = await uploadDocument(db, dsA, { name: "c.pdf", bytes: PDF });
    if (!upload.ok) throw new Error(upload.error);
    const draft = await saved(dsA, newCase("200100000063", { documentIds: [upload.value.id] }));

    expect(await removeDocument(db, dsB, draft.id, upload.value.id)).toEqual({ ok: false, error: "notFound" });
    expect(await removeDocument(db, dsA, draft.id, upload.value.id)).toEqual({ ok: true, value: null });
    expect((await getCase(db, dsA, draft.id, "si"))?.documents).toEqual([]);
    expect(await fileForViewer(db, dsA, upload.value.id)).toBeNull();
    expect(await db.storedFile.count({ where: { id: upload.value.id } })).toBe(1);
  });
});

describe("lists (HOME-1 to HOME-3, FND-1)", () => {
  it("finds a case by either NIC format, only within the viewer's office", async () => {
    const own = await saved(dsA, newCase("198804001234"));
    const search = (actor: Actor, q: string) =>
      listCases(db, actor, { q }, "si").then((r) => r.rows.map((row) => row.id));

    expect(await search(dsA, "880401234V")).toEqual([own.id]);
    expect(await search(dsA, "198804001234")).toEqual([own.id]);
    expect(await search(dsB, "880401234V")).toEqual([]);
    expect(await search(ho, "880401234V")).toEqual([own.id]);
    expect(await search(admin, "880401234V")).toEqual([]);
  });

  it("puts returned cases, with Head Office's reason, before drafts in the to-do panel", async () => {
    const sent = await saved(dsA, newCase("200100000070", { submit: true }));
    await sendBack(sent.id);

    const items = await todoItems(db, dsA);
    expect(items[0]).toMatchObject({ id: sent.id, type: "returned", reason: "ලිපිනය සම්පූර්ණ නැත." });
    expect(items.slice(1).every((item) => item.type === "draft")).toBe(true);
    expect((await getCase(db, dsA, sent.id, "si"))?.returnReason).toBe("ලිපිනය සම්පූර්ණ නැත.");
    expect(await todoItems(db, dsB).then((all) => all.some((item) => item.id === sent.id))).toBe(false);
  });
});
