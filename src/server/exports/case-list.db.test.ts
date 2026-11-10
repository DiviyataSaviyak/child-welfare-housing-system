import ExcelJS from "exceljs";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import messages from "../../../messages/si.json";
import { seed } from "../../../prisma/seed-data";
import { addLoadData, removeLoadData } from "../../../scripts/seed-load";
import { createTestClient } from "../../../tests/db/client";
import { dateToDay } from "@/lib/dates";
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
  const [top] = await db.case.groupBy({
    by: ["dsOfficeId"],
    _count: { _all: true },
    orderBy: { _count: { dsOfficeId: "desc" } },
    take: 1,
  });
  busiestOffice = top.dsOfficeId;
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

  it("gives each released case its money from the database", async () => {
    const rows = (await caseListRows(db, ho, { dsOfficeId: busiestOffice }, "si"))!;
    const cases = await db.case.findMany({
      where: { dsOfficeId: busiestOffice },
      select: {
        applicationNumber: true,
        release: { select: { amount: true } },
        installments: { where: { status: "RELEASED" }, select: { amount: true } },
      },
    });
    const byNumber = new Map(cases.filter((c) => c.applicationNumber).map((c) => [c.applicationNumber, c]));
    const released = rows.filter((r) => r.release);
    expect(released.length).toBeGreaterThan(0);
    for (const row of released) {
      const found = byNumber.get(row.applicationNumber)!;
      expect(row.release!.amount).toBe(found.release!.amount);
      expect(row.release!.paidOut).toBe(found.installments.reduce((sum, i) => sum + i.amount, 0));
    }
    expect(rows.filter((r) => !r.release).every((r) => r.status !== "IN_PROGRESS" && r.status !== "COMPLETED")).toBe(
      true,
    );
  });

  it("gives each case its installments and the days its new-house stages were reached", async () => {
    const rows = (await caseListRows(db, ho, { dsOfficeId: busiestOffice, kind: "NEW_HOUSE" }, "si"))!;
    const stages = await db.stageDefinition.findMany({
      where: { kind: "NEW_HOUSE", active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const cases = await db.case.findMany({
      where: { dsOfficeId: busiestOffice, kind: "NEW_HOUSE", applicationNumber: { not: null } },
      select: {
        applicationNumber: true,
        installments: { select: { number: true, status: true, expectedOn: true, releasedOn: true } },
        stageUpdates: { where: { stageId: { not: null } }, select: { stageId: true, visitedOn: true } },
      },
    });
    const byNumber = new Map(cases.map((c) => [c.applicationNumber, c]));
    for (const row of rows.filter((r) => r.applicationNumber)) {
      const found = byNumber.get(row.applicationNumber)!;
      const installments = [1, 2, 3, 4].map((n) => {
        const item = found.installments.find((i) => i.number === n);
        return item
          ? {
              status: item.status,
              expectedOn: item.expectedOn && dateToDay(item.expectedOn),
              releasedOn: item.releasedOn && dateToDay(item.releasedOn),
            }
          : null;
      });
      expect(row.installments, row.applicationNumber!).toEqual(installments);
      // Other test files may have added stages to the shared schema, so the columns' stages are worked out.
      const reached = progressStages(stages).map((stage) => {
        const update = stage && found.stageUpdates.find((u) => u.stageId === stage.id);
        return update ? dateToDay(update.visitedOn) : null;
      });
      expect(row.progress, row.applicationNumber!).toEqual(reached);
    }
    expect(rows.some((r) => r.installments[0]?.status === "RELEASED")).toBe(true);
    expect(rows.some((r) => r.installments.some((i) => i?.status === "PROCESSING"))).toBe(true);
    expect(rows.some((r) => r.progress[0] !== null)).toBe(true);
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
    expect(rows.length).toBe(await db.case.count({ where: { dsOfficeId: busiestOffice } }));
    expect(new Set(rows.map((r) => r.officeName))).toEqual(new Set([own.nameSi]));

    // A search can't reach past the office, even with another office's number.
    const other = await db.case.findFirstOrThrow({
      where: { dsOfficeId: { not: busiestOffice }, applicationNumber: { not: null } },
      select: { applicationNumber: true },
    });
    expect(await caseListRows(db, ds, { q: other.applicationNumber! }, "si")).toEqual([]);

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
