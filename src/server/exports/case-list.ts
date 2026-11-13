import ExcelJS from "exceljs";
import type { getTranslations } from "next-intl/server";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  Aid,
  CareGroup,
  CaseStatus,
  Category,
  InstallmentStatus,
  Kind,
  MaritalStatus,
  Relationship,
} from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/locales";
import { colomboDay, dateToDay, formatDate } from "@/lib/dates";
import { formatRupees } from "@/lib/money";
import { localName, NAMES } from "@/lib/names";
import { isHouseKind, KINDS, stageKind } from "@/lib/validation/case";
import { writeAudit } from "../audit";
import { type CentreLineValues, centreLine } from "../cases/centre-line";
import { CENTRE_SELECT, centreValues } from "../cases/commands";
import { type CaseFilter, caseWhere } from "../cases/queries";
import { caseScope, type Viewer } from "../permissions";
import { addSheet, type CellValue, type Column, workbookBytes } from "./workbook";

export type CasesT = Awaited<ReturnType<typeof getTranslations<"cases">>>;

/** The search of a list, without its page: the export holds every page. */
export type ListFilter = Omit<CaseFilter, "page">;

/** Which list was exported, as the audit record names it (EXP-3). */
export type ListName = "ho_cases" | "ds_cases" | "oversight_cases";

export type ExportRow = {
  applicationNumber: string;
  category: Category;
  kind: Kind;
  status: CaseStatus;
  name: string | null;
  childName: string | null;
  nic: string | null;
  address: string | null;
  gnDivision: string | null;
  mobile1: string | null;
  mobile2: string | null;
  /**
   * The registration form's details (CASE-14 to CASE-16), each null or empty on a case entered before
   * change 0007. The date of birth is "YYYY-MM-DD": the care leaver's, or the child's.
   */
  dateOfBirth: string | null;
  careGroup: CareGroup | null;
  maritalStatus: MaritalStatus | null;
  relationship: Relationship | null;
  relationshipOther: string | null;
  /** A care leaver's child development centres, in the form's order, with their provinces in the file's language. */
  centres: CentreLineValues[];
  familyMembers: number | null;
  disabledChildren: boolean | null;
  aid: Aid[];
  aidOther: string | null;
  /** CASE-17: the GN division where the land (or a renovation's house) is. */
  landGnDivision: string | null;
  /** CASE-13: the district and DS office where it is built, which the money follows (EXP-1). */
  districtName: string;
  officeName: string;
  /** The DS office of residence, which entered it. */
  residenceOfficeName: string;
  /** When the DS entered it (EXP-1). */
  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  remark: string | null;
  /** The Ministry's Rs. 2,000,000 allocation (REL-3), once its letter names the case; null before it. */
  release: ExportAllocation | null;
  /** Installments 1 to 4, made with the District's release (REL-7); null before it. */
  installments: (ExportInstallment | null)[];
  /** For each of the four building-progress columns, the day ("YYYY-MM-DD") its stage was reached, or null. */
  progress: (string | null)[];
};

export type ExportAllocation = {
  amount: number;
  letterNumber: string;
  /** "YYYY-MM-DD" */
  letterDate: string;
  /** The District's release to the DS (REL-7), with what the DS has paid from it; null until then. */
  dsRelease: { referenceNumber: string; /** "YYYY-MM-DD" */ releasedOn: string; paidOut: number } | null;
};

export type ExportInstallment = {
  status: InstallmentStatus;
  /** Rs. 500,000 for a house kind; a land kind's own amount (INS-7). */
  amount: number;
  /** "YYYY-MM-DD" */
  expectedOn: string | null;
  /** "YYYY-MM-DD" */
  releasedOn: string | null;
};

/** The Ministry's progress report has four installment columns and four building-progress columns. */
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
        applicationNumber: true,
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
        dateOfBirth: true,
        careGroup: true,
        maritalStatus: true,
        relationship: true,
        relationshipOther: true,
        familyMembers: true,
        disabledChildren: true,
        aid: true,
        aidOther: true,
        landGnDivision: true,
        centres: { orderBy: { position: "asc" }, select: { ...CENTRE_SELECT, province: { select: NAMES } } },
        remark: true,
        createdAt: true,
        completedAt: true,
        updatedAt: true,
        dsOffice: { select: NAMES },
        buildDsOffice: { select: { ...NAMES, district: { select: NAMES } } },
        release: {
          select: {
            amount: true,
            letter: { select: { letterNumber: true, letterDate: true } },
            dsRelease: { select: { referenceNumber: true, releasedOn: true } },
          },
        },
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

  // LAND_AND_BUILD follows the new-house stages; the other land kinds have none (STG-4).
  const byKind = new Map(
    KINDS.map((kind) => [kind, progressStages(stages.filter((stage) => stage.kind === stageKind(kind)))]),
  );

  return found.map(({ dsOffice, buildDsOffice, release, installments, stageUpdates, centres, ...row }) => {
    const paid = installments.filter((item) => item.status === "RELEASED");
    const byNumber = new Map(installments.map((item) => [item.number, item]));
    const reached = new Map(stageUpdates.map((update) => [update.stageId, dateToDay(update.visitedOn)]));
    return {
      ...row,
      dateOfBirth: row.dateOfBirth && dateToDay(row.dateOfBirth),
      centres: centres.map((centre) => ({ ...centreValues(centre), provinceName: localName(centre.province, locale) })),
      officeName: localName(buildDsOffice, locale),
      districtName: localName(buildDsOffice.district, locale),
      residenceOfficeName: localName(dsOffice, locale),
      release: release && {
        amount: release.amount,
        letterNumber: release.letter.letterNumber,
        letterDate: dateToDay(release.letter.letterDate),
        dsRelease: release.dsRelease && {
          referenceNumber: release.dsRelease.referenceNumber,
          releasedOn: dateToDay(release.dsRelease.releasedOn),
          paidOut: paid.reduce((sum, i) => sum + i.amount, 0),
        },
      },
      installments: INSTALLMENTS.map((number) => {
        const item = byNumber.get(number);
        return item
          ? {
              status: item.status,
              amount: item.amount,
              expectedOn: item.expectedOn && dateToDay(item.expectedOn),
              releasedOn: item.releasedOn && dateToDay(item.releasedOn),
            }
          : null;
      }),
      progress: byKind.get(row.kind)!.map((stage) => (stage && reached.get(stage.id)) ?? null),
    };
  });
}

/** A moment shown as its calendar day in Colombo (ARC-6). */
const day = (date: Date | null): CellValue => (date ? { day: colomboDay(date) } : null);

/**
 * An installment's short note, dated, as the old sheet's cells read: the day it was paid, or the day
 * it is expected. One not started yet stays empty. A land kind's note also gives its amount, which is
 * its own (INS-7), such as "2026.03.12 දින රු. 850,000 ගෙවා ඇත"; a house kind's is always Rs. 500,000.
 */
function installmentNote(t: CasesT, locale: Locale, kind: Kind, item: ExportInstallment | null): string | null {
  const amount = isHouseKind(kind) ? null : item && formatRupees(item.amount, locale);
  if (item?.status === "RELEASED" && item.releasedOn) {
    const date = formatDate(item.releasedOn);
    return amount ? t("export.progress.paidAmount", { date, amount }) : t("export.progress.paid", { date });
  }
  if (item?.status === "PROCESSING" && item.expectedOn) {
    const date = formatDate(item.expectedOn);
    return amount ? t("export.progress.expectedAmount", { date, amount }) : t("export.progress.expected", { date });
  }
  return null;
}

/** A choice with its typed text when it is "other", as the case page shows it. */
const typed = (t: CasesT, label: string, text: string | null) => t("otherTyped", { label, text: text ?? "" });

/**
 * The aids received in the file's language, separated by commas, with the typed one (CASE-16). A case
 * entered on the registration form always has a date of birth, so an empty list there means none was
 * received; a case entered before change 0007 was never asked, and its cell stays empty.
 */
function aidCell(t: CasesT, r: ExportRow): string | null {
  if (r.aid.length > 0)
    return r.aid.map((aid) => (aid === "OTHER" ? typed(t, t("aid.OTHER"), r.aidOther) : t(`aid.${aid}`))).join(", ");
  return r.dateOfBirth ? t("page.noAid") : null;
}

/**
 * EXP-1's columns, with headers in the language of the screen it was asked from (UI-9). The registration
 * form's details follow the phones (change 0007), and are empty on a case entered before it. The places
 * are where it is built, with the land's GN division, then the DS of residence (CASE-13, CASE-17).
 * A case leaves empty what it hasn't reached yet:
 * the Ministry's letter and the amount allocated until its allocation, the District's release, the
 * installments, what was paid and the balance until the District releases it to the DS.
 * The Ministry's progress report adds two groups, each cell a short dated note: its financial progress,
 * when each installment was paid or is expected, follows the amount allocated; its physical progress,
 * when each building stage was finished, follows the balance.
 */
export function caseListColumns(t: CasesT, locale: Locale): Column<ExportRow>[] {
  return [
    { header: t("export.columns.number"), width: 16, value: (r) => r.applicationNumber },
    { header: t("export.columns.category"), width: 16, value: (r) => t(`category.${r.category}`) },
    { header: t("export.columns.kind"), width: 14, value: (r) => t(`kindShort.${r.kind}`) },
    { header: t("export.columns.status"), width: 18, value: (r) => t(`status.${r.status}`) },
    { header: t("export.columns.name"), width: 30, value: (r) => r.name },
    { header: t("export.columns.childName"), width: 26, value: (r) => r.childName },
    { header: t("export.columns.nic"), width: 16, value: (r) => r.nic },
    { header: t("export.columns.address"), width: 40, value: (r) => r.address },
    { header: t("export.columns.mobile1"), width: 14, value: (r) => r.mobile1 },
    { header: t("export.columns.mobile2"), width: 14, value: (r) => r.mobile2 },
    { header: t("export.columns.dateOfBirth"), width: 14, value: (r) => r.dateOfBirth && { day: r.dateOfBirth } },
    {
      header: t("export.columns.careGroup"),
      width: 18,
      value: (r) => r.careGroup && t(`careGroup.${r.careGroup}`),
    },
    {
      header: t("export.columns.maritalStatus"),
      width: 14,
      value: (r) => r.maritalStatus && t(`maritalStatus.${r.maritalStatus}`),
    },
    {
      header: t("export.columns.relationship"),
      width: 18,
      value: (r) =>
        r.relationship === "OTHER"
          ? typed(t, t("relationship.OTHER"), r.relationshipOther)
          : r.relationship && t(`relationship.${r.relationship}`),
    },
    {
      header: t("export.columns.centres"),
      width: 40,
      wrap: true,
      value: (r) => (r.centres.length > 0 ? r.centres.map((centre) => centreLine(t, centre)).join("\n") : null),
    },
    { header: t("export.columns.familyMembers"), width: 12, value: (r) => r.familyMembers },
    {
      header: t("export.columns.disabledChildren"),
      width: 12,
      value: (r) => (r.disabledChildren === null ? null : t(r.disabledChildren ? "yes" : "no")),
    },
    { header: t("export.columns.aid"), width: 30, wrap: true, value: (r) => aidCell(t, r) },
    { header: t("export.columns.district"), width: 16, value: (r) => r.districtName },
    { header: t("export.columns.office"), width: 22, value: (r) => r.officeName },
    { header: t("export.columns.landGnDivision"), width: 22, value: (r) => r.landGnDivision },
    { header: t("export.columns.residenceOffice"), width: 22, value: (r) => r.residenceOfficeName },
    { header: t("export.columns.gnDivision"), width: 22, value: (r) => r.gnDivision },
    { header: t("export.columns.enteredOn"), width: 14, value: (r) => day(r.createdAt) },
    { header: t("export.columns.letterNumber"), width: 18, value: (r) => r.release?.letterNumber ?? null },
    { header: t("export.columns.letterDate"), width: 14, value: (r) => r.release && { day: r.release.letterDate } },
    {
      header: t("export.columns.dsReleaseReference"),
      width: 18,
      value: (r) => r.release?.dsRelease?.referenceNumber ?? null,
    },
    {
      header: t("export.columns.dsReleasedOn"),
      width: 14,
      value: (r) => (r.release?.dsRelease ? { day: r.release.dsRelease.releasedOn } : null),
    },
    { header: t("export.columns.allocated"), width: 16, amount: true, value: (r) => r.release?.amount ?? null },
    ...INSTALLMENTS.map((number): Column<ExportRow> => ({
      header: t(`installment.name.${number}`),
      group: t("export.progress.money"),
      width: 20,
      wrap: true,
      value: (r) => installmentNote(t, locale, r.kind, r.installments[number - 1]),
    })),
    {
      header: t("export.columns.paidOut"),
      width: 16,
      amount: true,
      value: (r) => r.release?.dsRelease?.paidOut ?? null,
    },
    {
      header: t("export.columns.balance"),
      width: 16,
      amount: true,
      value: (r) => (r.release?.dsRelease ? r.release.amount - r.release.dsRelease.paidOut : null),
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
  addSheet(workbook, t("export.sheet"), caseListColumns(t, locale), rows);
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
