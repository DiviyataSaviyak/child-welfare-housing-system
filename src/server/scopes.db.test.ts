import { randomUUID } from "node:crypto";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed-data";
import { createTestClient } from "../../tests/db/client";
import messages from "../../messages/si.json";
import type { CaseValues } from "@/lib/validation/case";
import { type Designation, roleOf } from "./auth/designations";
import { type Actor, deleteDraft, saveCase } from "./cases/commands";
import { decideCase } from "./cases/decide";
import { caseWhere, getCase } from "./cases/queries";
import { stopCase } from "./cases/stop";
import { dashboard } from "./dashboard/queries";
import { exportCaseList } from "./exports/case-list";
import { fileForViewer, uploadDocument, uploadPhoto } from "./files/uploads";
import { caseHistory } from "./history/queries";
import { startInstallment } from "./installments/commands";
import { viewerArea } from "./lists/queries";
import { recordLetter } from "./releases/commands";
import { recordStageUpdate } from "./stages/commands";

/**
 * PRM-4 and PRM-5 (change 0005): each account sees the cases of its own area, through the case's DS
 * office, and an account that only views changes nothing, even when it calls a command directly.
 * Cases in four offices: two in one district, one in another district of the same province, and one
 * in another province.
 */

const db = createTestClient();
const t = createTranslator({ locale: "si", messages, namespace: "cases" });

type Office = { id: number; districtId: number; provinceId: number };
let home: Office; // the first district's first office
let sameDistrict: Office;
let sameProvince: Office; // another district, same province
let otherProvince: Office;
let headOffice: Actor;
const caseIn = new Map<number, string>(); // office id → its test case
let documentId: string; // on the case in the other province

const PDF = new TextEncoder().encode("%PDF-1.4\n%made-up test file\n");

const values = (nic: string): CaseValues => ({
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
  childName: null,
  name: "විෂය පරීක්ෂණ",
  nic,
  address: "නො. 5, පරීක්ෂණ පාර",
  gnDivision: null,
  mobile1: "0710000005",
  mobile2: null,
  remark: null,
});

/** An account as the server sees it; only Head Office's is in the database, as the cases' author. */
function as(designation: Designation | null, place: Partial<Pick<Actor, "dsOfficeId" | "districtId" | "provinceId">>) {
  return {
    userId: `scope-${designation ?? "admin"}`,
    role: roleOf(designation),
    designation,
    dsOfficeId: null,
    districtId: null,
    provinceId: null,
    ...place,
  } satisfies Actor;
}

beforeAll(async () => {
  await seed(db);
  const offices = await db.dsOffice.findMany({
    where: { active: true },
    orderBy: { id: "asc" },
    select: { id: true, districtId: true, district: { select: { provinceId: true } } },
  });
  const all = offices.map((o) => ({ id: o.id, districtId: o.districtId, provinceId: o.district.provinceId }));
  // A district with two offices whose province has another district with an office.
  for (const first of all) {
    const twin = all.find((o) => o.id !== first.id && o.districtId === first.districtId);
    const neighbour = all.find((o) => o.provinceId === first.provinceId && o.districtId !== first.districtId);
    const far = all.find((o) => o.provinceId !== first.provinceId);
    if (twin && neighbour && far) {
      [home, sameDistrict, sameProvince, otherProvince] = [first, twin, neighbour, far];
      break;
    }
  }
  expect(otherProvince).toBeDefined();

  const ho = await db.user.create({
    data: {
      id: "scope-head-office",
      name: "විෂය ප්‍රධාන කාර්යාල",
      email: "scope-head-office@no-email.invalid",
      username: "scope-head-office",
      role: "HO_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
    },
  });
  headOffice = { ...as("MINISTRY_PROGRAMME_OFFICER", {}), userId: ho.id };

  const upload = await uploadDocument(db, headOffice, { name: "ලේඛනය.pdf", bytes: PDF });
  if (!upload.ok) throw new Error(upload.error);
  documentId = upload.value.id;

  for (const [index, office] of [home, sameDistrict, sameProvince, otherProvince].entries()) {
    const saved = await saveCase(db, headOffice, {
      id: randomUUID(),
      version: null,
      dsOfficeId: office.id,
      values: values(`19900000${index}${index}${index}${index}`),
      documentIds: office === otherProvince ? [documentId] : [],
      submit: true,
    });
    if (!saved.ok) throw new Error(saved.error);
    caseIn.set(office.id, saved.value.id);
  }
});

afterAll(() => db.$disconnect());

/** Which of the four test cases the account's list holds. */
async function listed(viewer: Actor): Promise<number[]> {
  const where = caseWhere(viewer, {});
  if (!where) return [];
  const found = await db.case.findMany({
    where: { AND: [where, { id: { in: [...caseIn.values()] } }] },
    select: { dsOfficeId: true },
  });
  return found.map((c) => c.dsOfficeId).sort((a, b) => a - b);
}

const ids = (...offices: Office[]) => offices.map((o) => o.id).sort((a, b) => a - b);

describe("each account sees the cases of its own area (PRM-4, AC-41)", () => {
  const cases = () =>
    [
      ["a CRPO", as("DS_CRPO", { dsOfficeId: home.id }), ids(home)],
      ["a Divisional Secretary", as("DS_SECRETARY", { dsOfficeId: home.id }), ids(home)],
      ["a District CRPO", as("DISTRICT_CRPO", { districtId: home.districtId }), ids(home, sameDistrict)],
      ["a District Secretary", as("DISTRICT_SECRETARY", { districtId: home.districtId }), ids(home, sameDistrict)],
      [
        "a Provincial Commissioner",
        as("PROVINCE_COMMISSIONER", { provinceId: home.provinceId }),
        ids(home, sameDistrict, sameProvince),
      ],
      [
        "the Department's Commissioner",
        as("DEPARTMENT_COMMISSIONER", {}),
        ids(home, sameDistrict, sameProvince, otherProvince),
      ],
      ["the Ministry's Secretary", as("MINISTRY_SECRETARY", {}), ids(home, sameDistrict, sameProvince, otherProvince)],
      ["an admin", as(null, {}), []],
    ] as const;

  it("lists only the area's cases", async () => {
    for (const [label, viewer, expected] of cases()) {
      expect(await listed(viewer), label).toEqual(expected);
    }
  });

  it('opens a case, its history and its files only inside the area; outside is "not found"', async () => {
    for (const [label, viewer, expected] of cases()) {
      for (const [officeId, caseId] of caseIn) {
        const inArea = expected.includes(officeId as never);
        expect((await getCase(db, viewer, caseId, "si")) !== null, `${label}, case of ${officeId}`).toBe(inArea);
        expect((await caseHistory(db, viewer, caseId, "si")) !== null, `${label}, history of ${officeId}`).toBe(inArea);
      }
      const fileInArea = expected.includes(otherProvince.id as never);
      expect((await fileForViewer(db, viewer, documentId)) !== null, `${label}, file`).toBe(fileInArea);
    }
  });

  it("counts on the dashboard only the area's offices", async () => {
    const district = as("DISTRICT_SECRETARY", { districtId: home.districtId });
    const offices = await db.dsOffice.findMany({ where: { districtId: home.districtId }, select: { id: true } });
    const own = new Set(offices.map((o) => o.id));
    const figures = await dashboard(db, district, {}, "si");
    expect([...figures.byOffice.keys()].every((id) => own.has(id))).toBe(true);
    expect(figures.byOffice.has(home.id)).toBe(true);

    // A chosen district narrows the area; it never widens it.
    const elsewhere = await dashboard(db, district, { districtId: otherProvince.districtId }, "si");
    expect(elsewhere.byOffice.size).toBe(0);
    const province = as("PROVINCE_COMMISSIONER", { provinceId: home.provinceId });
    const outside = await dashboard(db, province, { districtId: otherProvince.districtId }, "si");
    expect(outside.byOffice.size).toBe(0);
  });

  it("offers in the view-only area's filters only the area's places", async () => {
    const officesOf = (districtId: number) =>
      db.dsOffice.findMany({ where: { districtId }, orderBy: { id: "asc" }, select: { id: true } });
    const placesOf = async (viewer: Actor) =>
      (await viewerArea(db, viewer, "si")).districts.map((d) => [d.id, d.offices.map((o) => o.id)]);

    const office = await viewerArea(db, as("DS_SECRETARY", { dsOfficeId: home.id }), "si");
    const homeOffice = await db.dsOffice.findUniqueOrThrow({ where: { id: home.id }, select: { nameSi: true } });
    expect(office).toMatchObject({ kind: "office", name: homeOffice.nameSi });
    expect(await placesOf(as("DS_SECRETARY", { dsOfficeId: home.id }))).toEqual([[home.districtId, [home.id]]]);

    const ownOffices = (await officesOf(home.districtId)).map((o) => o.id);
    expect(await placesOf(as("DISTRICT_SECRETARY", { districtId: home.districtId }))).toEqual([
      [home.districtId, ownOffices],
    ]);

    const provinceDistricts = await db.district.findMany({
      where: { provinceId: home.provinceId },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const province = await placesOf(as("PROVINCE_COMMISSIONER", { provinceId: home.provinceId }));
    expect(province.map(([id]) => id)).toEqual(provinceDistricts.map((d) => d.id));

    const all = await placesOf(as("MINISTRY_SECRETARY", {}));
    expect(all).toHaveLength(await db.district.count());
    expect(await viewerArea(db, as(null, {}), "si")).toEqual({ kind: "none", name: null, districts: [] });
  });

  it("downloads only the area's cases, and records the download (EXP-3)", async () => {
    const viewer = as("DISTRICT_SECRETARY", { districtId: home.districtId });
    const file = (await exportCaseList(db, viewer, "oversight_cases", {}, t, "si"))!;
    expect(file.rows).toBe(await db.case.count({ where: caseWhere(viewer, {})! }));
    const audit = await db.auditLog.findFirstOrThrow({
      where: { actorId: viewer.userId, action: "cases_exported" },
      orderBy: { id: "desc" },
    });
    expect(audit).toMatchObject({ entityType: "case_list", entityId: "oversight_cases" });
    expect(audit.after).toEqual({ filters: { districtScope: home.districtId }, rows: file.rows });
  });
});

describe("an account that only views changes nothing (PRM-5, AC-42)", () => {
  const viewers = () => [
    as("DS_ACCOUNTANT", { dsOfficeId: home.id }),
    as("DISTRICT_CRPO", { districtId: home.districtId }),
    as("PROVINCE_COMMISSIONER", { provinceId: home.provinceId }),
    as("DEPARTMENT_COMMISSIONER", {}),
    as("MINISTRY_SECRETARY", {}),
  ];

  it("is refused by every command that changes a case, and the case stays as it was", async () => {
    const caseId = caseIn.get(home.id)!;
    const before = await db.case.findUniqueOrThrow({ where: { id: caseId } });
    for (const viewer of viewers()) {
      const label = viewer.designation;
      const target = { caseId, version: before.version };
      const newCase = await saveCase(db, viewer, {
        id: randomUUID(),
        version: null,
        dsOfficeId: home.id,
        values: values("199011112222"),
        documentIds: [],
        submit: false,
      });
      expect(newCase.ok, `${label}, new case`).toBe(false);
      const edit = await saveCase(db, viewer, {
        id: caseId,
        version: before.version,
        dsOfficeId: home.id,
        values: { ...values("199011112222"), name: "වෙනස් කළ" },
        documentIds: [],
        submit: false,
      });
      expect(edit.ok, `${label}, edit`).toBe(false);
      expect((await deleteDraft(db, viewer, caseId)).ok, `${label}, delete`).toBe(false);
      const decided = await decideCase(db, viewer, { ...target, decision: "verify", reason: null });
      expect(decided.ok, `${label}, verify`).toBe(false);
      expect((await stopCase(db, viewer, { ...target, reason: "පරීක්ෂණ හේතුව" })).ok, `${label}, stop`).toBe(false);
      const started = await startInstallment(db, viewer, { ...target, number: 1, form: {} as never });
      expect(started.ok, `${label}, installment`).toBe(false);
      const stage = await recordStageUpdate(db, viewer, { ...target, form: {} as never, photoIds: [] });
      expect(stage.ok, `${label}, stage`).toBe(false);
      const letter = await recordLetter(db, viewer, {
        districtId: home.districtId,
        cases: [target].map((c) => ({ id: c.caseId, version: c.version })),
        form: { letterNumber: "පරීක්ෂණ/1", letterDate: "2026-11-01", validUntil: "2026-12-31", note: "" },
        scanId: null,
      });
      expect(letter.ok, `${label}, letter`).toBe(false);
      expect((await uploadDocument(db, viewer, { name: "a.pdf", bytes: PDF })).ok, `${label}, document`).toBe(false);
      expect((await uploadPhoto(db, viewer, { name: "a.jpg", bytes: PDF })).ok, `${label}, photo`).toBe(false);
    }
    const after = await db.case.findUniqueOrThrow({ where: { id: caseId } });
    expect(after).toEqual(before);
    expect(await db.storedFile.count({ where: { uploadedById: { in: viewers().map((v) => v.userId) } } })).toBe(0);
  });

  it("leaves a Ministry Chief Accountant acting as Head Office does", async () => {
    const chief = { ...as("MINISTRY_CHIEF_ACCOUNTANT", {}), userId: headOffice.userId };
    const caseId = caseIn.get(sameDistrict.id)!;
    const found = await db.case.findUniqueOrThrow({ where: { id: caseId } });
    const decided = await decideCase(db, chief, { caseId, version: found.version, decision: "verify", reason: null });
    expect(decided).toEqual({ ok: true, value: "VERIFIED" });
  });
});
