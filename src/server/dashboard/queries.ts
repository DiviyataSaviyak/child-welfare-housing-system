import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Category, Kind } from "@/generated/prisma/enums";
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
  /** Every case except drafts. */
  cases: number;
  inProgress: number;
  completed: number;
  /** The Rs. 2,000,000 releases to DS offices (REL-2). */
  released: number;
  /** The installments paid to beneficiaries (INS-4). */
  paidOut: number;
};

export type StaleCase = {
  id: string;
  applicationNumber: string | null;
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

export const noFigures = (): Figures => ({ cases: 0, inProgress: 0, completed: 0, released: 0, paidOut: 0 });

function add(into: Figures, more: Figures): Figures {
  into.cases += more.cases;
  into.inProgress += more.inProgress;
  into.completed += more.completed;
  into.released += more.released;
  into.paidOut += more.paidOut;
  return into;
}

/**
 * DSH-1: the dashboard's figures for the cases the viewer may see that match the filter. They are
 * read from the database on every call, never kept, so the page is never more than a moment old (DSH-2).
 */
export async function dashboard(
  db: PrismaClient,
  viewer: Viewer,
  filter: DashboardFilter,
  locale: Locale,
  now = new Date(),
): Promise<Dashboard> {
  const scope = officeFilter(viewer);
  if (!scope) return { totals: noFigures(), byOffice: new Map(), stale: { total: 0, cases: [] } };

  const where: Prisma.CaseWhereInput = {
    // AND, not a spread: a chosen district must narrow the viewer's area, never replace it.
    AND: [scope, filter.districtId ? { dsOffice: { districtId: filter.districtId } } : {}],
    status: { not: "DRAFT" },
    ...(filter.category && { category: filter.category }),
    ...(filter.kind && { kind: filter.kind }),
  };
  const staleWhere: Prisma.CaseWhereInput = { ...where, status: "IN_PROGRESS", updatedAt: { lt: staleBefore(now) } };

  const [counts, funded, staleTotal, stale] = await Promise.all([
    db.case.groupBy({ by: ["dsOfficeId", "status"], where, _count: { _all: true } }),
    // Prisma can't sum a related table by office, so the cases with money come back one row each.
    db.case.findMany({
      where: { ...where, release: { isNot: null } },
      select: {
        dsOfficeId: true,
        release: { select: { amount: true } },
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
        dsOffice: { select: { ...NAMES, district: { select: NAMES } } },
      },
    }),
  ]);

  const byOffice = new Map<number, Figures>();
  const office = (id: number) => {
    let figures = byOffice.get(id);
    if (!figures) byOffice.set(id, (figures = noFigures()));
    return figures;
  };
  for (const { dsOfficeId, status, _count } of counts) {
    const figures = office(dsOfficeId);
    figures.cases += _count._all;
    if (status === "IN_PROGRESS") figures.inProgress += _count._all;
    if (status === "COMPLETED") figures.completed += _count._all;
  }
  for (const { dsOfficeId, release, installments } of funded) {
    const figures = office(dsOfficeId);
    figures.released += release?.amount ?? 0;
    for (const installment of installments) figures.paidOut += installment.amount;
  }

  return {
    totals: [...byOffice.values()].reduce(add, noFigures()),
    byOffice,
    stale: {
      total: staleTotal,
      cases: stale.map(({ updatedAt, dsOffice, ...c }) => ({
        ...c,
        officeName: localName(dsOffice, locale),
        districtName: localName(dsOffice.district, locale),
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
