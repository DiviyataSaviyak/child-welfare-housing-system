/**
 * Demo cases for showing the system: cases that look like the ones an office enters by hand, in every
 * DS office that has an active officer. So each officer who signs in finds a full home page, the Ministry
 * finds cases awaiting their allocation, allocation letters and a dashboard, and a District CRPO finds cases
 * waiting for its release and the releases it made.
 *
 *   npm run db:seed-demo                       adds 15 cases to each office with an officer and no demo cases yet
 *   npm run db:seed-demo -- --per-office 30    adds 30
 *   npm run db:seed-demo -- --seed 7           adds a different set; the same seed gives the same cases
 *   npm run db:seed-demo -- --remove           removes every demo case again
 *
 * It plans the cases as the load-test data does (scripts/seed-load.ts), with three differences:
 * - Every step is credited to a real account: the office's own officer (the first one with an account,
 *   when it has several), a Ministry officer, or the district's District CRPO (the first one, when it has
 *   several; a Ministry officer stands in for a district that has none).
 * - Every step is also written to the audit log, so each case's history reads as if it had been
 *   entered on the screens, and each of the office's officers gets the notices those steps send (the
 *   older ones read).
 * - Each district's allocation letter goes out every second week, so a letter holds several cases, and the
 *   District releases it to each DS office a few days later. Each District officer of the district gets
 *   a notice of each letter.
 * - A few cases are built in another office that has an officer (CASE-13), so it pays them.
 * - Each office's cases include each of the land kinds (CASE-17), paid in amounts of their own (INS-7).
 * - Each office has an amendment in each status (change 0008): one waiting for the Ministry, one it rejected,
 *   and one it approved, so the office's first case took the place of a beneficiary entered before it, whose
 *   case is the office's sixteenth, replaced (AMD-5).
 *
 * Every name, NIC and phone number is made up (SEC-11). It runs on development, test and staging
 * databases only, never in production. The cases' ids start with "demo-", which is how --remove finds
 * them. --remove deletes the cases and everything on them, but not their audit records, which can
 * never be removed (HIS-3); nothing shows those once their case is gone. Running it again adds cases
 * only to offices that have none, such as an office whose officer was added since. Remove the demo
 * cases before running the end-to-end tests, as with the load-test data.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { Category, Kind, NotificationType } from "../src/generated/prisma/enums";
import { addDays, colomboDay, colomboStartOf } from "../src/lib/dates";
import { createPrismaClient } from "../src/server/db";
import { generator, madeUpPhone, MEN_RELATIVES, type Random, SIDES, WOMEN_RELATIVES } from "./made-up";
import {
  buildOfficeAmong,
  type Cast,
  type Context,
  loadDataAllowed,
  type Office,
  type Path,
  type Person,
  type Planned,
  type PlannedAmendment,
  planCase,
  readOffices,
  readProvinceIds,
  readStages,
  removeMadeUp,
  type Step,
  writePlanned,
} from "./seed-load";

/** Every demo case's id starts with this. */
export const DEMO_ID_PREFIX = "demo-";

const DEFAULT_PER_OFFICE = 15;
const DAY = 24 * 60 * 60_000;
/** The Ministry sends each district's allocation letter every this many days. */
const LETTER_EVERY_DAYS = 14;
/** Share of the cases built in another office than the one they were entered by (CASE-13). */
const ELSEWHERE_SHARE = 0.08;

/** Each office's cases in turn: any first few are already a mix, and 15 cover every status they can have. */
const STATUSES: Path[] = [
  "IN_PROGRESS",
  "AWAITING_ALLOCATION",
  "ALLOCATION_RECEIVED",
  "COMPLETED",
  "ALLOCATED_TO_DISTRICT",
  "AWAITING_ALLOCATION",
  "IN_PROGRESS",
  "AWAITING_ALLOCATION",
  "IN_PROGRESS",
  "COMPLETED",
  "IN_PROGRESS",
  "ALLOCATION_RECEIVED",
  "ALLOCATED_TO_DISTRICT",
  "IN_PROGRESS",
  "COMPLETED",
];
/**
 * The kind of help of each office's cases in turn, beside `STATUSES`: a few of each land kind (CASE-17), one
 * being paid, one completed and one waiting for its District; the rest houses, chosen at random.
 */
const KINDS: (Kind | undefined)[] = [];
KINDS[6] = "LAND_AND_BUILD";
KINDS[8] = "LAND_ONLY";
KINDS[9] = "LAND_WITH_HOUSE";
KINDS[12] = "LAND_ONLY";

/** The kinds of help a demo house case has, at random. */
const HOUSE_SHARE_NEW = 0.8;

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
const ROADS = ["පාසල් මාවත", "පන්සල් පාර", "ප්‍රධාන පාර", "විහාර මාවත", "ගංගා පාර", "දෙවන පටුමග", "මල් පාර"];
const REMARKS = [
  "මව පමණක් රැකියාවක නියුතුය.",
  "දැනට කුලී නිවසක පදිංචිව සිටී.",
  "වර්ෂා කාලයේදී ගංවතුරට ලක් වේ.",
  "ළඟම පාසල කි.මී. තුනක් දුරින්.",
];

/** A made-up NIC for someone born in `year`: the 12-digit form, or before 2000 sometimes the old 9 digits and V. */
function nicFor(r: Random, year: number, female: boolean): string {
  const day = String(r.int(1, 365) + (female ? 500 : 0)).padStart(3, "0");
  if (year < 2000 && r.chance(0.3)) return `${String(year).slice(2)}${day}${r.int(1000, 9999)}V`;
  return `${year}${day}${r.int(10000, 99999)}`;
}

/**
 * A care leaver is a young adult, whose NIC carries the year they were born (`born`); a child at risk has a
 * guardian, most often the mother, and now and then a grandmother, an uncle or another relative (CASE-15).
 * The address is in a village of the office's area, which is also the Grama Niladhari division, as in
 * "අංක 16, පාසල් මාවත, කුරුවිට, රත්නපුර".
 */
function demoPerson(r: Random, office: Office, category: Category, born: string): Person {
  let name: string;
  let nic: string;
  let childName: string | null = null;
  let relationship: Person["relationship"] = "MOTHER";
  let relationshipOther: string | null = null;
  if (category === "CARE_LEAVER") {
    const female = r.chance(0.5);
    name = `${r.pick(female ? GIRLS : BOYS)} ${r.pick(SURNAMES)}`;
    nic = nicFor(r, Number(born.slice(0, 4)), female);
  } else {
    const woman = r.chance(0.8);
    name = woman
      ? `${r.pick(WOMEN)} ${r.chance(0.6) ? r.pick(WOMEN_SECOND) : r.pick(SURNAMES)}`
      : `${r.pick(MEN)} ${r.pick(SURNAMES)}`;
    const parent = r.chance(0.85);
    relationship = parent ? (woman ? "MOTHER" : "FATHER") : "OTHER";
    if (!parent) relationshipOther = r.pick(woman ? WOMEN_RELATIVES : MEN_RELATIVES);
    // A grandparent is older than a parent.
    nic = nicFor(r, parent ? r.int(1965, 1992) : r.int(1950, 1975), woman);
    childName = r.chance(0.5) ? `${r.pick(BOYS)} ${r.pick(BOYS_SECOND)}` : `${r.pick(GIRLS)} ${r.pick(GIRLS_SECOND)}`;
  }
  const byOffice = r.chance(0.35);
  const village = byOffice ? office.nameSi : r.pick(VILLAGES);
  return {
    name,
    childName,
    relationship,
    relationshipOther,
    nic,
    address: `අංක ${r.int(1, 220)}, ${r.pick(ROADS)}, ${village}, ${office.districtSi}`,
    gnDivision: byOffice ? `${office.nameSi} ${r.pick(SIDES)}` : village,
    mobile1: madeUpPhone(r),
    mobile2: r.chance(0.25) ? madeUpPhone(r) : null,
    remark: r.chance(0.3) ? r.pick(REMARKS) : null,
  };
}

// --- Amendments (change 0008) ----------------------------------------------------------------------

/** Why a DS proposes another beneficiary (AMD-1), and why the Ministry refuses one (AMD-6). */
const AMENDMENT_REASONS = [
  "ඉඩමේ අයිතිය පිළිබඳ ගැටලුවක් ඇති බැවින් නිවස ඉදිකළ නොහැක.",
  "ප්‍රතිලාභියා පවුල සමඟ වෙනත් ප්‍රදේශයකට පදිංචියට ගොස් ඇත.",
  "ප්‍රතිලාභියාට වෙනත් ආයතනයකින් නිවසක් ලැබී ඇත.",
];
const REJECTION_REASONS = [
  "ඉඩම් ඔප්පුවේ පිටපත අමුණා නැත.",
  "නව ප්‍රතිලාභියාගේ පදිංචිය ග්‍රාම නිලධාරී මගින් තහවුරු කර නැත.",
];

const MINUTE = 60_000;
/** Notices older than this have been read, as the planner's are. */
const UNREAD_DAYS = 7;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** A moment during office hours on `day`, after `after`, and never after now, as the planner picks them. */
function momentOn(ctx: Context, day: string, after: Date): Date {
  let at = new Date(colomboStartOf(day).getTime() + ctx.r.int(510, 990) * MINUTE);
  if (at <= after) at = new Date(after.getTime() + ctx.r.int(5, 90) * MINUTE);
  return at > ctx.now ? ctx.now : at;
}

/** NTF-1, AMD-10: a notice on `p` to every officer of its two DS offices, each once. */
function notifyOffices(ctx: Context, p: Planned, type: NotificationType, at: Date) {
  const read = ctx.now.getTime() - at.getTime() > UNREAD_DAYS * DAY;
  for (const userId of new Set([...ctx.cast.officers(p.office), ...ctx.cast.officers(p.build)])) {
    p.notifications.push({
      id: randomUUID(),
      userId,
      caseId: p.case.id!,
      type,
      createdAt: at,
      readAt: read ? new Date(at.getTime() + 60 * MINUTE) : null,
    });
  }
}

/** The values without the empty ones, as a case's or an amendment's audit record holds them (HIS-1). */
const withoutEmpty = (values: object) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0)),
  ) as Record<string, Prisma.InputJsonValue>;

/** AMD-1: the DS of residence's officer proposes the amendment's beneficiary, as `submitAmendment` logs it. */
function submitted(ctx: Context, existing: Planned, amendment: PlannedAmendment, at: Date): Step {
  return {
    at,
    actorId: ctx.cast.officers(existing.office)[0]!,
    action: "amendment_submitted",
    entityType: "amendment",
    entityId: amendment.row.id,
    after: { ...withoutEmpty(amendment.details), reason: amendment.row.reason, documentsAdded: [] },
    numbers: { applicationNumber: amendment.row.id },
  };
}

/**
 * Change 0008: an amendment of each status among an office's cases, planned in `STATUSES`' order (AMD-9).
 * - Approved: the office's first case is the beneficiary the Ministry put in the place of one entered 20 to 60
 *   days earlier, while that one still awaited its allocation (AMD-5). The approval entered the new case, so
 *   its history starts with it; the earlier one is returned, replaced, to be written with the others.
 * - Waiting: on the next case awaiting its allocation, proposed since it was entered (AMD-3).
 * - Rejected: on the first case allocated to its district, refused 1 to 7 days after it was proposed (AMD-6),
 *   so the to-do panel mostly still shows it (HOME-3).
 * The last two's new beneficiaries would be built where their case is, which AMD-8 always allows.
 */
function planAmendments(ctx: Context, cases: Planned[]): { replaced: Planned[]; amendments: PlannedAmendment[] } {
  const { r, cast, today } = ctx;
  const amendments: PlannedAmendment[] = [];
  const replaced: Planned[] = [];
  const newId = () => `${cast.idPrefix}${randomUUID()}`;

  const approvedIn = cases[0];
  if (approvedIn) {
    const created = approvedIn.history.find((step) => step.action === "case_created")!;
    const decidedAt = created.at;
    const newDay = colomboDay(decidedAt);
    const gap = r.int(20, 60);
    const earlier = planCase(
      { ...ctx, cast: { ...cast, age: () => daysBetween(newDay, today) + gap } },
      approvedIn.office,
      "AWAITING_ALLOCATION",
    );
    const submittedAt = momentOn(ctx, addDays(newDay, -r.int(3, gap - 1)), new Date(earlier.case.createdAt!));
    const ministry = cast.ministry(r);
    const amendment: PlannedAmendment = {
      office: approvedIn.office,
      row: {
        id: newId(),
        caseId: earlier.case.id!,
        reason: r.pick(AMENDMENT_REASONS),
        status: "APPROVED",
        submittedById: cast.officers(approvedIn.office)[0]!,
        submittedAt,
        decidedById: ministry,
        decidedAt,
        newCaseId: approvedIn.case.id!,
        version: 2,
      },
      details: { ...approvedIn.form, buildDsOfficeId: approvedIn.build.id },
    };
    amendments.push(amendment);

    // The earlier beneficiary: proposed to be replaced, then replaced by the approval (the `replace` move).
    earlier.case.status = "REPLACED";
    earlier.case.version = Number(earlier.case.version) + 1;
    earlier.case.updatedAt = decidedAt;
    earlier.history.push(submitted(ctx, earlier, amendment, submittedAt), {
      at: decidedAt,
      actorId: ministry,
      action: "case_replaced",
      entityType: "case",
      entityId: earlier.case.id!,
      before: { status: "AWAITING_ALLOCATION" },
      after: {
        status: "REPLACED",
        amendmentId: amendment.row.id,
        newCaseId: approvedIn.case.id!,
        newName: approvedIn.case.name ?? null,
        newChildName: approvedIn.case.childName ?? null,
        allocationMoved: false,
      },
      numbers: { newApplicationNumber: approvedIn.case.id! },
    });
    replaced.push(earlier);

    // The approval entered the new case, and its history says so (`approveAmendment`).
    approvedIn.case.replacesCaseId = earlier.case.id!;
    Object.assign(created, {
      actorId: ministry,
      action: "amendment_approved",
      entityType: "amendment",
      entityId: amendment.row.id,
      numbers: { applicationNumber: approvedIn.case.id!, replacedApplicationNumber: earlier.case.id! },
    });
    Object.assign(created.after, {
      reason: amendment.row.reason,
      replacesCaseId: earlier.case.id!,
      replacedName: earlier.case.name ?? null,
      replacedChildName: earlier.case.childName ?? null,
      allocationMoved: false,
    });
    notifyOffices(ctx, approvedIn, "AMENDMENT_APPROVED", decidedAt);
  }

  // Proposed on a day since `existing` was entered; rejected `decideAfter` days later when that is given.
  const propose = (existing: Planned | undefined, decideAfter?: number) => {
    if (!existing) return;
    const enteredAt = new Date(existing.case.createdAt!);
    const enteredDay = colomboDay(enteredAt);
    const day = addDays(enteredDay, r.int(0, daysBetween(enteredDay, today)));
    const submittedAt = momentOn(ctx, day, enteredAt);
    // The person the DS proposes, as they were on that day, built where the case is.
    const proposed = planCase(
      { ...ctx, cast: { ...cast, buildOffice: () => existing.build, age: () => daysBetween(day, today) } },
      existing.office,
      "AWAITING_ALLOCATION",
    );
    const amendment: PlannedAmendment = {
      office: existing.office,
      row: {
        id: newId(),
        caseId: existing.case.id!,
        reason: r.pick(AMENDMENT_REASONS),
        status: "WAITING",
        submittedById: cast.officers(existing.office)[0]!,
        submittedAt,
      },
      details: { ...proposed.form, buildDsOfficeId: existing.build.id },
    };
    amendments.push(amendment);
    existing.history.push(submitted(ctx, existing, amendment, submittedAt));
    if (decideAfter === undefined) return;

    const decidedAt = momentOn(ctx, addDays(day, decideAfter), submittedAt);
    const ministry = cast.ministry(r);
    const rejectionReason = r.pick(REJECTION_REASONS);
    Object.assign(amendment.row, { status: "REJECTED", decidedById: ministry, decidedAt, rejectionReason, version: 2 });
    existing.history.push({
      at: decidedAt,
      actorId: ministry,
      action: "amendment_rejected",
      entityType: "amendment",
      entityId: amendment.row.id,
      after: { reason: rejectionReason, name: amendment.details.name, childName: amendment.details.childName },
      numbers: { applicationNumber: amendment.row.id },
    });
    notifyOffices(ctx, existing, "AMENDMENT_REJECTED", decidedAt);
  };
  const others = cases.slice(1);
  propose(others.find((p) => p.case.status === "AWAITING_ALLOCATION"));
  propose(
    others.find((p) => p.case.status === "ALLOCATED_TO_DISTRICT"),
    r.int(1, 7),
  );
  return { replaced, amendments };
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
  // Each district's active District officers, the first account first.
  const districtOfficers = new Map<number, string[]>();
  for (const u of await db.user.findMany({
    where: { role: "DISTRICT_OFFICER", banned: false, districtId: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, districtId: true },
  })) {
    districtOfficers.set(u.districtId!, [...(districtOfficers.get(u.districtId!) ?? []), u.id]);
  }
  const ministry = (
    await db.user.findMany({
      where: { role: "MINISTRY_OFFICER", banned: false },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
  ).map((u) => u.id);
  if (ministry.length === 0) throw new Error("There is no active Ministry officer to record the allocation letters.");
  // Every office with an officer may build a case, even one that already has demo cases of its own.
  const withOfficers = await readOffices(db, { id: { in: [...officers.keys()] } });
  const offices = await readOffices(db, {
    id: { in: [...officers.keys()] },
    cases: { none: { id: { startsWith: DEMO_ID_PREFIX } } },
  });
  if (offices.length === 0) return { offices: [] };

  const cast: Cast = {
    idPrefix: DEMO_ID_PREFIX,
    officers: (office) => officers.get(office.id)!,
    buildOffice: buildOfficeAmong(withOfficers, ELSEWHERE_SHARE),
    ministry: (r) => r.pick(ministry),
    districtOfficer: (r, office) => districtOfficers.get(office.districtId)?.[0] ?? r.pick(ministry),
    districtOfficers: (districtId) => districtOfficers.get(districtId) ?? [],
    person: demoPerson,
    // Cases still waiting are recent; the rest go back about a year and a half.
    age: (r, path, minAge) =>
      r.int(minAge, Math.max(minAge, path === "AWAITING_ALLOCATION" || path === "ALLOCATED_TO_DISTRICT" ? 40 : 540)),
    // The first letter day after the day it was entered, or today if that hasn't come yet.
    releaseDay: (_r, enteredDay, office, today) => {
      const sinceEpoch = Math.round(Date.parse(enteredDay) / DAY);
      const day = addDays(enteredDay, LETTER_EVERY_DAYS - ((sinceEpoch + office.districtId) % LETTER_EVERY_DAYS));
      return day > today ? today : day;
    },
    // The District releases each letter to each DS office 2 to 8 days after it, the same day for all of the
    // letter's cases of that office.
    dsReleaseDay: (_r, letterDay, office, today) => {
      const sinceEpoch = Math.round(Date.parse(letterDay) / DAY);
      const day = addDays(letterDay, 2 + ((sinceEpoch + office.id) % 7));
      return day > today ? today : day;
    },
  };
  const ctx: Context = {
    r,
    now,
    today: colomboDay(now),
    stages: await readStages(db),
    provinceIds: await readProvinceIds(db),
    cast,
  };
  const planned: Planned[] = [];
  const amendments: PlannedAmendment[] = [];
  for (const office of offices) {
    const cases = Array.from({ length: perOffice }, (_, index) =>
      planCase(
        ctx,
        office,
        STATUSES[index % STATUSES.length],
        KINDS[index % STATUSES.length] ?? (r.chance(HOUSE_SHARE_NEW) ? "NEW_HOUSE" : "RENOVATION"),
      ),
    );
    const theirs = planAmendments(ctx, cases);
    planned.push(...cases, ...theirs.replaced);
    amendments.push(...theirs.amendments);
  }
  await writePlanned(db, r, planned, {
    idPrefix: DEMO_ID_PREFIX,
    history: true,
    districtOfficers: cast.districtOfficers,
    amendments,
  });
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
        : `Added ${perOffice} demo cases, a replaced one and three amendments to each of ${offices.length} DS offices: ${offices.join(", ")}.`,
    );
  };
  run()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
