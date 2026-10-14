/**
 * Demo cases for showing the system: cases that look like the ones an office enters by hand, in every
 * DS office that has an active officer. So each officer who signs in finds a full home page, and Head
 * Office finds full queues, allocation letters and a dashboard.
 *
 *   npm run db:seed-demo                       adds 15 cases to each office with an officer and no demo cases yet
 *   npm run db:seed-demo -- --per-office 30    adds 30
 *   npm run db:seed-demo -- --seed 7           adds a different set; the same seed gives the same cases
 *   npm run db:seed-demo -- --remove           removes every demo case again
 *
 * It plans the cases as the load-test data does (scripts/seed-load.ts), with three differences:
 * - Every step is credited to a real account: the office's own officer (the first one with an account,
 *   when it has several), or a Head Office officer.
 * - Every step is also written to the audit log, so each case's history reads as if it had been
 *   entered on the screens, and each of the office's officers gets the notices those steps send (the
 *   older ones read).
 * - Each district's allocation letter goes out every second week, so a letter holds several cases.
 *
 * Every name, NIC and phone number is made up (SEC-11). It runs on development, test and staging
 * databases only, never in production. The cases' ids start with "demo-", which is how --remove finds
 * them. --remove deletes the cases and everything on them, but not their audit records, which can
 * never be removed (HIS-3); nothing shows those once their case is gone. Running it again adds cases
 * only to offices that have none, such as an office whose officer was added since. Remove the demo
 * cases before running the end-to-end tests, as with the load-test data.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { CaseStatus, Category } from "../src/generated/prisma/enums";
import { addDays, colomboDay } from "../src/lib/dates";
import { createPrismaClient } from "../src/server/db";
import { generator, madeUpPhone, type Random } from "./made-up";
import {
  type Cast,
  type Context,
  loadDataAllowed,
  type Office,
  type Person,
  planCase,
  readOffices,
  readStages,
  removeMadeUp,
  writePlanned,
} from "./seed-load";

/** Every demo case's id starts with this. */
export const DEMO_ID_PREFIX = "demo-";

const DEFAULT_PER_OFFICE = 15;
const DAY = 24 * 60 * 60_000;
/** Head Office sends each district's allocation letter every this many days. */
const LETTER_EVERY_DAYS = 14;

/** Each office's cases in turn: any first few are already a mix, and 15 cover every status. */
const STATUSES: CaseStatus[] = [
  "IN_PROGRESS",
  "SUBMITTED",
  "VERIFIED",
  "COMPLETED",
  "IN_PROGRESS",
  "DRAFT",
  "RETURNED",
  "IN_PROGRESS",
  "SUBMITTED",
  "STOPPED",
  "IN_PROGRESS",
  "VERIFIED",
  "COMPLETED",
  "REJECTED",
  "IN_PROGRESS",
];

// --- Made-up people (SEC-11) ----------------------------------------------------------------------

const WOMEN = [
  "කුසුමා",
  "චන්ද්‍රිකා",
  "ශ්‍රියානි",
  "දමයන්ති",
  "නිලන්ති",
  "ප්‍රියංගනී",
  "සුමනා",
  "ශාන්ති",
  "මල්ලිකා",
  "සුජීවා",
  "කාංචනා",
  "ඉනෝකා",
  "දීපිකා",
  "රේණුකා",
  "ස්වර්ණා",
  "නිරෝෂා",
  "චාමලී",
  "අනුලා",
  "පද්මිනී",
  "මාලනී",
];
const WOMEN_SECOND = ["රංජනී", "කුමාරි", "මැණිකේ", "ප්‍රියදර්ශනී", "ශ්‍රීමතී", "ජයන්ති", "සෙව්වන්දි", "නිල්මිණී"];
const MEN = ["සුනිල්", "ජයන්ත", "ප්‍රේමසිරි", "බන්දුල", "උපාලි", "සරත්", "ගාමිණී", "ලලිත්", "අනුර", "චන්දන"];
const BOYS = ["චමෝද්", "සෙනුර", "දිනුක", "ඔෂද", "කවිඳු", "යසිරු", "හසිත", "රවිඳු", "සෙනිත්", "තෙනුක", "පසිඳු"];
const BOYS_SECOND = ["දිල්ෂාන්", "සඳරුවන්", "මධුෂාන්", "ලක්ෂාන්", "ප්‍රබෝධ", "සත්සර", "නිම්නාද", "දිනෙත්"];
const GIRLS = ["සෙනුලි", "දිනුලි", "සඳලි", "ඔෂධි", "තිසරි", "හිරුනි", "කවීෂා", "සිතුමි", "යෙහෙනි"];
const GIRLS_SECOND = ["නෙත්මිනි", "දුල්මිනි", "සත්සරණි", "නිම්සරා", "සෙව්මිනි", "හංසිකා", "තරුෂි"];
const SURNAMES = [
  "පතිරණ",
  "පෙරේරා",
  "සිල්වා",
  "ප්‍රනාන්දු",
  "බණ්ඩාර",
  "ජයසූරිය",
  "ගුණවර්ධන",
  "හේරත්",
  "රත්නායක",
  "කුමාරසිංහ",
  "වීරසේකර",
  "දසනායක",
  "විජේසිංහ",
  "ලියනගේ",
  "සමරසිංහ",
  "ඒකනායක",
  "අමරසේකර",
  "වික්‍රමආරච්චි",
];
const VILLAGES = [
  "කුරුවිට",
  "පහළගම",
  "ඉහළගම",
  "මැදගම",
  "අලුත්ගම",
  "කොටුගොඩ",
  "වෙලේගෙදර",
  "දෙල්ගොඩ",
  "ගල්පාත",
  "හේනේගම",
  "උඩුගම",
  "පල්ලේගම",
  "කඳේගෙදර",
  "අඹගහවත්ත",
  "නාගොඩ",
  "කොස්ගම",
];
const SIDES = ["උතුර", "දකුණ", "නැගෙනහිර", "බටහිර"];
const ROADS = ["පාසල් මාවත", "පන්සල් පාර", "ප්‍රධාන පාර", "විහාර මාවත", "ගංගා පාර", "දෙවන පටුමග", "මල් පාර"];
const REMARKS = [
  "පවුලේ සාමාජිකයින් හතර දෙනෙකි.",
  "මව පමණක් රැකියාවක නියුතුය.",
  "දැනට කුලී නිවසක පදිංචිව සිටී.",
  "ඉඩම පවුලට අයත්ය.",
  "ළඟම පාසල කි.මී. තුනක් දුරින්.",
];

/** A made-up NIC for someone born in `year`: the 12-digit form, or before 2000 sometimes the old 9 digits and V. */
function nicFor(r: Random, year: number, female: boolean): string {
  const day = String(r.int(1, 365) + (female ? 500 : 0)).padStart(3, "0");
  if (year < 2000 && r.chance(0.3)) return `${String(year).slice(2)}${day}${r.int(1000, 9999)}V`;
  return `${year}${day}${r.int(10000, 99999)}`;
}

/**
 * A care leaver is a young adult; a child at risk has a guardian, most often the mother. The address
 * is in a village of the office's area, which is also the Grama Niladhari division, as in
 * "අංක 16, පාසල් මාවත, කුරුවිට, රත්නපුර".
 */
function demoPerson(r: Random, office: Office, category: Category | null): Person {
  let name: string;
  let nic: string;
  let childName: string | null = null;
  if (category === "CARE_LEAVER") {
    const female = r.chance(0.5);
    name = `${r.pick(female ? GIRLS : BOYS)} ${r.pick(SURNAMES)}`;
    nic = nicFor(r, r.int(2000, 2007), female);
  } else {
    const mother = r.chance(0.8);
    name = mother
      ? `${r.pick(WOMEN)} ${r.chance(0.6) ? r.pick(WOMEN_SECOND) : r.pick(SURNAMES)}`
      : `${r.pick(MEN)} ${r.pick(SURNAMES)}`;
    nic = nicFor(r, r.int(1965, 1992), mother);
    childName = r.chance(0.5) ? `${r.pick(BOYS)} ${r.pick(BOYS_SECOND)}` : `${r.pick(GIRLS)} ${r.pick(GIRLS_SECOND)}`;
  }
  const byOffice = r.chance(0.35);
  const village = byOffice ? office.nameSi : r.pick(VILLAGES);
  return {
    name,
    childName,
    nic,
    address: `අංක ${r.int(1, 220)}, ${r.pick(ROADS)}, ${village}, ${office.districtSi}`,
    gnDivision: byOffice ? `${office.nameSi} ${r.pick(SIDES)}` : village,
    mobile1: madeUpPhone(r),
    mobile2: r.chance(0.25) ? madeUpPhone(r) : null,
    remark: r.chance(0.3) ? r.pick(REMARKS) : null,
  };
}

// --- Adding and removing ------------------------------------------------------------------------

export type DemoOptions = {
  /** How many cases each office gets; 15 when left out. */
  perOffice?: number;
  /** The same seed gives the same cases. */
  seed?: number;
  now?: Date;
};

/**
 * Adds demo cases to every active DS office that has an active officer and no demo cases yet. Returns
 * the offices that got them.
 */
export async function addDemoData(db: PrismaClient, options: DemoOptions = {}): Promise<{ offices: string[] }> {
  if (!loadDataAllowed()) throw new Error(`Demo data is not allowed when APP_ENV is "${process.env.APP_ENV}".`);
  const perOffice = options.perOffice ?? DEFAULT_PER_OFFICE;
  if (!Number.isSafeInteger(perOffice) || perOffice < 1) throw new Error(`Not a number of cases: ${perOffice}`);
  const now = options.now ?? new Date();
  const r = generator(options.seed ?? 1);

  // Each office's active officers, the first account first (ADM-3).
  const officers = new Map<number, string[]>();
  for (const u of await db.user.findMany({
    where: { role: "DS_OFFICER", banned: false, dsOfficeId: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, dsOfficeId: true },
  })) {
    officers.set(u.dsOfficeId!, [...(officers.get(u.dsOfficeId!) ?? []), u.id]);
  }
  const headOffice = (
    await db.user.findMany({
      where: { role: "HO_OFFICER", banned: false },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
  ).map((u) => u.id);
  if (headOffice.length === 0)
    throw new Error("There is no active Head Office officer to check and release the cases.");
  const offices = await readOffices(db, {
    id: { in: [...officers.keys()] },
    cases: { none: { id: { startsWith: DEMO_ID_PREFIX } } },
  });
  if (offices.length === 0) return { offices: [] };

  const cast: Cast = {
    idPrefix: DEMO_ID_PREFIX,
    officers: (office) => officers.get(office.id)!,
    headOffice: (r) => r.pick(headOffice),
    person: demoPerson,
    // Cases still waiting are recent; the rest go back about a year and a half.
    age: (r, path, minAge) =>
      r.int(minAge, Math.max(minAge, ["DRAFT", "SUBMITTED", "RETURNED", "VERIFIED"].includes(path) ? 40 : 540)),
    // The first letter day after the verification, or today if that hasn't come yet.
    releaseDay: (_r, verifiedDay, office, today) => {
      const sinceEpoch = Math.round(Date.parse(verifiedDay) / DAY);
      const day = addDays(verifiedDay, LETTER_EVERY_DAYS - ((sinceEpoch + office.districtId) % LETTER_EVERY_DAYS));
      return day > today ? today : day;
    },
  };
  const ctx: Context = { r, now, today: colomboDay(now), stages: await readStages(db), cast };
  const planned = offices.flatMap((office) =>
    Array.from({ length: perOffice }, (_, index) => planCase(ctx, office, STATUSES[index % STATUSES.length])),
  );
  await writePlanned(db, r, planned, { idPrefix: DEMO_ID_PREFIX, history: true });
  return { offices: offices.map((o) => o.nameSi) };
}

/** Removes every demo case with everything that hangs off it, except its audit records (HIS-3). */
export async function removeDemoData(db: PrismaClient): Promise<number> {
  if (!loadDataAllowed()) throw new Error(`Demo data is not allowed when APP_ENV is "${process.env.APP_ENV}".`);
  return removeMadeUp(db, DEMO_ID_PREFIX);
}

// Run directly: npx tsx scripts/seed-demo.ts [--per-office N] [--seed N] [--remove]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = (name: string) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
  };
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const prisma = createPrismaClient(databaseUrl);
  const run = async () => {
    if (process.argv.includes("--remove")) {
      console.log(`Removed ${await removeDemoData(prisma)} demo cases.`);
      return;
    }
    const perOffice = Number(option("--per-office") ?? DEFAULT_PER_OFFICE);
    const seed = Number(option("--seed") ?? 1);
    const { offices } = await addDemoData(prisma, { perOffice, seed });
    console.log(
      offices.length === 0
        ? "Every DS office with an officer already has demo cases."
        : `Added ${perOffice} demo cases to each of ${offices.length} DS offices: ${offices.join(", ")}.`,
    );
  };
  run()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
