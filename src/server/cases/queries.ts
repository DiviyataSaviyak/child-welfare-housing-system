import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus, Category, InstallmentStatus, Kind } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/locales";
import { addDays, colomboDay, colomboStartOf, dateToDay, dayToDate, daysBetween } from "@/lib/dates";
import { localName, NAMES } from "@/lib/names";
import { nicKey, normaliseNic } from "@/lib/nic";
import { latestDay } from "@/lib/validation/release";
import {
  actingOffice,
  CASE_PLACES,
  canActOn,
  canSeeCase,
  OFFICE_PLACE,
  officeFilter,
  type Viewer,
} from "../permissions";
import { accountLabel, LABEL_SELECT } from "../users/label";
import { applicationKey } from "./numbers";
import { REQUEST_SELECT, type ReplacementRequest, toRequest } from "./replacements";

export type CaseDetails = {
  id: string;
  applicationNumber: string | null;
  status: CaseStatus;
  category: Category | null;
  kind: Kind | null;
  name: string | null;
  childName: string | null;
  nic: string | null;
  address: string | null;
  gnDivision: string | null;
  mobile1: string | null;
  mobile2: string | null;
  remark: string | null;
  dsOfficeId: number;
  officeName: string;
  officeActive: boolean;
  districtId: number;
  districtName: string;
  /** CASE-13: the DS office where the house is built or the land bought; the DS of residence by default. */
  buildDsOfficeId: number;
  buildOfficeName: string;
  buildDistrictId: number;
  buildDistrictName: string;
  version: number;
  /** When the DS entered it: the allocation screen orders by it (REL-1). */
  createdAt: Date;
  submittedAt: Date | null;
  verifiedAt: Date | null;
  /** When the system found it finished (CLS-1). */
  completedAt: Date | null;
  updatedAt: Date;
  /** Head Office's reason, while the case is sent back (CASE-7). */
  returnReason: string | null;
  /** Head Office's reason for rejecting it (CHK-3). */
  rejectReason: string | null;
  /** While the case is stopped: when, why, and the status it goes back to when reopened (CLS-2, CLS-3). */
  stop: { at: Date; reason: string | null; statusBefore: CaseStatus | null } | null;
  /** Head Office asked for another name in this case's place when it rejected or stopped it (CASE-11). */
  anotherNameRequested: boolean;
  /** The case this one was entered in place of, with Head Office's decision on it (CASE-11). */
  replaces: ReplacementRequest | null;
  /** The case entered in this one's place (CASE-11). */
  replacedBy: CaseLink | null;
  documents: { id: string; name: string }[];
  /** The Rs. 2,000,000 release, once recorded (REL-2). */
  release: ReleaseDetails | null;
  /** The four installments, made with the release (INS-1), in order. */
  installments: InstallmentDetails[];
  /**
   * Which of the case's actions the viewer's office has (CASE-13): `edit` for the DS of residence,
   * `progress` (installments and stages) for the DS where it is built. Both are true for the Ministry.
   * The role and the status still decide the rest (rules.ts, transitions.ts).
   */
  actsOn: { edit: boolean; progress: boolean };
};

/** Another case named on this one's page, with a link to it. */
export type CaseLink = {
  id: string;
  applicationNumber: string | null;
  name: string | null;
  childName: string | null;
  status: CaseStatus;
};

export type ReleaseDetails = {
  /** "YYYY-MM-DD": the letter's date. */
  releasedOn: string;
  amount: number;
  byName: string;
  at: Date;
  /** The allocation letter to the District Secretary that released it (REL-2). */
  letter: {
    id: string;
    letterNumber: string;
    /** "YYYY-MM-DD" */
    letterDate: string;
    /** "YYYY-MM-DD" */
    validUntil: string;
    note: string | null;
    districtName: string;
    /** How many cases the letter released. */
    cases: number;
    /** "YYYY-MM-DD": the latest verification of its cases, the earliest the letter can be dated (REL-4). */
    latestVerification: string | null;
    /** The scanned letter, if one was added. */
    scanId: string | null;
  };
};

export type InstallmentDetails = {
  number: number;
  amount: number;
  status: InstallmentStatus;
  purpose: string | null;
  /** "YYYY-MM-DD" */
  expectedOn: string | null;
  /** "YYYY-MM-DD" */
  releasedOn: string | null;
  note: string | null;
};

/**
 * One case, if the viewer may see it (PRM-1); otherwise null, which the page shows as "not found".
 * Place names are in the screen's language (UI-9).
 */
export async function getCase(
  db: PrismaClient,
  viewer: Viewer,
  id: string,
  locale: Locale,
): Promise<CaseDetails | null> {
  const found = await db.case.findUnique({
    where: { id },
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      category: true,
      kind: true,
      name: true,
      childName: true,
      nic: true,
      address: true,
      gnDivision: true,
      mobile1: true,
      mobile2: true,
      remark: true,
      dsOfficeId: true,
      buildDsOfficeId: true,
      version: true,
      createdAt: true,
      submittedAt: true,
      verifiedAt: true,
      completedAt: true,
      statusBeforeStop: true,
      anotherNameRequested: true,
      replaces: { select: { ...REQUEST_SELECT, ...CASE_PLACES } },
      replacedBy: {
        select: {
          id: true,
          applicationNumber: true,
          name: true,
          childName: true,
          status: true,
          ...CASE_PLACES,
        },
      },
      updatedAt: true,
      buildDsOffice: {
        select: { ...OFFICE_PLACE.select, ...NAMES, district: { select: { id: true, provinceId: true, ...NAMES } } },
      },
      dsOffice: {
        select: {
          id: true,
          districtId: true,
          ...NAMES,
          active: true,
          district: { select: { id: true, provinceId: true, ...NAMES } },
        },
      },
      files: {
        where: { kind: "DOCUMENT", removedAt: null },
        orderBy: { uploadedAt: "asc" },
        select: { id: true, originalName: true },
      },
      decisions: {
        where: { type: { in: ["SEND_BACK", "REJECT", "STOP"] } },
        orderBy: { at: "desc" },
        take: 1,
        select: { type: true, reason: true, at: true },
      },
      release: {
        select: {
          releasedOn: true,
          amount: true,
          at: true,
          by: { select: LABEL_SELECT },
          letter: {
            select: {
              id: true,
              letterNumber: true,
              letterDate: true,
              validUntil: true,
              note: true,
              district: { select: NAMES },
              releases: { select: { case: { select: { verifiedAt: true } } } },
              files: { where: { kind: "LETTER", removedAt: null }, take: 1, select: { id: true } },
            },
          },
        },
      },
      installments: {
        orderBy: { number: "asc" },
        select: {
          number: true,
          amount: true,
          status: true,
          purpose: true,
          expectedOn: true,
          releasedOn: true,
          note: true,
        },
      },
    },
  });
  if (!found || !canSeeCase(viewer, found)) return null;
  const {
    dsOffice,
    buildDsOffice,
    files,
    decisions,
    release,
    installments,
    statusBeforeStop,
    replaces,
    replacedBy,
    ...fields
  } = found;
  const places = { dsOffice, buildDsOffice };
  const actsOn = { edit: canActOn(viewer, places, "edit"), progress: canActOn(viewer, places, "installment") };
  const latest = decisions[0];
  const stopped = found.status === "STOPPED" && latest?.type === "STOP";
  return {
    ...fields,
    officeName: localName(dsOffice, locale),
    officeActive: dsOffice.active,
    districtId: dsOffice.district.id,
    districtName: localName(dsOffice.district, locale),
    buildOfficeName: localName(buildDsOffice, locale),
    buildDistrictId: buildDsOffice.district.id,
    buildDistrictName: localName(buildDsOffice.district, locale),
    returnReason: found.status === "RETURNED" && latest?.type === "SEND_BACK" ? latest.reason : null,
    rejectReason: found.status === "REJECTED" && latest?.type === "REJECT" ? latest.reason : null,
    stop:
      found.status === "STOPPED"
        ? {
            at: stopped ? latest.at : fields.updatedAt,
            reason: stopped ? latest.reason : null,
            statusBefore: statusBeforeStop,
          }
        : null,
    // Both cases are always of one office (CASE-11); the check keeps it that way for the viewer.
    replaces: replaces && canSeeCase(viewer, replaces) ? toRequest(replaces) : null,
    replacedBy:
      replacedBy && canSeeCase(viewer, replacedBy)
        ? {
            id: replacedBy.id,
            applicationNumber: replacedBy.applicationNumber,
            name: replacedBy.name,
            childName: replacedBy.childName,
            status: replacedBy.status,
          }
        : null,
    documents: files.map((f) => ({ id: f.id, name: f.originalName })),
    release: release && {
      releasedOn: dateToDay(release.releasedOn),
      amount: release.amount,
      byName: accountLabel(release.by, locale),
      at: release.at,
      letter: {
        id: release.letter.id,
        letterNumber: release.letter.letterNumber,
        letterDate: dateToDay(release.letter.letterDate),
        validUntil: dateToDay(release.letter.validUntil),
        note: release.letter.note,
        districtName: localName(release.letter.district, locale),
        cases: release.letter.releases.length,
        latestVerification: latestDay(
          release.letter.releases.map((r) => r.case.verifiedAt && colomboDay(r.case.verifiedAt)),
        ),
        scanId: release.letter.files[0]?.id ?? null,
      },
    },
    installments: installments.map((i) => ({
      ...i,
      expectedOn: i.expectedOn && dateToDay(i.expectedOn),
      releasedOn: i.releasedOn && dateToDay(i.releasedOn),
    })),
    actsOn,
  };
}

export type CaseFilter = {
  /** Matches the name, child's name, Application Number or NIC (HOME-2, FND-1, CASE-12). */
  q?: string;
  statuses?: CaseStatus[];
  category?: Category;
  kind?: Kind;
  districtId?: number;
  dsOfficeId?: number;
  /** 1 is the first page. */
  page?: number;
};

export const PAGE_SIZE = 50;

export type CaseRow = {
  id: string;
  applicationNumber: string | null;
  status: CaseStatus;
  category: Category | null;
  kind: Kind | null;
  name: string | null;
  childName: string | null;
  /** The DS office of residence, which entered it. */
  dsOfficeId: number;
  officeName: string;
  districtName: string;
  /** CASE-13: the DS office where it is built, which pays it. */
  buildDsOfficeId: number;
  buildOfficeName: string;
  createdAt: Date;
  submittedAt: Date | null;
  updatedAt: Date;
  /** Installments paid (HOME-1); null before the release makes them. */
  paid: number | null;
  /** The highest stage reached (HOME-1), if any. */
  stageName: string | null;
};

/** A case in progress with no update for this many days is shown as waiting for one (HOME-1, HOME-3, DSH-1). */
export const STALE_DAYS = 30;

/** A case last changed before this moment has had no update for STALE_DAYS days or more, in Colombo days. */
export function staleBefore(now: Date): Date {
  return colomboStartOf(addDays(colomboDay(now), 1 - STALE_DAYS));
}

/**
 * The Prisma filter for what the viewer may see and asked for; null when they may see nothing.
 * The list and its Excel export (EXP-1) both use it, so the file holds exactly the screen's cases.
 */
export function caseWhere(viewer: Viewer, filter: CaseFilter): Prisma.CaseWhereInput | null {
  const scope = officeFilter(viewer);
  if (!scope) return null;

  const and: Prisma.CaseWhereInput[] = [scope];
  if (filter.statuses) and.push({ status: { in: filter.statuses } });
  if (filter.category) and.push({ category: filter.category });
  if (filter.kind) and.push({ kind: filter.kind });
  if (filter.districtId) and.push({ dsOffice: { districtId: filter.districtId } });
  if (filter.dsOfficeId) and.push({ dsOfficeId: filter.dsOfficeId });

  const q = filter.q?.trim();
  if (q) {
    const key = nicKey(q);
    const compact = normaliseNic(q);
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { childName: { contains: q, mode: "insensitive" } },
        // CASE-12: `kdw / 147` finds KDW/147.
        { applicationKey: { contains: applicationKey(q) } },
        { nic: { contains: compact } },
        ...(key ? [{ nicKey: key }] : []),
      ],
    });
  }
  return { AND: and };
}

/** A page of cases the viewer may see, the latest change first (FND-1, HOME-1). */
export async function listCases(
  db: PrismaClient,
  viewer: Viewer,
  filter: CaseFilter,
  locale: Locale,
): Promise<{ rows: CaseRow[]; total: number }> {
  const where = caseWhere(viewer, filter);
  if (!where) return { rows: [], total: 0 };
  const page = Math.max(1, filter.page ?? 1);

  const [found, total] = await Promise.all([
    db.case.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        applicationNumber: true,
        status: true,
        category: true,
        kind: true,
        name: true,
        childName: true,
        dsOfficeId: true,
        buildDsOfficeId: true,
        createdAt: true,
        submittedAt: true,
        updatedAt: true,
        dsOffice: { select: { ...NAMES, district: { select: NAMES } } },
        buildDsOffice: { select: NAMES },
        release: { select: { id: true } },
        _count: { select: { installments: { where: { status: "RELEASED" } } } },
        stageUpdates: {
          where: { stageId: { not: null } },
          orderBy: { stage: { sortOrder: "desc" } },
          take: 1,
          select: { stage: { select: NAMES } },
        },
      },
    }),
    db.case.count({ where }),
  ]);
  return {
    rows: found.map(({ dsOffice, buildDsOffice, release, _count, stageUpdates, ...row }) => ({
      ...row,
      officeName: localName(dsOffice, locale),
      districtName: localName(dsOffice.district, locale),
      buildOfficeName: localName(buildDsOffice, locale),
      paid: release ? _count.installments : null,
      stageName: stageUpdates[0]?.stage ? localName(stageUpdates[0].stage, locale) : null,
    })),
    total,
  };
}

export async function countCases(db: PrismaClient, viewer: Viewer, filter: CaseFilter): Promise<number> {
  const where = caseWhere(viewer, filter);
  return where ? db.case.count({ where }) : 0;
}

type TodoCase = { id: string; name: string | null; childName: string | null };

export type TodoItem = TodoCase &
  (
    | { type: "received"; /** "YYYY-MM-DD": the District's release. */ releasedOn: string }
    | { type: "due"; number: number; /** "YYYY-MM-DD" */ expectedOn: string; overdue: boolean }
    | { type: "stale"; days: number }
  );

/** HOME-3: an installment being paid shows in the to-do panel from 7 days before its expected day. */
export const DUE_SOON_DAYS = 7;

const TODO_TAKE = 20;

/**
 * HOME-3, in this order: cases whose allocation was received and whose first installment hasn't started;
 * installments being paid whose expected day has passed or is within 7 days; cases in progress with no
 * update for 30 days. Each is the work of the DS where the case is built (CASE-13).
 */
export async function todoItems(db: PrismaClient, viewer: Viewer, now = new Date()): Promise<TodoItem[]> {
  const progress = officeFilter(viewer, actingOffice("installment"));
  if (!progress) return [];
  const today = colomboDay(now);
  const caseFields = { id: true, name: true, childName: true } as const;

  const [received, due, stale] = await Promise.all([
    db.case.findMany({
      where: {
        ...progress,
        status: "ALLOCATION_RECEIVED",
        installments: { some: { number: 1, status: "NOT_STARTED" } },
      },
      orderBy: [{ release: { dsReleasedOn: "asc" } }, { id: "asc" }],
      take: TODO_TAKE,
      select: { ...caseFields, release: { select: { dsReleasedOn: true } } },
    }),
    db.installment.findMany({
      where: {
        status: "PROCESSING",
        expectedOn: { lte: dayToDate(addDays(today, DUE_SOON_DAYS)) },
        case: { ...progress, status: { in: ["ALLOCATION_RECEIVED", "IN_PROGRESS"] } },
      },
      orderBy: [{ expectedOn: "asc" }, { caseId: "asc" }],
      take: TODO_TAKE,
      select: { number: true, expectedOn: true, case: { select: caseFields } },
    }),
    db.case.findMany({
      where: { ...progress, status: "IN_PROGRESS", updatedAt: { lt: staleBefore(now) } },
      orderBy: { updatedAt: "asc" },
      take: TODO_TAKE,
      select: { ...caseFields, updatedAt: true },
    }),
  ]);

  return [
    ...received.map(({ release, ...c }) => ({
      ...c,
      type: "received" as const,
      releasedOn: release?.dsReleasedOn ? dateToDay(release.dsReleasedOn) : today,
    })),
    ...due.map((i) => {
      const expectedOn = i.expectedOn ? dateToDay(i.expectedOn) : today;
      return { ...i.case, type: "due" as const, number: i.number, expectedOn, overdue: expectedOn < today };
    }),
    ...stale.map(({ updatedAt, ...c }) => ({ ...c, type: "stale" as const, days: daysBetween(updatedAt, now) })),
  ];
}

export type OfficeMoney = { received: number; paidOut: number; balance: number };

/**
 * HOME-4: what the officer's office has received (the District's releases to it, REL-7), what it has
 * paid to beneficiaries (the installments marked paid), and the balance it holds. The money is counted
 * where the house is built (CASE-13).
 */
export async function officeMoney(db: PrismaClient, viewer: Viewer): Promise<OfficeMoney | null> {
  const scope = officeFilter(viewer, "built");
  if (!scope) return null;
  const [received, paid] = await Promise.all([
    db.release.aggregate({ where: { dsReleaseId: { not: null }, case: scope }, _sum: { amount: true } }),
    db.installment.aggregate({ where: { status: "RELEASED", case: scope }, _sum: { amount: true } }),
  ]);
  const total = received._sum.amount ?? 0;
  const paidOut = paid._sum.amount ?? 0;
  return { received: total, paidOut, balance: total - paidOut };
}

/** The officer's own office with its district, for the DS home and form (HOME-1, CASE-3). */
export async function officeSummary(
  db: PrismaClient,
  dsOfficeId: number,
  locale: Locale,
): Promise<{ name: string; districtName: string; active: boolean } | null> {
  const office = await db.dsOffice.findUnique({
    where: { id: dsOfficeId },
    select: { ...NAMES, active: true, district: { select: NAMES } },
  });
  return office
    ? { name: localName(office, locale), districtName: localName(office.district, locale), active: office.active }
    : null;
}
