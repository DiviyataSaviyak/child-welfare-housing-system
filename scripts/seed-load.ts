/**
 * Made-up cases for load tests (PRF-1, PRF-3, PRF-4): 5,000 by default, spread over every active DS
 * office, at every point of a case's life. There are cases awaiting their allocation, cases the Ministry
 * allocated to their district, cases the District released to their DS office, cases being built with their
 * installments and stages (some with no update for 30 days or more), and completed cases. A few are built
 * in another DS office than the one they were entered by (CASE-13).
 *
 *   npm run db:seed-load                   adds 5,000 cases
 *   npm run db:seed-load -- --count 500    adds 500
 *   npm run db:seed-load -- --seed 7       adds a different set; the same seed gives the same cases
 *   npm run db:seed-load -- --remove       removes every load-test case again
 *
 * Every name, NIC and phone number is made up (SEC-11). It runs on development, test and staging
 * databases only, never in production.
 * - The cases' ids start with "load-", which is how --remove finds them. Each gets an Application Number as
 *   a paper application might carry ({DS code}/{N}), after the highest one of that form its office already
 *   has (CASE-12).
 * - They belong to one disabled account without a username, which can't sign in and isn't listed on
 *   the admin's users screen.
 * - No audit records are written, because the audit log can never be cleaned up (HIS-3). So a
 *   load-test case's history is empty. No notifications, files or photos are made either.
 *
 * The planning, writing and removing here are shared with the demo data (scripts/seed-demo.ts), which
 * differs only in its `Cast` and in writing each case's history.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { CaseStatus, Category, Kind, NotificationType } from "../src/generated/prisma/enums";
import { addDays, colomboDay, colomboStartOf, dayToDate } from "../src/lib/dates";
import { INSTALLMENT_AMOUNT, INSTALLMENT_COUNT, RELEASE_AMOUNT } from "../src/lib/money";
import { NAMES, type Names } from "../src/lib/names";
import { nicKey } from "../src/lib/nic";
import { placeholderEmail } from "../src/server/auth/accounts";
import { applicationKey } from "../src/server/cases/numbers";
import { createPrismaClient } from "../src/server/db";
import { deleteStoredFile } from "../src/server/files/storage";
import { generator, GIVEN_NAMES, madeUpNic, madeUpPhone, type Random, ROADS, type Share, SURNAMES } from "./made-up";

/** Every load-test case's id starts with this. */
export const LOAD_ID_PREFIX = "load-";
/** The disabled account that owns every load-test case and took every step on it. */
export const LOAD_USER_ID = "load-test-account";

const DEFAULT_COUNT = 5_000;
/** The oldest case is made this many days ago. */
const MAX_AGE_DAYS = 720;
/** Share of the cases being built whose last update was 30 or more days ago (DSH-1, HOME-3). */
const STALE_SHARE = 0.25;
/** Share of the cases built in another DS office than the one they were entered by (CASE-13). */
const ELSEWHERE_SHARE = 0.03;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A notice older than this many days has been read. */
const UNREAD_DAYS = 7;
/** Rows per insert, well under PostgreSQL's limit on parameters in one statement. */
const CHUNK = 1_000;

/** Made-up cases are never added to, or removed from, a production database. */
export function loadDataAllowed(appEnv = process.env.APP_ENV ?? "development"): boolean {
  return ["development", "ci", "test", "staging"].includes(appEnv);
}

// --- Made-up text (the people are in made-up.ts) ---------------------------------------------------

const REMARKS = ["ඉඩම පවුලට අයත්ය.", "පවුලේ සාමාජිකයින් පස් දෙනෙකි.", "ළඟම පාසල කි.මී. දෙකක් දුරින්."];
const VISIT_NOTES = [
  "වැඩ හොඳින් සිදු වේ.",
  "ද්‍රව්‍ය ලැබීම ප්‍රමාදයි.",
  "අඩවිය පරීක්ෂා කළා.",
  "වැසි නිසා වැඩ නතර වී ඇත.",
];
const PURPOSES = ["ගොඩනැගිලි ද්‍රව්‍ය", "වහලය සඳහා", "කම්කරු ගාස්තු"];

// --- Shares ---------------------------------------------------------------------------------------

/** Where a made-up case is in its life: one of the five statuses (STS-1). */
export type Path = CaseStatus;

/** How the cases spread over the statuses, roughly as in a programme's second year. */
const STATUS_SHARES: Share<Path> = [
  ["AWAITING_ALLOCATION", 18],
  ["ALLOCATED_TO_DISTRICT", 6],
  ["ALLOCATION_RECEIVED", 8],
  ["IN_PROGRESS", 51],
  ["COMPLETED", 17],
];
/** Installments paid on a case still being built: at least the first (INS-5). */
const PAID_SHARES: Share<number> = [
  [1, 35],
  [2, 30],
  [3, 23],
  [4, 12],
];
/** Visits with only a note on a released case. */
const NOTE_SHARES: Share<number> = [
  [0, 50],
  [1, 35],
  [2, 15],
];

// --- Planning the cases -------------------------------------------------------------------------

/** A DS office that gets made-up cases. */
export type Office = { id: number; code: string; nameSi: string; districtId: number; districtSi: string };

/** The made-up person on a case (SEC-11). */
export type Person = {
  name: string;
  /** Only used for a child at risk. */
  childName: string | null;
  nic: string;
  address: string;
  gnDivision: string | null;
  mobile1: string;
  mobile2: string | null;
  remark: string | null;
};

/**
 * Who the made-up cases belong to and what they look like. The load-test data and the demo data
 * (scripts/seed-demo.ts) differ only here.
 */
export type Cast = {
  /** Every case's id starts with this, which is how they are removed again. */
  idPrefix: string;
  /**
   * The office's officers. The first of the DS of residence's enters a case, and the first of the DS where
   * it is built pays it and records its stages; each officer of either office gets its notices (NTF-1).
   */
  officers: (office: Office) => string[];
  /** Where a case entered by `office` is built: most often the same office (CASE-13). */
  buildOffice: (r: Random, office: Office) => Office;
  /** Who records the Ministry's letters. */
  ministry: (r: Random) => string;
  /** Who records the District's release to `office` (REL-6). */
  districtOfficer: (r: Random, office: Office) => string;
  /** The District officers told of each of the district's letters (NTF-1). */
  districtOfficers: (districtId: number) => string[];
  person: (r: Random, office: Office, category: Category) => Person;
  /** How many days ago a case on its way to `path` was entered; at least `minAge`. */
  age: (r: Random, path: Path, minAge: number) => number;
  /**
   * The day the Ministry's letter allocates a case entered on `enteredDay` and built in `office`: after it,
   * but never after `today` (REL-2).
   */
  releaseDay: (r: Random, enteredDay: string, office: Office, today: string) => string;
  /** The day the District releases it to `office`: on or after `letterDay`, never after `today` (REL-6). */
  dsReleaseDay: (r: Random, letterDay: string, office: Office, today: string) => string;
};

export type Context = {
  r: Random;
  now: Date;
  /** "YYYY-MM-DD" in Colombo */
  today: string;
  /** The active stages of each kind, in order (LST-4), with their Sinhala name and all three (UI-9). */
  stages: Record<Kind, { id: number; name: string; names: Names }[]>;
  cast: Cast;
};

type Json = Prisma.InputJsonValue | null;

/**
 * One step of a case's history, as the screens would have written it to the audit log (HIS-1). The
 * writer fills in what is known only then: the Application Number, the Ministry's letter, the District's
 * release.
 */
type Step = {
  at: Date;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, Json>;
  after: Record<string, Json>;
};

/** The District's release of a case to the DS where it is built (REL-6), before the release itself is known. */
type PlannedDsRelease = { day: string; byId: string; at: Date };

/**
 * A case's allocation before its letter and District release are known: the cases allocated on the same day
 * in a district share one letter, and the cases released on the same day to a DS office share one release.
 */
type PlannedRelease = Omit<Prisma.ReleaseCreateManyInput, "letterId" | "dsReleaseId"> & {
  districtId: number;
  day: string;
  ds: PlannedDsRelease | null;
};

/** A case before its Application Number is known; the writer gives it one. */
type PlannedCase = Omit<Prisma.CaseCreateManyInput, "applicationNumber" | "applicationKey">;

export type Planned = {
  /** The DS office of residence, which entered it. */
  office: Office;
  /** The DS office where it is built, which the money follows (CASE-13). */
  build: Office;
  case: PlannedCase;
  release: PlannedRelease | null;
  installments: Prisma.InstallmentCreateManyInput[];
  stageUpdates: Prisma.StageUpdateCreateManyInput[];
  history: Step[];
  /** The notices the steps send the office's officers (NTF-1); the older ones have been read. */
  notifications: Prisma.NotificationCreateManyInput[];
};

type Event = "pay" | "start" | "stage" | "note";

const latestDay = (a: string, b: string) => (a > b ? a : b);

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY);
}

/** Interleaves the chains at random, keeping each chain's own order. */
function interleave<T>(r: Random, chains: T[][]): T[] {
  const queues = chains.map((chain) => [...chain]);
  const out: T[] = [];
  for (let left = queues.reduce((sum, q) => sum + q.length, 0); left > 0; left--) {
    let roll = r.int(1, left);
    const queue = queues.find((q) => (roll -= q.length) <= 0);
    out.push(queue!.shift()!);
  }
  return out;
}

/**
 * One case and everything that hangs off it, with a story that follows the application spec's Case
 * statuses and transitions.
 */
export function planCase(ctx: Context, office: Office, path: Path): Planned {
  const { r, today, cast } = ctx;
  const upToToday = (day: string) => (day > today ? today : day);
  // A moment during office hours on `day`, after `after`, and never after now.
  const moment = (day: string, after: Date | null) => {
    let at = new Date(colomboStartOf(day).getTime() + r.int(510, 990) * MINUTE);
    if (after && at <= after) at = new Date(after.getTime() + r.int(5, 90) * MINUTE);
    return at > ctx.now ? ctx.now : at;
  };

  const id = `${cast.idPrefix}${randomUUID()}`;
  // CASE-13: the DS of residence enters it; the DS where it is built pays it and records its stages.
  const build = cast.buildOffice(r, office);
  const officer = cast.officers(office)[0]!;
  const builder = cast.officers(build)[0]!;
  const told = [...new Set([...cast.officers(office), ...cast.officers(build)])];
  const ministry = cast.ministry(r);
  const category: Category = r.chance(1 / 3) ? "CARE_LEAVER" : "CHILD_AT_RISK";
  const kind: Kind = r.chance(0.8) ? "NEW_HOUSE" : "RENOVATION";
  const person = cast.person(r, office, category);
  const nic = person.nic;
  const fields = {
    dsOfficeId: office.id,
    category,
    kind,
    name: person.name,
    childName: category === "CHILD_AT_RISK" ? person.childName : null,
    nic,
    address: person.address,
    gnDivision: person.gnDivision,
    mobile1: person.mobile1,
    mobile2: person.mobile2,
    remark: person.remark,
  };

  const allocated = path !== "AWAITING_ALLOCATION";
  const received = allocated && path !== "ALLOCATED_TO_DISTRICT";
  const minAge = path === "COMPLETED" ? 150 : path === "IN_PROGRESS" ? 45 : allocated ? 10 : 0;

  const createdDay = addDays(today, -cast.age(r, path, minAge));
  const createdAt = moment(createdDay, null);
  let last = createdAt;

  const history: Step[] = [];
  const notifications: Prisma.NotificationCreateManyInput[] = [];
  const record = (step: Omit<Step, "entityType" | "entityId"> & Partial<Step>, notice?: NotificationType) => {
    history.push({ entityType: "case", entityId: id, ...step });
    if (notice) {
      const read = ctx.now.getTime() - step.at.getTime() > UNREAD_DAYS * DAY;
      // NTF-1, CASE-13: the officers of both offices, each once.
      for (const userId of told) {
        notifications.push({
          id: randomUUID(),
          userId,
          caseId: id,
          type: notice,
          createdAt: step.at,
          readAt: read ? new Date(step.at.getTime() + 60 * MINUTE) : null,
        });
      }
    }
  };
  // A status change, as applyMove records it (src/server/cases/transitions.ts).
  const move = (
    at: Date,
    actorId: string | null,
    action: string,
    from: CaseStatus,
    to: CaseStatus,
    extra: Record<string, Json> = {},
  ) => ({ at, actorId, action, before: { status: from }, after: { status: to, ...extra } });

  record({
    at: createdAt,
    actorId: officer,
    action: "case_created",
    after: {
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)),
      buildDsOfficeId: build.id,
      status: "AWAITING_ALLOCATION",
      documentsAdded: [],
    },
  });

  let completedAt: Date | null = null;
  let release: PlannedRelease | null = null;
  const installments: Prisma.InstallmentCreateManyInput[] = [];
  const stageUpdates: Prisma.StageUpdateCreateManyInput[] = [];
  let moves = 0;
  let steps = 0;

  if (allocated) {
    // REL-2, REL-3: the Ministry's letter to the district where it is built, on or after the day it was
    // entered and never in the future. The writer adds the letter's details.
    const letterDay = cast.releaseDay(r, createdDay, build, today);
    const letterAt = (last = moment(letterDay, last));
    release = {
      id: randomUUID(),
      caseId: id,
      releasedOn: dayToDate(letterDay),
      dsReleasedOn: null,
      amount: RELEASE_AMOUNT,
      byId: ministry,
      at: letterAt,
      districtId: build.districtId,
      day: letterDay,
      ds: null,
    };
    moves += 1;
    record(
      move(letterAt, ministry, "case_allocated", "AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT", {
        amount: RELEASE_AMOUNT,
      }),
      "ALLOCATED",
    );
  }

  if (received && release) {
    // REL-6, REL-7: the District's release to the DS where it is built, on or after the letter's day. The
    // writer adds the release's details.
    const releasedDay = cast.dsReleaseDay(r, release.day, build, today);
    const releasedBy = cast.districtOfficer(r, build);
    const releaseAt = (last = moment(releasedDay, last));
    release.ds = { day: releasedDay, byId: releasedBy, at: releaseAt };
    release.dsReleasedOn = dayToDate(releasedDay);
    moves += 1;
    record(
      move(releaseAt, releasedBy, "case_ds_released", "ALLOCATED_TO_DISTRICT", "ALLOCATION_RECEIVED", {
        amount: RELEASE_AMOUNT,
      }),
      "RELEASED",
    );

    const stages = ctx.stages[kind];
    let paid: number;
    let reached: number;
    if (path === "COMPLETED") {
      paid = INSTALLMENT_COUNT;
      reached = stages.length;
    } else if (path === "ALLOCATION_RECEIVED") {
      // Nothing paid yet (INS-5); some have installment 1 on its way, and visits with notes.
      paid = 0;
      reached = 0;
    } else {
      paid = r.weighted(PAID_SHARES);
      reached = r.int(0, stages.length);
      // Both finished would have completed it (CLS-1).
      if (paid === INSTALLMENT_COUNT && reached === stages.length) {
        if (stages.length > 0) reached -= 1;
        else paid -= 1;
      }
    }
    const processing = path !== "COMPLETED" && paid < INSTALLMENT_COUNT && r.chance(0.5);

    // INS-2: each payment after the one before, and a payment starts only once the one before is paid.
    const events = interleave<Event>(r, [
      [...Array<Event>(paid).fill("pay"), ...(processing ? (["start"] as const) : [])],
      Array<Event>(reached).fill("stage"),
      Array<Event>(r.weighted(NOTE_SHARES)).fill("note"),
    ]);
    if (path === "COMPLETED") {
      // Nothing is recorded after completion (STG-5), so the visits come before the last step.
      const lastStep = events.findLastIndex((e) => e !== "note");
      events.splice(lastStep, 0, ...events.splice(lastStep + 1));
    }

    // STG-1, INS-3, INS-4: everything from the District's release to today.
    const lastDay =
      path === "COMPLETED"
        ? upToToday(addDays(releasedDay, r.int(90, 360)))
        : latestDay(releasedDay, addDays(today, -(r.chance(STALE_SHARE) ? r.int(30, 180) : r.int(0, 29))));
    const span = dayDiff(releasedDay, lastDay);
    const days = events.map(() => addDays(releasedDay, r.int(0, span))).sort();
    if (days.length > 0) days[days.length - 1] = lastDay;

    const payments: { day: string; at: Date }[] = [];
    let start: { day: string; at: Date } | null = null;
    let stagesReached = 0;
    let current: { id: number } | null = null;
    for (const [index, event] of events.entries()) {
      const day = days[index];
      last = moment(day, last);
      if (event === "pay") payments.push({ day, at: last });
      else if (event === "start") start = { day, at: last };
      else {
        const stage = event === "stage" ? stages[stagesReached++] : null;
        const note = event === "note" || r.chance(0.4) ? r.pick(VISIT_NOTES) : null;
        const update = {
          id: randomUUID(),
          caseId: id,
          stageId: stage?.id ?? null,
          visitedOn: dayToDate(day),
          note,
          byId: builder,
          at: last,
        };
        stageUpdates.push(update);
        // As src/server/stages/commands.ts records it.
        record({
          at: last,
          actorId: builder,
          action: "stage_updated",
          entityType: "stage_update",
          entityId: update.id,
          before: { stageId: current?.id ?? null },
          after: {
            stageIds: stage ? [stage.id] : [],
            stages: stage ? [stage.name] : [],
            stageNames: stage ? [stage.names] : [],
            visitedOn: day,
            note,
            photos: [],
          },
        });
        if (stage) current = stage;
      }
    }
    steps = events.length;

    // As src/server/installments/commands.ts records them.
    const recordStart = (at: Date, installmentId: string, number: number, expectedOn: string, purpose: Json) =>
      record({
        at,
        actorId: builder,
        action: "installment_started",
        entityType: "installment",
        entityId: installmentId,
        before: { number, status: "NOT_STARTED" },
        after: { number, status: "PROCESSING", expectedOn, purpose, note: null },
      });
    for (let number = 1; number <= INSTALLMENT_COUNT; number++) {
      const payment = payments[number - 1];
      const base = { id: randomUUID(), caseId: id, number, amount: INSTALLMENT_AMOUNT };
      const purpose = r.chance(0.3) ? r.pick(PURPOSES) : null;
      if (payment) {
        // Started a few days before it was paid, and after the one before was paid (INS-2).
        const after = number === 1 ? releaseAt : payments[number - 2].at;
        const startedAt = new Date(
          Math.max((after.getTime() + payment.at.getTime()) / 2, payment.at.getTime() - r.int(2, 14) * DAY),
        );
        // INS-3: expected on or after the District's release.
        const expectedOn = latestDay(colomboDay(startedAt), addDays(payment.day, -r.int(0, 7)));
        installments.push({
          ...base,
          status: "RELEASED",
          expectedOn: dayToDate(expectedOn),
          releasedOn: dayToDate(payment.day),
          purpose,
          updatedAt: payment.at,
        });
        recordStart(startedAt, base.id, number, expectedOn, purpose);
        record({
          at: payment.at,
          actorId: builder,
          action: "installment_paid",
          entityType: "installment",
          entityId: base.id,
          before: { number, status: "PROCESSING", note: null },
          after: { number, status: "RELEASED", releasedOn: payment.day, note: null },
        });
        if (number === 1) {
          // INS-5: paying installment 1 moves the case on, as the system, in the same step.
          moves += 1;
          record(move(payment.at, null, "case_started", "ALLOCATION_RECEIVED", "IN_PROGRESS"));
        }
      } else if (start && number === paid + 1) {
        // Some have passed already, so the to-do panel has overdue payments (HOME-3).
        const expectedOn = addDays(start.day, r.int(3, 45));
        installments.push({
          ...base,
          status: "PROCESSING",
          expectedOn: dayToDate(expectedOn),
          purpose,
          updatedAt: start.at,
        });
        recordStart(start.at, base.id, number, expectedOn, purpose);
      } else {
        installments.push({ ...base, status: "NOT_STARTED", updatedAt: releaseAt });
      }
    }
    if (path === "COMPLETED") {
      completedAt = last;
      moves += 1;
      // The system finishes it in the same step (CLS-1), so the history names no one.
      record(move(last, null, "case_completed", "IN_PROGRESS", "COMPLETED"), "COMPLETED");
    }
  }

  return {
    office,
    build,
    case: {
      id,
      ...fields,
      // The 12-digit form, so old and new numbers match (CASE-6).
      nicKey: nicKey(nic),
      buildDsOfficeId: build.id,
      status: path,
      createdById: officer,
      createdAt,
      updatedAt: last,
      completedAt,
      version: 1 + moves + steps,
    },
    release,
    installments,
    stageUpdates,
    history,
    notifications,
  };
}

// --- Reading, writing and removing --------------------------------------------------------------

/** The active DS offices that match `where`, with their district's name. */
export async function readOffices(db: PrismaClient, where: Prisma.DsOfficeWhereInput = {}): Promise<Office[]> {
  const rows = await db.dsOffice.findMany({
    where: { active: true, ...where },
    orderBy: { id: "asc" },
    select: { id: true, code: true, nameSi: true, districtId: true, district: { select: { nameSi: true } } },
  });
  return rows.map(({ district, ...office }) => ({ ...office, districtSi: district.nameSi }));
}

/** The active stages of each kind, in order (LST-4). */
export async function readStages(db: PrismaClient): Promise<Context["stages"]> {
  const stages: Context["stages"] = { NEW_HOUSE: [], RENOVATION: [] };
  for (const stage of await db.stageDefinition.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, ...NAMES, kind: true },
  })) {
    const { id, kind, ...names } = stage;
    stages[kind].push({ id, name: names.nameSi, names });
  }
  return stages;
}

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

export type WriteOptions = {
  /** Their allocation letters' and District releases' ids start with this too. */
  idPrefix: string;
  /** Also write each case's history to the audit log, and its notices. The load-test data writes neither. */
  history: boolean;
  /** The District officers told of each of a district's letters (NTF-1), with the history. */
  districtOfficers?: (districtId: number) => string[];
  /** Runs first, in the same transaction. */
  prepare?: (tx: Prisma.TransactionClient) => Promise<void>;
};

/** The made-up Application Numbers, in a form a paper application might carry (CASE-12): `HMG/147`. */
export function madeUpApplicationNumber(officeCode: string, sequence: number): string {
  return `${officeCode}/${sequence}`;
}

/**
 * Writes the planned cases in one transaction, with their Application Numbers, the Ministry's allocation
 * letters (as `recordLetter` makes them) and the Districts' releases (as `recordDsRelease` makes them,
 * src/server/releases/commands.ts).
 */
export async function writePlanned(
  db: PrismaClient,
  r: Random,
  planned: Planned[],
  { idPrefix, history, districtOfficers, prepare }: WriteOptions,
): Promise<void> {
  // REL-2: one allocation letter for the cases of a district allocated on the same day. REL-6: one District
  // release for the cases released to a DS office on the same day.
  const letters = new Map<string, Prisma.ReleaseLetterCreateManyInput>();
  const onLetter = new Map<string, Planned[]>();
  const dsReleases = new Map<string, Prisma.DsReleaseCreateManyInput>();
  const onDsRelease = new Map<string, Planned[]>();
  const releases: Prisma.ReleaseCreateManyInput[] = [];
  for (const p of planned) {
    if (!p.release) continue;
    const { districtId, day, ds, ...row } = p.release;
    const key = `${districtId}:${day}`;
    let letter = letters.get(key);
    if (!letter) {
      letter = {
        id: `${idPrefix}${randomUUID()}`,
        districtId,
        letterNumber: `LT/${day.slice(0, 4)}/${r.int(10_000, 99_999)}`,
        letterDate: dayToDate(day),
        validUntil: dayToDate(`${day.slice(0, 4)}-12-31`),
        byId: row.byId,
        at: row.at,
      };
      letters.set(key, letter);
      onLetter.set(key, []);
    }
    onLetter.get(key)!.push(p);
    let dsRelease: Prisma.DsReleaseCreateManyInput | undefined;
    if (ds) {
      const dsKey = `${p.build.id}:${ds.day}`;
      dsRelease = dsReleases.get(dsKey);
      if (!dsRelease) {
        dsRelease = {
          id: `${idPrefix}${randomUUID()}`,
          districtId: p.build.districtId,
          dsOfficeId: p.build.id,
          referenceNumber: `DS/${p.build.code}/${ds.day.slice(0, 4)}/${r.int(100, 999)}`,
          releasedOn: dayToDate(ds.day),
          byId: ds.byId,
          at: ds.at,
        };
        dsReleases.set(dsKey, dsRelease);
        onDsRelease.set(dsKey, []);
      }
      onDsRelease.get(dsKey)!.push(p);
    }
    releases.push({ ...row, letterId: letter.id, dsReleaseId: dsRelease?.id ?? null });
  }

  // Each case's history names its letter and its District release, as the commands write them.
  const districtLetters: Prisma.NotificationCreateManyInput[] = [];
  for (const [key, cases] of onLetter) {
    const letter = letters.get(key)!;
    for (const p of cases) {
      Object.assign(p.history.find((s) => s.action === "case_allocated")!.after, {
        letterId: letter.id,
        letterNumber: letter.letterNumber,
        letterDate: p.release!.day,
        validUntil: `${p.release!.day.slice(0, 4)}-12-31`,
        district: p.build.districtSi,
        cases: cases.length,
      });
    }
    // NTF-1: each District officer of the district hears of the letter once, on its first case.
    const at = new Date(letter.at!);
    const read = Date.now() - at.getTime() > UNREAD_DAYS * DAY;
    const first = cases.map((p) => p.case.id).sort()[0];
    for (const userId of districtOfficers?.(letter.districtId) ?? []) {
      districtLetters.push({
        id: randomUUID(),
        userId,
        caseId: first,
        type: "DISTRICT_LETTER",
        createdAt: at,
        readAt: read ? new Date(at.getTime() + 60 * MINUTE) : null,
      });
    }
  }
  for (const [key, cases] of onDsRelease) {
    const dsRelease = dsReleases.get(key)!;
    for (const p of cases) {
      Object.assign(p.history.find((s) => s.action === "case_ds_released")!.after, {
        dsReleaseId: dsRelease.id,
        referenceNumber: dsRelease.referenceNumber,
        releasedOn: p.release!.ds!.day,
        office: p.build.nameSi,
        district: p.build.districtSi,
        cases: cases.length,
      });
    }
  }

  // CASE-12: numbers in the order of entering, within each DS office of residence.
  const groups = new Map<number, { office: Office; cases: PlannedCase[] }>();
  for (const { office, case: c } of planned) {
    const group = groups.get(office.id) ?? { office, cases: [] };
    group.cases.push(c);
    groups.set(office.id, group);
  }

  await db.$transaction(
    async (tx) => {
      await prepare?.(tx);
      const cases: Prisma.CaseCreateManyInput[] = [];
      for (const { office, cases: group } of groups.values()) {
        group.sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
        // After the highest number of this form the office already has, so none is taken twice (CASE-12).
        const prefix = madeUpApplicationNumber(office.code, 0).slice(0, -1);
        const taken = await tx.case.findMany({
          where: { dsOfficeId: office.id, applicationNumber: { startsWith: prefix } },
          select: { applicationNumber: true },
        });
        const highest = Math.max(0, ...taken.map((c) => Number(c.applicationNumber.slice(prefix.length)) || 0));
        group.forEach((c, index) => {
          const applicationNumber = madeUpApplicationNumber(office.code, highest + index + 1);
          cases.push({ ...c, applicationNumber, applicationKey: applicationKey(applicationNumber) });
        });
      }
      for (const rows of chunks(cases)) await tx.case.createMany({ data: rows });
      for (const rows of chunks([...letters.values()])) await tx.releaseLetter.createMany({ data: rows });
      for (const rows of chunks([...dsReleases.values()])) await tx.dsRelease.createMany({ data: rows });
      for (const rows of chunks(releases)) await tx.release.createMany({ data: rows });
      for (const rows of chunks(planned.flatMap((p) => p.installments)))
        await tx.installment.createMany({ data: rows });
      for (const rows of chunks(planned.flatMap((p) => p.stageUpdates)))
        await tx.stageUpdate.createMany({ data: rows });

      if (!history) return;
      // CASE-12: a case is entered with its Application Number, as saveCase logs it.
      const numbers = new Map(cases.map((c) => [c.id, c.applicationNumber]));
      // In the order things happened, so steps at the same moment keep their order in the history.
      const audit = planned
        .flatMap((p) =>
          p.history.map((step) => {
            if (step.action === "case_created") step.after.applicationNumber = numbers.get(p.case.id) ?? null;
            return { ...step, caseId: p.case.id };
          }),
        )
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      for (const rows of chunks(audit)) await tx.auditLog.createMany({ data: rows });
      for (const rows of chunks([...planned.flatMap((p) => p.notifications), ...districtLetters]))
        await tx.notification.createMany({ data: rows });
    },
    { maxWait: 10_000, timeout: 10 * 60_000 },
  );
  // Until autoanalyze notices the new rows, the planner may still think the tables are as small as
  // before, and its plans make the dashboard about 20 times slower. Refresh the statistics now. With no
  // table named, ANALYZE covers the whole database, so it also reaches the database tests' own schema.
  await db.$executeRawUnsafe("ANALYZE");
}

/**
 * Removes every case whose id starts with `idPrefix`, with everything that hangs off it, including
 * anything people added to one while trying the system, and the letters and District releases left with
 * no case. Audit records stay, because the audit log can never be cleaned up (HIS-3). Returns how many
 * cases were removed.
 */
export async function removeMadeUp(
  db: PrismaClient,
  idPrefix: string,
  finish?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<number> {
  const theirs = { caseId: { startsWith: idPrefix } };
  const files = await db.storedFile.findMany({ where: theirs, select: { storedName: true, thumbName: true } });
  const letterScans: { storedName: string; thumbName: string | null }[] = [];

  const removed = await db.$transaction(
    async (tx) => {
      await tx.storedFile.deleteMany({ where: theirs });
      await tx.notification.deleteMany({ where: theirs });
      await tx.installment.deleteMany({ where: theirs });
      await tx.release.deleteMany({ where: theirs });
      // Their letters and District releases, and any someone recorded only for these cases, with its scan.
      const emptyLetter: Prisma.StoredFileWhereInput = {
        OR: [{ letter: { releases: { none: {} } } }, { dsRelease: { releases: { none: {} } } }],
      };
      letterScans.push(
        ...(await tx.storedFile.findMany({ where: emptyLetter, select: { storedName: true, thumbName: true } })),
      );
      await tx.storedFile.deleteMany({ where: emptyLetter });
      await tx.releaseLetter.deleteMany({ where: { releases: { none: {} } } });
      await tx.dsRelease.deleteMany({ where: { releases: { none: {} } } });
      await tx.stageUpdate.deleteMany({ where: theirs });
      await tx.decision.deleteMany({ where: theirs });
      const cases = await tx.case.deleteMany({ where: { id: { startsWith: idPrefix } } });
      await finish?.(tx);
      return cases.count;
    },
    { maxWait: 10_000, timeout: 10 * 60_000 },
  );

  for (const name of [...files, ...letterScans].flatMap((f) => [f.storedName, f.thumbName]))
    if (name) await deleteStoredFile(name);
  return removed;
}

// --- The load-test data -------------------------------------------------------------------------

/**
 * Where a case entered by `office` is built (CASE-13): most often the same office; otherwise another office
 * of its district, or now and then of another district.
 */
export function buildOfficeAmong(offices: Office[], share: number): Cast["buildOffice"] {
  return (r, office) => {
    if (!r.chance(share)) return office;
    const others = offices.filter((o) => o.id !== office.id);
    const near = others.filter((o) => o.districtId === office.districtId);
    const choices = near.length > 0 && r.chance(0.7) ? near : others;
    return choices.length > 0 ? r.pick(choices) : office;
  };
}

/** The load-test data, among these offices: one disabled account takes every step. */
const loadCast = (offices: Office[]): Cast => ({
  idPrefix: LOAD_ID_PREFIX,
  officers: () => [LOAD_USER_ID],
  buildOffice: buildOfficeAmong(offices, ELSEWHERE_SHARE),
  ministry: () => LOAD_USER_ID,
  districtOfficer: () => LOAD_USER_ID,
  districtOfficers: () => [],
  person: (r, office, category) => {
    const surname = r.pick(SURNAMES);
    return {
      name: `${r.pick(GIVEN_NAMES)} ${surname}`,
      childName: category === "CHILD_AT_RISK" ? `${r.pick(GIVEN_NAMES)} ${surname}` : null,
      nic: madeUpNic(r),
      address: `${r.int(1, 250)}, ${r.pick(ROADS)}, ${office.nameSi}`,
      gnDivision: null,
      mobile1: madeUpPhone(r),
      mobile2: r.chance(0.3) ? madeUpPhone(r) : null,
      remark: r.chance(0.1) ? r.pick(REMARKS) : null,
    };
  },
  // A case still at the district was allocated in the last few months.
  age: (r, path, minAge) => r.int(minAge, path === "ALLOCATED_TO_DISTRICT" ? 120 : MAX_AGE_DAYS),
  releaseDay: (r, enteredDay, _office, today) => {
    const day = addDays(enteredDay, r.int(1, 30));
    return day > today ? today : day;
  },
  dsReleaseDay: (r, letterDay, _office, today) => {
    const day = addDays(letterDay, r.int(0, 21));
    return day > today ? today : day;
  },
});

export type LoadOptions = {
  /** How many cases to add; 5,000 when left out. */
  count?: number;
  /** The same seed gives the same cases. */
  seed?: number;
  now?: Date;
};

/** Adds made-up cases, spread over every active DS office. Returns how many offices they went to. */
export async function addLoadData(db: PrismaClient, options: LoadOptions = {}): Promise<{ offices: number }> {
  if (!loadDataAllowed()) throw new Error(`Load-test data is not allowed when APP_ENV is "${process.env.APP_ENV}".`);
  const count = options.count ?? DEFAULT_COUNT;
  if (!Number.isSafeInteger(count) || count < 1) throw new Error(`Not a number of cases: ${count}`);
  const now = options.now ?? new Date();
  const r = generator(options.seed ?? 1);

  const offices = await readOffices(db);
  if (offices.length === 0) throw new Error("There are no active DS offices: run the seed first.");
  const ctx: Context = { r, now, today: colomboDay(now), stages: await readStages(db), cast: loadCast(offices) };
  // Every office gets at least one case, then the rest go to offices of different sizes.
  const officeShares: Share<Office> = offices.map((office) => [office, r.int(5, 15)]);
  const planned = Array.from({ length: count }, (_, index) =>
    planCase(ctx, index < offices.length ? offices[index] : r.weighted(officeShares), r.weighted(STATUS_SHARES)),
  );

  await writePlanned(db, r, planned, {
    idPrefix: LOAD_ID_PREFIX,
    history: false,
    prepare: async (tx) => {
      await tx.user.upsert({
        where: { id: LOAD_USER_ID },
        update: {},
        create: {
          id: LOAD_USER_ID,
          name: "බර පරීක්ෂණ දත්ත",
          email: placeholderEmail(LOAD_USER_ID),
          role: "MINISTRY_OFFICER",
          designation: "MINISTRY_PROGRAMME_OFFICER",
          banned: true,
          banReason: "load-test data",
        },
      });
    },
  });
  return { offices: new Set(planned.map((p) => p.case.dsOfficeId)).size };
}

/**
 * Removes every load-test case with everything that hangs off it (see `removeMadeUp`), and the
 * load-test account. Returns how many cases were removed.
 */
export async function removeLoadData(db: PrismaClient): Promise<number> {
  if (!loadDataAllowed()) throw new Error(`Load-test data is not allowed when APP_ENV is "${process.env.APP_ENV}".`);
  return removeMadeUp(db, LOAD_ID_PREFIX, async (tx) => {
    await tx.user.deleteMany({ where: { id: LOAD_USER_ID } });
  });
}

// Run directly: npx tsx scripts/seed-load.ts [--count N] [--seed N] [--remove]
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
      console.log(`Removed ${await removeLoadData(prisma)} load-test cases.`);
      return;
    }
    const count = Number(option("--count") ?? DEFAULT_COUNT);
    const seed = Number(option("--seed") ?? 1);
    const started = Date.now();
    const { offices } = await addLoadData(prisma, { count, seed });
    console.log(`Added ${count} load-test cases in ${offices} DS offices (${Date.now() - started} ms).`);
  };
  run()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
