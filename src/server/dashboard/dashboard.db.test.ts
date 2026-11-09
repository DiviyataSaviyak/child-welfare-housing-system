import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { addLoadData, removeLoadData } from "../../../scripts/seed-load";
import { createTestClient } from "../../../tests/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { daysBetween } from "@/lib/dates";
import { CATEGORIES, KINDS } from "@/lib/validation/case";
import { STALE_DAYS } from "../cases/queries";
import { queueCounts } from "../cases/queues";
import { districtsWithOffices, type DistrictOptions } from "../lists/queries";
import type { Viewer } from "../permissions";
import { dashboard, type DashboardFilter, type Figures, noFigures, STALE_SHOWN, tableRows } from "./queries";

const db = createTestClient();
const ho: Viewer = {
  role: "MINISTRY_OFFICER",
  designation: "MINISTRY_PROGRAMME_OFFICER",
  districtId: null,
  provinceId: null,
  dsOfficeId: null,
};
const LOAD = 5_000;

let districts: DistrictOptions[];

beforeAll(async () => {
  await seed(db);
  await addLoadData(db, { count: LOAD, seed: 7 });
  districts = await districtsWithOffices(db, "si");
}, 300_000);

afterAll(async () => {
  await removeLoadData(db);
  await db.$disconnect();
}, 300_000);

const figures = ({ cases, inProgress, completed, released, paidOut }: Figures): Figures => ({
  cases,
  inProgress,
  completed,
  released,
  paidOut,
});

const sum = (rows: Figures[]): Figures =>
  rows.reduce(
    (total, row) => ({
      cases: total.cases + row.cases,
      inProgress: total.inProgress + row.inProgress,
      completed: total.completed + row.completed,
      released: total.released + row.released,
      paidOut: total.paidOut + row.paidOut,
    }),
    noFigures(),
  );

const caseWhere = (filter: DashboardFilter): Prisma.CaseWhereInput => ({
  ...(filter.category && { category: filter.category }),
  ...(filter.kind && { kind: filter.kind }),
  ...(filter.districtId && { dsOffice: { districtId: filter.districtId } }),
});

/** DSH-1's figures summed by the database itself, without the dashboard's code (AC-17). */
async function direct(where: Prisma.CaseWhereInput): Promise<Figures> {
  const sent: Prisma.CaseWhereInput = { AND: [where, { status: { not: "DRAFT" } }] };
  const [cases, inProgress, completed, released, paid] = await Promise.all([
    db.case.count({ where: sent }),
    db.case.count({ where: { AND: [where, { status: "IN_PROGRESS" }] } }),
    db.case.count({ where: { AND: [where, { status: "COMPLETED" }] } }),
    db.release.aggregate({ where: { case: sent }, _sum: { amount: true } }),
    db.installment.aggregate({ where: { status: "RELEASED", case: sent }, _sum: { amount: true } }),
  ]);
  return { cases, inProgress, completed, released: released._sum.amount ?? 0, paidOut: paid._sum.amount ?? 0 };
}

/** The cases in progress with no update for 30 days or more, counted in Colombo days, the longest first. */
async function staleCases(where: Prisma.CaseWhereInput, now: Date) {
  const building = await db.case.findMany({
    where: { AND: [where, { status: "IN_PROGRESS" }] },
    select: { id: true, updatedAt: true },
  });
  return building
    .map((c) => ({ id: c.id, days: daysBetween(c.updatedAt, now) }))
    .filter((c) => c.days >= STALE_DAYS)
    .sort((a, b) => b.days - a.days);
}

describe("Head Office dashboard (DSH-1)", () => {
  it("AC-17: every figure equals the database's own sums, for each filter", async () => {
    const now = new Date();
    const choices: DashboardFilter[] = [];
    for (const districtId of [undefined, districts[0].id, districts.at(-1)!.id])
      for (const category of [undefined, ...CATEGORIES])
        for (const kind of [undefined, ...KINDS]) choices.push({ districtId, category, kind });

    for (const filter of choices) {
      const data = await dashboard(db, ho, filter, "si", now);
      const where = caseWhere(filter);
      expect(data.totals, JSON.stringify(filter)).toEqual(await direct(where));
      expect(sum([...data.byOffice.values()])).toEqual(data.totals);

      const stale = await staleCases(where, now);
      expect(data.stale.total, JSON.stringify(filter)).toBe(stale.length);
      expect(data.stale.cases.length).toBe(Math.min(stale.length, STALE_SHOWN));
    }

    // The load-test data reaches every figure, so none of the checks above compared only zeros.
    const all = await dashboard(db, ho, {}, "si", now);
    for (const value of Object.values(all.totals)) expect(value).toBeGreaterThan(0);
    expect(all.totals.cases).toBeGreaterThan(LOAD * 0.9);
    // 18 filters, each read twice over 5,000 cases: a check of the sums, not of speed (that is AC-21).
  }, 30_000);

  it("shows every district, each equal to its own sums; a district opens into its DS offices", async () => {
    const all = await dashboard(db, ho, {}, "si");
    const rows = tableRows(districts, all.byOffice);
    expect(rows.map((r) => r.id)).toEqual(districts.map((d) => d.id));
    expect(sum(rows)).toEqual(all.totals);
    for (const row of rows) expect(figures(row), row.name).toEqual(await direct({ dsOffice: { districtId: row.id } }));

    const busiest = rows.toSorted((a, b) => b.cases - a.cases)[0];
    const inDistrict = await dashboard(db, ho, { districtId: busiest.id }, "si");
    expect(inDistrict.totals).toEqual(figures(busiest));
    const offices = tableRows(districts, inDistrict.byOffice, busiest.id);
    expect(offices.length).toBeGreaterThan(1);
    expect(sum(offices)).toEqual(inDistrict.totals);
    for (const office of offices) expect(figures(office), office.name).toEqual(await direct({ dsOfficeId: office.id }));
  });

  it("lists the cases waiting longest for an update first, with their days, office and district", async () => {
    const now = new Date();
    const data = await dashboard(db, ho, {}, "si", now);
    const expected = await staleCases({}, now);
    expect(data.stale.total).toBeGreaterThan(STALE_SHOWN);

    const shown = data.stale.cases;
    expect(shown).toHaveLength(STALE_SHOWN);
    expect(shown.map((c) => c.days)).toEqual(expected.slice(0, STALE_SHOWN).map((c) => c.days));
    const days = new Map(expected.map((c) => [c.id, c.days]));
    for (const c of shown) {
      expect(days.get(c.id)).toBe(c.days);
      expect(c.officeName).not.toBe("");
      expect(c.districtName).not.toBe("");
    }
  });

  it("keeps to what the viewer may see: a DS officer only their own office, an admin nothing (PRM-1)", async () => {
    const all = await dashboard(db, ho, {}, "si");
    const [officeId] = [...all.byOffice.entries()].toSorted(([, a], [, b]) => b.cases - a.cases)[0];

    const own = await dashboard(
      db,
      { role: "DS_OFFICER", designation: "DS_CRPO", districtId: null, provinceId: null, dsOfficeId: officeId },
      {},
      "si",
    );
    expect([...own.byOffice.keys()]).toEqual([officeId]);
    expect(own.totals).toEqual(await direct({ dsOfficeId: officeId }));

    const admin = await dashboard(
      db,
      { role: "ADMIN", designation: null, districtId: null, provinceId: null, dsOfficeId: null },
      {},
      "si",
    );
    expect(admin).toEqual({ totals: noFigures(), byOffice: new Map(), stale: { total: 0, cases: [] } });
  });

  it("AC-21: with 5,000 cases, everything the page reads takes under 2 seconds", async () => {
    expect(await db.case.count()).toBeGreaterThanOrEqual(LOAD);
    const filters: DashboardFilter[] = [
      {},
      { districtId: districts[0].id },
      { category: CATEGORIES[1], kind: KINDS[0] },
    ];
    for (const filter of filters) {
      const started = performance.now();
      const list = await districtsWithOffices(db, "si");
      const [data] = await Promise.all([dashboard(db, ho, filter, "si"), queueCounts(db, ho)]);
      tableRows(list, data.byOffice, filter.districtId);
      expect(performance.now() - started, JSON.stringify(filter)).toBeLessThan(2_000);
    }
  });
});
