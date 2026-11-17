/**
 * Made-up cases and records for the end-to-end tests that the screens can't make, run as a script so the
 * tests need no database client of their own (as `cleanup.ts`):
 *
 *   npx tsx tests/e2e/made-up-cases.ts period <marker>    adds `PERIOD_CASES` and prints them as JSON
 *   npx tsx tests/e2e/made-up-cases.ts exports <marker>   prints the downloads that searched for the marker
 *   npx tsx tests/e2e/made-up-cases.ts places <marker>    adds accounts in and around Kandy (AC-72)
 *   npx tsx tests/e2e/made-up-cases.ts pages <marker>     adds 55 accounts in Homagama (AC-73)
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
import { TEST_ACCOUNT_NAME, TEST_CASE_NAME } from "./helpers";

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
    else if (command === "places") console.log(JSON.stringify(await addPlacedAccounts(db, marker)));
    else if (command === "pages") console.log(JSON.stringify(await addManyAccounts(db, marker)));
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

type Db = ReturnType<typeof createPrismaClient>;
type MadeUpAccount = {
  name: string;
  designation: string;
  role: "DS_OFFICER" | "DISTRICT_OFFICER" | "VIEWER" | "MINISTRY_OFFICER";
  dsOfficeId?: number;
  districtId?: number;
  provinceId?: number;
  banned?: boolean;
  lastSignInAt?: Date;
};

/**
 * Writes made-up accounts straight into the table, named with `TEST_ACCOUNT_NAME` and the marker, so the
 * search finds only them and `cleanup.ts` deletes them. Their usernames aren't a prefix and four digits, so
 * the usernames the account form gives next (ADM-2) stay as they were; nobody signs in with them.
 */
async function writeAccounts(db: Db, marker: string, accounts: MadeUpAccount[]) {
  await db.user.createMany({
    data: accounts.map(({ name, ...account }, i) => ({
      ...account,
      id: `e2e-account-${marker}-${i}`,
      name: `${TEST_ACCOUNT_NAME} ${marker} ${name}`,
      email: `e2e-account-${marker}-${i}@no-email.invalid`,
      username: `e2e-${marker}-${i}`,
    })),
  });
}

/**
 * AC-72: eight accounts in and around Kandy: two in its first DS office, one in its second, a District
 * account, one in another Central district's office, a Provincial account for Central, one in Colombo's
 * Homagama, and a Ministry account with no place. Prints the places' ids and Sinhala names.
 * The DS accounts are view-only, so they get no notices of the offices' cases in other tests.
 */
async function addPlacedAccounts(db: Db, marker: string) {
  const kandy = await db.district.findFirstOrThrow({
    where: { nameEn: "Kandy" },
    select: { id: true, nameSi: true, provinceId: true, dsOffices: { orderBy: { id: "asc" }, take: 2 } },
  });
  const [office, otherOffice] = kandy.dsOffices;
  const central = await db.province.findUniqueOrThrow({ where: { id: kandy.provinceId } });
  const other = await db.district.findFirstOrThrow({
    where: { provinceId: kandy.provinceId, id: { not: kandy.id } },
    select: { id: true, dsOffices: { orderBy: { id: "asc" }, take: 1, select: { id: true } } },
  });
  const homagama = await db.dsOffice.findUniqueOrThrow({ where: { code: "HMG" } });
  await writeAccounts(db, marker, [
    { name: "1", designation: "DS_SECRETARY", role: "VIEWER", dsOfficeId: office.id },
    { name: "2", designation: "DS_ACCOUNTANT", role: "VIEWER", dsOfficeId: office.id },
    { name: "3", designation: "DS_SECRETARY", role: "VIEWER", dsOfficeId: otherOffice.id },
    { name: "4", designation: "DISTRICT_SECRETARY", role: "VIEWER", districtId: kandy.id },
    { name: "5", designation: "DS_ACCOUNTANT", role: "VIEWER", dsOfficeId: other.dsOffices[0].id },
    { name: "6", designation: "PROVINCE_COMMISSIONER", role: "VIEWER", provinceId: central.id },
    { name: "7", designation: "DS_ACCOUNTANT", role: "VIEWER", dsOfficeId: homagama.id },
    { name: "8", designation: "MINISTRY_SECRETARY", role: "VIEWER" },
  ]);
  return {
    province: { id: central.id, name: central.nameSi },
    district: { id: kandy.id, name: kandy.nameSi },
    office: { id: office.id, name: office.nameSi },
  };
}

/**
 * AC-73: 55 accounts in Homagama. Every fifth is disabled, and every third has signed in, each on a day of
 * its own in October 2026; the rest never signed in. Prints how many there are of each.
 */
async function addManyAccounts(db: Db, marker: string) {
  const homagama = await db.dsOffice.findUniqueOrThrow({ where: { code: "HMG" } });
  const accounts = Array.from({ length: 55 }, (_, i): MadeUpAccount => ({
    name: String(i + 10),
    designation: "DS_ACCOUNTANT",
    role: "VIEWER",
    dsOfficeId: homagama.id,
    banned: i % 5 === 0,
    ...(i % 3 === 0 && { lastSignInAt: new Date(Date.UTC(2026, 9, 1 + (i % 28), 4)) }),
  }));
  await writeAccounts(db, marker, accounts);
  return {
    total: accounts.length,
    neverSignedIn: accounts.filter((a) => !a.banned && !a.lastSignInAt).length,
  };
}

if (process.argv[1]?.endsWith("made-up-cases.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
