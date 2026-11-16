/**
 * Made-up cases and records for the end-to-end tests that the screens can't make, run as a script so the
 * tests need no database client of their own (as `cleanup.ts`):
 *
 *   npx tsx tests/e2e/made-up-cases.ts period <marker>    adds `PERIOD_CASES` and prints them as JSON
 *   npx tsx tests/e2e/made-up-cases.ts exports <marker>   prints the downloads that searched for the marker
 *
 * `period` adds cases entered over a year (EXP-4, AC-70) through the made-up data's planner
 * (`scripts/seed-load.ts`), each awaiting its allocation, entered by the office's sample officer, and named
 * with `TEST_CASE_NAME`, the marker and a number, so the search finds only them and `cleanup.ts` deletes them.
 * Their people are made up (SEC-11). Runs only where sample accounts are allowed.
 */
import "dotenv/config";
import { sampleUsersAllowed } from "../../prisma/seed-users";
import type { Category } from "../../src/generated/prisma/enums";
import { addDays, colomboDay } from "../../src/lib/dates";
import { createPrismaClient } from "../../src/server/db";
import { generator, madeUpNic, madeUpPhone } from "../../scripts/made-up";
import { type Cast, planCase, readOffices, readProvinceIds, readStages, writePlanned } from "../../scripts/seed-load";
import { TEST_CASE_NAME } from "./helpers";

/** Each case `period` adds: its DS office (by code), how many days ago it was entered, and its category. */
export const PERIOD_CASES: { office: "HMG" | "BYG"; age: number; category: Category }[] = [
  // Homagama (ds0101, Colombo): three in the last month, five over the year before.
  { office: "HMG", age: 0, category: "CARE_LEAVER" },
  { office: "HMG", age: 6, category: "CHILD_AT_RISK" },
  { office: "HMG", age: 20, category: "CARE_LEAVER" },
  { office: "HMG", age: 45, category: "CHILD_AT_RISK" },
  { office: "HMG", age: 90, category: "CARE_LEAVER" },
  { office: "HMG", age: 160, category: "CHILD_AT_RISK" },
  { office: "HMG", age: 250, category: "CARE_LEAVER" },
  { office: "HMG", age: 340, category: "CHILD_AT_RISK" },
  // Biyagama (ds0105, Gampaha): one in the last month, one long before.
  { office: "BYG", age: 10, category: "CARE_LEAVER" },
  { office: "BYG", age: 200, category: "CHILD_AT_RISK" },
];

/** The sample officer of each office, who enters its cases (prisma/seed-users.ts). */
const OFFICERS = { HMG: "sample-ds0101", BYG: "sample-ds0105" } as const;

export type PeriodCase = { name: string; office: string; category: Category; enteredDay: string };

async function main() {
  if (!sampleUsersAllowed()) throw new Error("End-to-end data is only made on development and test databases.");
  const [command, marker] = process.argv.slice(2);
  if (!marker || !/^\d+$/.test(marker)) throw new Error("Give the marker: digits, as the tests' names use.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const db = createPrismaClient(databaseUrl);
  try {
    if (command === "period") console.log(JSON.stringify(await addPeriodCases(db, marker)));
    else if (command === "exports") console.log(JSON.stringify(await exportsOf(db, marker)));
    else throw new Error(`Unknown command: ${command}`);
  } finally {
    await db.$disconnect();
  }
}

async function addPeriodCases(db: ReturnType<typeof createPrismaClient>, marker: string): Promise<PeriodCase[]> {
  const r = generator(Number(marker.slice(-6)));
  const now = new Date();
  const today = colomboDay(now);
  const offices = await readOffices(db, { code: { in: Object.keys(OFFICERS) } });
  let current = PERIOD_CASES[0];
  let name = "";
  const cast: Cast = {
    idPrefix: "e2e-",
    officers: (office) => [OFFICERS[office.code as keyof typeof OFFICERS]],
    buildOffice: (_r, office) => office,
    ministry: () => "sample-ho0001",
    districtOfficer: () => "sample-ho0001",
    districtOfficers: () => [],
    person: (r, _office, category) => ({
      name,
      childName: category === "CHILD_AT_RISK" ? "පරීක්ෂණ දරුවා" : null,
      relationship: "MOTHER",
      relationshipOther: null,
      nic: madeUpNic(r),
      address: "නො. 1, පරීක්ෂණ පාර, නගරය",
      gnDivision: null,
      mobile1: madeUpPhone(r),
      mobile2: null,
      remark: null,
    }),
    age: () => current.age,
    // Nothing is allocated.
    releaseDay: (_r, _day, _office, day) => day,
    dsReleaseDay: (_r, _day, _office, day) => day,
  };
  const ctx = { r, now, today, stages: await readStages(db), provinceIds: await readProvinceIds(db), cast };
  const made: PeriodCase[] = [];
  const planned = PERIOD_CASES.map((wanted, index) => {
    current = wanted;
    name = `${TEST_CASE_NAME} කාල සීමාව ${marker} ${index + 1}`;
    const office = offices.find((o) => o.code === wanted.office);
    if (!office) throw new Error(`The office ${wanted.office} is missing: run the seed first.`);
    made.push({ name, office: wanted.office, category: wanted.category, enteredDay: addDays(today, -wanted.age) });
    return planCase(ctx, office, "AWAITING_ALLOCATION", "NEW_HOUSE", wanted.category);
  });
  await writePlanned(db, r, planned, { idPrefix: "e2e-", history: false });
  return made;
}

/** EXP-3: the downloads whose search was the marker, newest first, with their filters and rows. */
async function exportsOf(db: ReturnType<typeof createPrismaClient>, marker: string) {
  const records = await db.auditLog.findMany({
    where: { action: "cases_exported", after: { path: ["filters", "q"], equals: marker } },
    orderBy: { id: "desc" },
    select: { actorId: true, entityId: true, after: true },
  });
  return records;
}

if (process.argv[1]?.endsWith("made-up-cases.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
