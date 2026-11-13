import ExcelJS from "exceljs";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import messages from "../../../messages/si.json";
import { seed } from "../../../prisma/seed-data";
import { addLoadData, LOAD_ID_PREFIX, removeLoadData } from "../../../scripts/seed-load";
import { createTestClient } from "../../../tests/db/client";
import { dateToDay } from "@/lib/dates";
import { NAMES } from "@/lib/names";
import { CATEGORIES, KINDS } from "@/lib/validation/case";
import { countCases, listCases, PAGE_SIZE } from "../cases/queries";
import type { Viewer } from "../permissions";
import { caseListRows, exportCaseList, type ListFilter, progressStages } from "./case-list";

const db = createTestClient();
const t = createTranslator({ locale: "si", messages, namespace: "cases" });
const LOAD = 5_000;

/** The audit log has no foreign key to the account, so a made-up actor is enough. */
const ho = {
  role: "MINISTRY_OFFICER",
  designation: "MINISTRY_PROGRAMME_OFFICER",
  districtId: null,
  provinceId: null,
  dsOfficeId: null,
  userId: "export-test-ho",
} as const satisfies Viewer & {
  userId: string;
};

let busiestOffice: number;
let district: number;

beforeAll(async () => {
  await seed(db);
  await addLoadData(db, { count: LOAD, seed: 11 });
  // The office with the most load-test cases and no other case, with at least one case waiting at the
  // district (REL-6), so the rows hold every stage of the money. Other test files share the schema and set
  // statuses directly, or give two offices the same Application Number (CASE-12), which the checks below
  // don't expect.
  const others = await db.case.findMany({
    where: { NOT: { id: { startsWith: LOAD_ID_PREFIX } } },
    select: { dsOfficeId: true, buildDsOfficeId: true },
  });
  const taken = new Set(others.flatMap((c) => [c.dsOfficeId, c.buildDsOfficeId]));
  const counts = await db.case.groupBy({
    by: ["dsOfficeId"],
    where: { id: { startsWith: LOAD_ID_PREFIX } },
    _count: { _all: true },
    orderBy: { _count: { dsOfficeId: "desc" } },
  });
  const atTheDistrict = new Set(
    (
      await db.case.findMany({
        where: { id: { startsWith: LOAD_ID_PREFIX }, status: "ALLOCATED_TO_DISTRICT" },
        select: { buildDsOfficeId: true },
      })
    ).map((c) => c.buildDsOfficeId),
  );
  busiestOffice = counts.find(
    (group) => !taken.has(group.dsOfficeId) && atTheDistrict.has(group.dsOfficeId),
  )!.dsOfficeId;
  district = (await db.dsOffice.findUniqueOrThrow({ where: { id: busiestOffice }, select: { districtId: true } }))
    .districtId;
}, 300_000);

afterAll(async () => {
  await removeLoadData(db);
  await db.$disconnect();
}, 300_000);

async function lastExportAudit(actorId: string) {
  return db.auditLog.findFirst({ where: { actorId, action: "cases_exported" }, orderBy: { id: "desc" } });
}

// Each test reads lists of up to 5,000 cases: a check of the rows, not of speed (that is PRF-4). On a CI
// runner that takes longer than vitest's default 5 seconds, and a test that times out keeps running
// underneath the next one, which then fails too.
describe("Excel export of a case list (EXP-1, EXP-3)", { timeout: 30_000 }, () => {
  it("holds every case of the list, every page, in the screen's order, for each filter", async () => {
    const filters: ListFilter[] = [
      {},
      { statuses: ["IN_PROGRESS"] },
      { districtId: district, category: CATEGORIES[0] },
      { dsOfficeId: busiestOffice, kind: KINDS[0] },
      { q: "HMG" },
    ];
    for (const filter of filters) {
      const rows = await caseListRows(db, ho, filter, "si");
      expect(rows?.length, JSON.stringify(filter)).toBe(await countCases(db, ho, filter));
      const first = await listCases(db, ho, { ...filter, page: 1 }, "si");
      expect(rows!.slice(0, PAGE_SIZE).map((r) => r.applicationNumber)).toEqual(
        first.rows.map((r) => r.applicationNumber),
      );
    }
  });

  it("gives each case its allocation, the Ministry's letter, the District's release and its money from the database", async () => {
    const rows = (await caseListRows(db, ho, { dsOfficeId: busiestOffice }, "si"))!;
    const cases = await db.case.findMany({
      // FND-1, CASE-13: the list's DS office filter matches either office of a case.
      where: { OR: [{ dsOfficeId: busiestOffice }, { buildDsOfficeId: busiestOffice }] },
      select: {
        applicationNumber: true,
        release: {
          select: {
            amount: true,
            letter: { select: { letterNumber: true, letterDate: true } },
            dsRelease: { select: { referenceNumber: true, releasedOn: true } },
          },
        },
        installments: { where: { status: "RELEASED" }, select: { amount: true } },
      },
    });
    const byNumber = new Map(cases.map((c) => [c.applicationNumber, c]));
    for (const row of rows) {
      const { release, installments } = byNumber.get(row.applicationNumber)!;
      expect(row.release, row.applicationNumber).toEqual(
        release && {
          amount: release.amount,
          letterNumber: release.letter.letterNumber,
          letterDate: dateToDay(release.letter.letterDate),
          dsRelease: release.dsRelease && {
            referenceNumber: release.dsRelease.referenceNumber,
            releasedOn: dateToDay(release.dsRelease.releasedOn),
            paidOut: installments.reduce((sum, i) => sum + i.amount, 0),
          },
        },
      );
    }
    // Every stage of the money is in the rows: none, allocated only, released to the DS, and paid.
    expect(rows.some((r) => !r.release)).toBe(true);
    expect(rows.some((r) => r.release && !r.release.dsRelease)).toBe(true);
    expect(rows.some((r) => r.release?.dsRelease && r.release.dsRelease.paidOut > 0)).toBe(true);
    for (const row of rows) {
      if (!row.release) expect(row.status, row.applicationNumber).toBe("AWAITING_ALLOCATION");
      else if (!row.release.dsRelease) expect(row.status, row.applicationNumber).toBe("ALLOCATED_TO_DISTRICT");
    }
  });

  it("gives each case its installments and the days its new-house stages were reached", async () => {
    const rows = (await caseListRows(db, ho, { dsOfficeId: busiestOffice, kind: "NEW_HOUSE" }, "si"))!;
    const stages = await db.stageDefinition.findMany({
      where: { kind: "NEW_HOUSE", active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const cases = await db.case.findMany({
      where: { OR: [{ dsOfficeId: busiestOffice }, { buildDsOfficeId: busiestOffice }], kind: "NEW_HOUSE" },
      select: {
        applicationNumber: true,
        installments: { select: { number: true, amount: true, status: true, expectedOn: true, releasedOn: true } },
        stageUpdates: { where: { stageId: { not: null } }, select: { stageId: true, visitedOn: true } },
      },
    });
    const byNumber = new Map(cases.map((c) => [c.applicationNumber, c]));
    for (const row of rows) {
      const found = byNumber.get(row.applicationNumber)!;
      const installments = [1, 2, 3, 4].map((n) => {
        const item = found.installments.find((i) => i.number === n);
        return item
          ? {
              status: item.status,
              amount: item.amount,
              expectedOn: item.expectedOn && dateToDay(item.expectedOn),
              releasedOn: item.releasedOn && dateToDay(item.releasedOn),
            }
          : null;
      });
      expect(row.installments, row.applicationNumber).toEqual(installments);
      // Other test files may have added stages to the shared schema, so the columns' stages are worked out.
      const reached = progressStages(stages).map((stage) => {
        const update = stage && found.stageUpdates.find((u) => u.stageId === stage.id);
        return update ? dateToDay(update.visitedOn) : null;
      });
      expect(row.progress, row.applicationNumber).toEqual(reached);
    }
    expect(rows.some((r) => r.installments[0]?.status === "RELEASED")).toBe(true);
    expect(rows.some((r) => r.installments.some((i) => i?.status === "PROCESSING"))).toBe(true);
    expect(rows.some((r) => r.progress[0] !== null)).toBe(true);
  });

  it("reads the registration form's details and centres, and leaves them empty on an older case (change 0007)", async () => {
    const found = await db.case.findFirstOrThrow({
      where: { dsOfficeId: busiestOffice, category: "CARE_LEAVER", id: { startsWith: LOAD_ID_PREFIX } },
      select: { id: true, applicationNumber: true },
    });
    const [western, central] = await db.province.findMany({
      orderBy: { id: "asc" },
      take: 2,
      select: { id: true, ...NAMES },
    });
    // The search also finds longer numbers that start with this one.
    const row = async (locale: "si" | "en") =>
      (await caseListRows(db, ho, { q: found.applicationNumber, dsOfficeId: busiestOffice }, locale))!.find(
        (r) => r.applicationNumber === found.applicationNumber,
      )!;

    // The load-test data has none of the new details yet: such a case reads as entered before the change.
    expect(await row("si")).toMatchObject({
      dateOfBirth: null,
      careGroup: null,
      maritalStatus: null,
      centres: [],
      familyMembers: null,
      disabledChildren: null,
      aid: [],
      landGnDivision: null,
    });

    await db.case.update({
      where: { id: found.id },
      data: {
        dateOfBirth: new Date("2004-08-09T00:00:00Z"),
        careGroup: "IN_CARE",
        maritalStatus: "MARRIED",
        familyMembers: 3,
        disabledChildren: true,
        aid: ["ASWESUMA", "OTHER"],
        aidOther: "පරීක්ෂණ ආධාරය",
        landGnDivision: "පරීක්ෂණ වසම",
        centres: {
          create: [
            { position: 2, name: "දෙවන පරීක්ෂණ නිවාසය", provinceId: central.id, fromYear: 2016 },
            {
              position: 1,
              name: "පරීක්ෂණ ළමා නිවාසය",
              provinceId: western.id,
              fromYear: 2010,
              fromMonth: 3,
              untilYear: 2016,
              untilMonth: 1,
              untilDay: 31,
            },
          ],
        },
      },
    });
    try {
      const read = await row("en");
      expect(read).toMatchObject({
        dateOfBirth: "2004-08-09",
        careGroup: "IN_CARE",
        maritalStatus: "MARRIED",
        familyMembers: 3,
        disabledChildren: true,
        aid: ["ASWESUMA", "OTHER"],
        aidOther: "පරීක්ෂණ ආධාරය",
        landGnDivision: "පරීක්ෂණ වසම",
      });
      // In the form's order, each date as precise as it was entered, each province in the file's language.
      expect(read.centres).toEqual([
        {
          name: "පරීක්ෂණ ළමා නිවාසය",
          provinceId: western.id,
          provinceName: western.nameEn,
          from: { year: 2010, month: 3, day: null },
          until: { year: 2016, month: 1, day: 31 },
        },
        {
          name: "දෙවන පරීක්ෂණ නිවාසය",
          provinceId: central.id,
          provinceName: central.nameEn,
          from: { year: 2016, month: null, day: null },
          until: null,
        },
      ]);
    } finally {
      await db.careCentre.deleteMany({ where: { caseId: found.id } });
      await db.case.update({
        where: { id: found.id },
        data: {
          dateOfBirth: null,
          careGroup: null,
          maritalStatus: null,
          familyMembers: null,
          disabledChildren: null,
          aid: [],
          aidOther: null,
          landGnDivision: null,
        },
      });
    }
  });

  it("gives a land case its installments' own amounts, and LAND_AND_BUILD the new-house stages (INS-7, STG-4)", async () => {
    const found = await db.case.findFirstOrThrow({
      where: {
        buildDsOfficeId: busiestOffice,
        kind: "NEW_HOUSE",
        id: { startsWith: LOAD_ID_PREFIX },
        installments: { some: { number: 1, status: "RELEASED" } },
        stageUpdates: { some: { stageId: { not: null } } },
      },
      select: { id: true, applicationNumber: true },
    });
    const row = async () =>
      (await caseListRows(db, ho, { q: found.applicationNumber, dsOfficeId: busiestOffice }, "si"))!.find(
        (r) => r.applicationNumber === found.applicationNumber,
      )!;
    const house = await row();
    expect(house.progress.some((day) => day !== null)).toBe(true);

    await db.$transaction([
      db.case.update({ where: { id: found.id }, data: { kind: "LAND_AND_BUILD" } }),
      db.installment.updateMany({ where: { caseId: found.id, number: 1 }, data: { amount: 900_000 } }),
    ]);
    try {
      const land = await row();
      expect(land.installments[0]).toMatchObject({ status: "RELEASED", amount: 900_000 });
      expect(land.progress).toEqual(house.progress);

      await db.case.update({ where: { id: found.id }, data: { kind: "LAND_ONLY" } });
      const landOnly = await row();
      expect(landOnly.progress).toEqual([null, null, null, null]);
    } finally {
      await db.$transaction([
        db.case.update({ where: { id: found.id }, data: { kind: "NEW_HOUSE" } }),
        db.installment.updateMany({ where: { caseId: found.id, number: 1 }, data: { amount: 500_000 } }),
      ]);
    }
  });

  it("keeps a DS officer to their own office, and gives an admin nothing (PRM-1, PRM-2)", async () => {
    const ds = {
      role: "DS_OFFICER",
      designation: "DS_CRPO",
      districtId: null,
      provinceId: null,
      dsOfficeId: busiestOffice,
      userId: "export-test-ds",
    } as const;
    const rows = (await caseListRows(db, ds, {}, "si"))!;
    const own = await db.dsOffice.findUniqueOrThrow({ where: { id: busiestOffice }, select: { nameSi: true } });
    // PRM-1, CASE-13: the cases it entered and the cases built in it.
    expect(rows.length).toBe(
      await db.case.count({ where: { OR: [{ dsOfficeId: busiestOffice }, { buildDsOfficeId: busiestOffice }] } }),
    );
    for (const row of rows) expect([row.officeName, row.residenceOfficeName]).toContain(own.nameSi);

    // A search can't reach past the office, even with another office's number.
    const other = await db.case.findFirstOrThrow({
      // A load-test case: its number carries its own office's code, so no case of this office shares it.
      where: {
        dsOfficeId: { not: busiestOffice },
        buildDsOfficeId: { not: busiestOffice },
        id: { startsWith: LOAD_ID_PREFIX },
      },
      select: { applicationNumber: true },
    });
    expect(await caseListRows(db, ds, { q: other.applicationNumber }, "si")).toEqual([]);

    const admin = {
      role: "ADMIN",
      designation: null,
      districtId: null,
      provinceId: null,
      dsOfficeId: null,
      userId: "export-test-admin",
    } as const;
    expect(await exportCaseList(db, admin, "ho_cases", {}, t, "si")).toBeNull();
    expect(await lastExportAudit(admin.userId)).toBeNull();
  });

  it("EXP-3: logs who exported which list, with the filters used and the number of rows", async () => {
    const filter: ListFilter = { q: " HMG ", statuses: ["IN_PROGRESS"], districtId: district };
    const file = (await exportCaseList(db, ho, "ho_cases", filter, t, "si"))!;
    const audit = await lastExportAudit(ho.userId);
    expect(audit).toMatchObject({ entityType: "case_list", entityId: "ho_cases", caseId: null });
    expect(audit?.after).toEqual({
      filters: { q: "HMG", statuses: ["IN_PROGRESS"], districtId: district },
      rows: file.rows,
    });

    const ds = {
      role: "DS_OFFICER",
      designation: "DS_CRPO",
      districtId: null,
      provinceId: null,
      dsOfficeId: busiestOffice,
      userId: "export-test-ds",
    } as const;
    const own = (await exportCaseList(db, ds, "ds_cases", { statuses: ["COMPLETED"] }, t, "si"))!;
    expect((await lastExportAudit(ds.userId))?.after).toEqual({
      filters: { statuses: ["COMPLETED"], officeScope: busiestOffice },
      rows: own.rows,
    });
  });

  it("PRF-4: every case goes to Excel in under 60 seconds, and the file opens again with one row per case", async () => {
    const total = await db.case.count();
    expect(total).toBeGreaterThanOrEqual(LOAD);

    const started = performance.now();
    const file = (await exportCaseList(db, ho, "ho_cases", {}, t, "si"))!;
    const seconds = (performance.now() - started) / 1000;
    expect(seconds).toBeLessThan(60);
    expect(file.rows).toBe(total);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.bytes.buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe(t("export.sheet"));
    expect(sheet.getRow(1).getCell(1).value).toBe(t("export.columns.number"));
    expect(sheet.rowCount).toBe(total + 2);
  }, 120_000);
});
