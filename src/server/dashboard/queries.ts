import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus, Category, Kind } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/locales";
import { daysBetween } from "@/lib/dates";
import { localName, NAMES } from "@/lib/names";
import { staleBefore } from "../cases/queries";
import type { DistrictOptions } from "../lists/queries";
import { officeFilter, type Viewer } from "../permissions";

/** DSH-1's filters. Each one narrows every figure on the dashboard. */
export type DashboardFilter = { districtId?: number; category?: Category; kind?: Kind };

/** DSH-1's figures for a group of cases. */
export type Figures = {
  /** Every case. */
  cases: number;
  /** The cases in each of the five statuses (STS-1), keyed as in `STATUS_FIGURE`. */
  awaiting: number;
  allocatedToDistrict: number;
  received: number;
  inProgress: number;
  completed: number;
  /** The Ministry's Rs. 2,000,000 allocations to the districts (REL-3), from `ALLOCATED_TO_DISTRICT` on. */
  allocated: number;
  /** The Districts' releases of those allocations to the DS offices (REL-7), from `ALLOCATION_RECEIVED` on. */
  releasedToDs: number;
  /** The installments paid to beneficiaries (INS-4). */
  paidOut: number;
};

/** Which figure counts the cases in each status. */
export const STATUS_FIGURE = {
  AWAITING_ALLOCATION: "awaiting",
  ALLOCATED_TO_DISTRICT: "allocatedToDistrict",
  ALLOCATION_RECEIVED: "received",
  IN_PROGRESS: "inProgress",
  COMPLETED: "completed",
} as const satisfies Record<CaseStatus, keyof Figures>;

const FIGURES = [
  "cases",
  "awaiting",
  "allocatedToDistrict",
  "received",
  "inProgress",
  "completed",
  "allocated",
  "releasedToDs",
  "paidOut",
] as const satisfies (keyof Figures)[];

export type StaleCase = {
  id: string;
  applicationNumber: string;
  name: string | null;
  childName: string | null;
  officeName: string;
  districtName: string;
  /** Days since the last update: always STALE_DAYS or more. */
  days: number;
};

export type Dashboard = {
  totals: Figures;
  /** Each DS office's figures; an office with no cases is left out. */
  byOffice: Map<number, Figures>;
  /** Cases in progress with no update for 30 days or more: how many, and the longest waiting. */
  stale: { total: number; cases: StaleCase[] };
};

/** How many of the cases waiting longest for an update the dashboard lists. */
export const STALE_SHOWN = 10;

export const noFigures = (): Figures => ({
  cases: 0,
  awaiting: 0,
  allocatedToDistrict: 0,
  received: 0,
  inProgress: 0,
  completed: 0,
  allocated: 0,
  releasedToDs: 0,
  paidOut: 0,
});

function add(into: Figures, more: Figures): Figures {
  for (const key of FIGURES) into[key] += more[key];
  return into;
}

/**
 * DSH-1: the dashboard's figures for the cases the viewer may see that match the filter. They are
 * read from the database on every call, never kept, so the page is never more than a moment old (DSH-2).
 * A case counts once, under the DS office where it is built, and in the area of that office, as its
 * money does (CASE-13). The amounts count only the cases that have them: a case has its allocation once
 * the Ministry's letter names it, and its release once the District releases it to the DS.
 */
export async function dashboard(
  db: PrismaClient,
  viewer: Viewer,
  filter: DashboardFilter,
  locale: Locale,
  now = new Date(),
): Promise<Dashboard> {
  const scope = officeFilter(viewer, "built");
  if (!scope) return { totals: noFigures(), byOffice: new Map(), stale: { total: 0, cases: [] } };

  const where: Prisma.CaseWhereInput = {
    // AND, not a spread: a chosen district must narrow the viewer's area, never replace it.
    AND: [scope, filter.districtId ? { buildDsOffice: { districtId: filter.districtId } } : {}],
    ...(filter.category && { category: filter.category }),
    ...(filter.kind && { kind: filter.kind }),
  };
  const staleWhere: Prisma.CaseWhereInput = { ...where, status: "IN_PROGRESS", updatedAt: { lt: staleBefore(now) } };

  const [counts, funded, staleTotal, stale] = await Promise.all([
    db.case.groupBy({ by: ["buildDsOfficeId", "status"], where, _count: { _all: true } }),
    // Prisma can't sum a related table by office, so the cases with money come back one row each.
    db.case.findMany({
      where: { ...where, release: { isNot: null } },
      select: {
        buildDsOfficeId: true,
        release: { select: { amount: true, dsReleaseId: true } },
        installments: { where: { status: "RELEASED" }, select: { amount: true } },
      },
    }),
    db.case.count({ where: staleWhere }),
    db.case.findMany({
      where: staleWhere,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: STALE_SHOWN,
      select: {
        id: true,
        applicationNumber: true,
        name: true,
        childName: true,
        updatedAt: true,
        buildDsOffice: { select: { ...NAMES, district: { select: NAMES } } },
      },
    }),
  ]);

  const byOffice = new Map<number, Figures>();
  const office = (id: number) => {
    let figures = byOffice.get(id);
    if (!figures) byOffice.set(id, (figures = noFigures()));
    return figures;
  };
  for (const { buildDsOfficeId, status, _count } of counts) {
    const figures = office(buildDsOfficeId);
    figures.cases += _count._all;
    figures[STATUS_FIGURE[status]] += _count._all;
  }
  for (const { buildDsOfficeId, release, installments } of funded) {
    if (!release) continue;
    const figures = office(buildDsOfficeId);
    figures.allocated += release.amount;
    if (release.dsReleaseId) figures.releasedToDs += release.amount;
    for (const installment of installments) figures.paidOut += installment.amount;
  }

  return {
    totals: [...byOffice.values()].reduce(add, noFigures()),
    byOffice,
    stale: {
      total: staleTotal,
      cases: stale.map(({ updatedAt, buildDsOffice, ...c }) => ({
        ...c,
        officeName: localName(buildDsOffice, locale),
        districtName: localName(buildDsOffice.district, locale),
        days: daysBetween(updatedAt, now),
      })),
    },
  };
}

export type DashboardRow = Figures & { id: number; name: string; active: boolean };

/**
 * DSH-1's table: a row for each district, or, once a district is chosen, a row for each of its DS
 * offices. Every district shows, cases or not. An inactive office shows only while it has cases.
 */
export function tableRows(
  districts: DistrictOptions[],
  byOffice: Map<number, Figures>,
  districtId?: number,
): DashboardRow[] {
  if (districtId === undefined) {
    return districts.map((d) => ({
      id: d.id,
      name: d.name,
      active: true,
      ...d.offices.reduce((sum, o) => add(sum, byOffice.get(o.id) ?? noFigures()), noFigures()),
    }));
  }
  const offices = districts.find((d) => d.id === districtId)?.offices ?? [];
  return offices
    .map((o) => ({ ...o, ...(byOffice.get(o.id) ?? noFigures()) }))
    .filter((row) => row.active || row.cases > 0);
}
