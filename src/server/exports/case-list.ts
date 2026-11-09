import ExcelJS from "exceljs";
import type { getTranslations } from "next-intl/server";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus, Category, InstallmentStatus, Kind } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/locales";
import { colomboDay, dateToDay, formatDate } from "@/lib/dates";
import { localName, NAMES } from "@/lib/names";
import { KINDS } from "@/lib/validation/case";
import { writeAudit } from "../audit";
import { type CaseFilter, caseWhere } from "../cases/queries";
import { caseScope, type Viewer } from "../permissions";
import { addSheet, type CellValue, type Column, workbookBytes } from "./workbook";

export type CasesT = Awaited<ReturnType<typeof getTranslations<"cases">>>;

/** The search of a list, without its page: the export holds every page. */
export type ListFilter = Omit<CaseFilter, "page">;

/** Which list was exported, as the audit record names it (EXP-3). */
export type ListName = "ho_cases" | "ds_cases";

export type ExportRow = {
  caseNumber: string | null;
  category: Category | null;
  kind: Kind | null;
  status: CaseStatus;
  name: string | null;
  childName: string | null;
  nic: string | null;
  address: string | null;
  gnDivision: string | null;
  mobile1: string | null;
  mobile2: string | null;
  districtName: string;
  officeName: string;
  submittedAt: Date | null;
  verifiedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  remark: string | null;
  /** The Rs. 2,000,000 release (REL-2), once recorded; null before it. */
  release: { releasedOn: string; amount: number; paidOut: number } | null;
  /** Installments 1 to 4, made with the release (INS-1); null before it. */
  installments: (ExportInstallment | null)[];
  /** For each of the four building-progress columns, the day ("YYYY-MM-DD") its stage was reached, or null. */
  progress: (string | null)[];
};

export type ExportInstallment = {
  status: InstallmentStatus;
  /** "YYYY-MM-DD" */
  expectedOn: string | null;
  /** "YYYY-MM-DD" */
  releasedOn: string | null;
};

/** The Head Office progress report has four installment columns and four building-progress columns. */
const INSTALLMENTS = [1, 2, 3, 4] as const;
const PROGRESS_COLUMNS = 4;

/**
 * The stages under the four building-progress columns, from a kind's active stages in order (LST-4).
 * The last column, the finished house, is always the last stage, which completes the case (CLS-1).
 * The columns before it take the first stages, as many as fit, so the four new-house stages fill one
 * column each. A kind with no stages leaves all four empty.
 */
export function progressStages<T>(stages: T[]): (T | null)[] {
  if (stages.length === 0) return Array<null>(PROGRESS_COLUMNS).fill(null);
  const before = stages.slice(0, -1).slice(0, PROGRESS_COLUMNS - 1);
  return [...before, ...Array<null>(PROGRESS_COLUMNS - 1 - before.length).fill(null), stages[stages.length - 1]];
}

/**
 * Every case on the list the viewer sees, in the screen's order (EXP-1, FND-1, HOME-2), or null
 * when they may see no cases (PRM-2).
 */
export async function caseListRows(
  db: PrismaClient,
  viewer: Viewer,
  filter: ListFilter,
  locale: Locale,
): Promise<ExportRow[] | null> {
  const where = caseWhere(viewer, filter);
  if (!where) return null;

  const [found, stages] = await Promise.all([
    db.case.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        caseNumber: true,
        category: true,
        kind: true,
        status: true,
        name: true,
        childName: true,
        nic: true,
        address: true,
        gnDivision: true,
        mobile1: true,
        mobile2: true,
        remark: true,
        submittedAt: true,
        verifiedAt: true,
        completedAt: true,
        updatedAt: true,
        dsOffice: { select: { ...NAMES, district: { select: NAMES } } },
        release: { select: { releasedOn: true, amount: true } },
        installments: { select: { number: true, amount: true, status: true, expectedOn: true, releasedOn: true } },
        stageUpdates: { where: { stageId: { not: null } }, select: { stageId: true, visitedOn: true } },
      },
    }),
    db.stageDefinition.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, kind: true },
    }),
  ]);

  const byKind = new Map(KINDS.map((kind) => [kind, progressStages(stages.filter((stage) => stage.kind === kind))]));
  const noStages = progressStages<(typeof stages)[number]>([]);

  return found.map(({ dsOffice, release, installments, stageUpdates, ...row }) => {
    const paid = installments.filter((item) => item.status === "RELEASED");
    const byNumber = new Map(installments.map((item) => [item.number, item]));
    const reached = new Map(stageUpdates.map((update) => [update.stageId, dateToDay(update.visitedOn)]));
    return {
      ...row,
      officeName: localName(dsOffice, locale),
      districtName: localName(dsOffice.district, locale),
      release: release && {
        releasedOn: dateToDay(release.releasedOn),
        amount: release.amount,
        paidOut: paid.reduce((sum, i) => sum + i.amount, 0),
      },
      installments: INSTALLMENTS.map((number) => {
        const item = byNumber.get(number);
        return item
          ? {
              status: item.status,
              expectedOn: item.expectedOn && dateToDay(item.expectedOn),
              releasedOn: item.releasedOn && dateToDay(item.releasedOn),
            }
          : null;
      }),
      progress: (row.kind ? byKind.get(row.kind)! : noStages).map((stage) => (stage && reached.get(stage.id)) ?? null),
    };
  });
}

/** A moment shown as its calendar day in Colombo (ARC-6). */
const day = (date: Date | null): CellValue => (date ? { day: colomboDay(date) } : null);

/**
 * An installment's short note, dated, as the old sheet's cells read: the day it was paid, or the day
 * it is expected. One not started yet stays empty.
 */
function installmentNote(t: CasesT, item: ExportInstallment | null): string | null {
  if (item?.status === "RELEASED" && item.releasedOn)
    return t("export.progress.paid", { date: formatDate(item.releasedOn) });
  if (item?.status === "PROCESSING" && item.expectedOn)
    return t("export.progress.expected", { date: formatDate(item.expectedOn) });
  return null;
}

/**
 * EXP-1's columns, with headers in the language of the screen it was asked from (UI-9). A case not yet released leaves its money columns empty.
 * Head Office's progress report adds two groups, each cell a short dated note: its financial progress,
 * when each installment was paid or is expected, follows the amount released; its physical progress,
 * when each building stage was finished, follows the balance.
 */
export function caseListColumns(t: CasesT): Column<ExportRow>[] {
  return [
    { header: t("export.columns.number"), width: 16, value: (r) => r.caseNumber },
    { header: t("export.columns.category"), width: 16, value: (r) => r.category && t(`category.${r.category}`) },
    { header: t("export.columns.kind"), width: 14, value: (r) => r.kind && t(`kindShort.${r.kind}`) },
    { header: t("export.columns.status"), width: 18, value: (r) => t(`status.${r.status}`) },
    { header: t("export.columns.name"), width: 30, value: (r) => r.name },
    { header: t("export.columns.childName"), width: 26, value: (r) => r.childName },
    { header: t("export.columns.nic"), width: 16, value: (r) => r.nic },
    { header: t("export.columns.address"), width: 40, value: (r) => r.address },
    { header: t("export.columns.mobile1"), width: 14, value: (r) => r.mobile1 },
    { header: t("export.columns.mobile2"), width: 14, value: (r) => r.mobile2 },
    { header: t("export.columns.district"), width: 16, value: (r) => r.districtName },
    { header: t("export.columns.office"), width: 22, value: (r) => r.officeName },
    { header: t("export.columns.gnDivision"), width: 22, value: (r) => r.gnDivision },
    { header: t("export.columns.submittedOn"), width: 14, value: (r) => day(r.submittedAt) },
    { header: t("export.columns.verifiedOn"), width: 14, value: (r) => day(r.verifiedAt) },
    { header: t("export.columns.releasedOn"), width: 14, value: (r) => r.release && { day: r.release.releasedOn } },
    { header: t("export.columns.released"), width: 16, amount: true, value: (r) => r.release?.amount ?? null },
    ...INSTALLMENTS.map((number): Column<ExportRow> => ({
      header: t(`installment.name.${number}`),
      group: t("export.progress.money"),
      width: 20,
      wrap: true,
      value: (r) => installmentNote(t, r.installments[number - 1]),
    })),
    { header: t("export.columns.paidOut"), width: 16, amount: true, value: (r) => r.release?.paidOut ?? null },
    {
      header: t("export.columns.balance"),
      width: 16,
      amount: true,
      value: (r) => (r.release ? r.release.amount - r.release.paidOut : null),
    },
    ...([1, 2, 3, 4] as const).map((number): Column<ExportRow> => ({
      header: t(`export.progress.stages.${number}`),
      group: t("export.progress.building"),
      width: 20,
      wrap: true,
      value: (r) => {
        const day = r.progress[number - 1];
        return day && t("export.progress.finished", { date: formatDate(day) });
      },
    })),
    { header: t("export.columns.completedOn"), width: 14, value: (r) => day(r.completedAt) },
    { header: t("export.columns.updatedOn"), width: 14, value: (r) => day(r.updatedAt) },
    { header: t("export.columns.remark"), width: 40, value: (r) => r.remark },
  ];
}

/** The filters as the audit record keeps them: only those used, plus the area the viewer's list covers. */
function usedFilters(viewer: Viewer, filter: ListFilter): Prisma.InputJsonObject {
  const used: Record<string, Prisma.InputJsonValue> = {};
  const q = filter.q?.trim();
  if (q) used.q = q;
  if (filter.statuses) used.statuses = filter.statuses;
  if (filter.category) used.category = filter.category;
  if (filter.kind) used.kind = filter.kind;
  if (filter.districtId) used.districtId = filter.districtId;
  if (filter.dsOfficeId) used.dsOfficeId = filter.dsOfficeId;
  const scope = caseScope(viewer);
  if (scope.kind === "office") used.officeScope = scope.dsOfficeId;
  if (scope.kind === "district") used.districtScope = scope.districtId;
  if (scope.kind === "province") used.provinceScope = scope.provinceId;
  return used;
}

export type ExportedFile = { bytes: Uint8Array<ArrayBuffer>; fileName: string; asciiName: string; rows: number };

/**
 * EXP-1 and EXP-3: the list as an `.xlsx` file of every matching case, and an audit record of who
 * made it, with which filters and how many rows. Null when the viewer may see no cases (PRM-2).
 * `t` and `locale` are the screen's language: headers, statuses and place names come in it (UI-9).
 */
export async function exportCaseList(
  db: PrismaClient,
  viewer: Viewer & { userId: string },
  list: ListName,
  filter: ListFilter,
  t: CasesT,
  locale: Locale,
  now = new Date(),
): Promise<ExportedFile | null> {
  const rows = await caseListRows(db, viewer, filter, locale);
  if (!rows) return null;

  const workbook = new ExcelJS.Workbook();
  workbook.created = now;
  addSheet(workbook, t("export.sheet"), caseListColumns(t), rows);
  const bytes = await workbookBytes(workbook);

  await writeAudit(db, {
    actorId: viewer.userId,
    action: "cases_exported",
    entityType: "case_list",
    entityId: list,
    after: { filters: usedFilters(viewer, filter), rows: rows.length },
  });

  const today = colomboDay(now);
  return {
    bytes,
    fileName: t("export.fileName", { date: today }),
    asciiName: `diviyata-saviyak-${today}.xlsx`,
    rows: rows.length,
  };
}
