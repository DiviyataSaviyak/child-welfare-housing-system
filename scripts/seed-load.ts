/**
 * Made-up cases for load tests (PRF-1, PRF-3, PRF-4): 5,000 by default, spread over every active DS
 * office, at every point of a case's life. There are drafts, cases waiting for a check or a release,
 * cases being built with their installments and stages (some with no update for 30 days or more),
 * and completed, rejected and stopped cases.
 *
 *   npm run db:seed-load                   adds 5,000 cases
 *   npm run db:seed-load -- --count 500    adds 500
 *   npm run db:seed-load -- --seed 7       adds a different set; the same seed gives the same cases
 *   npm run db:seed-load -- --remove       removes every load-test case again
 *
 * Every name, NIC and phone number is made up (SEC-11). It runs on development, test and staging
 * databases only, never in production.
 * - The cases' ids start with "load-", which is how --remove finds them. They take their case numbers
 *   from each office's counter, as real submits do; --remove gives back the numbers no other case holds.
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
import type { CaseStatus, Category, DecisionType, Kind, NotificationType } from "../src/generated/prisma/enums";
import { addDays, colomboDay, colomboStartOf, colomboYear, dayToDate } from "../src/lib/dates";
import { INSTALLMENT_AMOUNT, INSTALLMENT_COUNT, RELEASE_AMOUNT } from "../src/lib/money";
import { NAMES, type Names } from "../src/lib/names";
import { nicKey } from "../src/lib/nic";
import { placeholderEmail } from "../src/server/auth/accounts";
import { formatCaseNumber } from "../src/server/cases/numbers";
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
const SEND_BACK_REASONS = [
  "ලිපිනය සම්පූර්ණ නැත. කරුණාකර නිවැරදි කර නැවත යොමු කරන්න.",
  "ජා.හැ.අංකය පරීක්ෂා කර නැවත යොමු කරන්න.",
  "දුරකථන අංකය වැරදියි.",
];
const REJECT_REASONS = ["මෙම පවුලට දැනටමත් නිවාස ආධාර ලැබී ඇත.", "වැඩසටහනේ සුදුසුකම් සපුරා නැත."];
const STOP_REASONS = ["ප්‍රතිලාභියා වෙනත් ප්‍රදේශයකට පදිංචියට ගොස් ඇත.", "ඉඩමේ අයිතිය පිළිබඳ ගැටලුවක් ඇත."];
const VISIT_NOTES = [
  "වැඩ හොඳින් සිදු වේ.",
  "ද්‍රව්‍ය ලැබීම ප්‍රමාදයි.",
  "අඩවිය පරීක්ෂා කළා.",
  "වැසි නිසා වැඩ නතර වී ඇත.",
];
const PURPOSES = ["ගොඩනැගිලි ද්‍රව්‍ය", "වහලය සඳහා", "කම්කරු ගාස්තු"];

// --- Shares ---------------------------------------------------------------------------------------

/** How the cases spread over the statuses, roughly as in a programme's second year. */
const STATUS_SHARES: Share<CaseStatus> = [
  ["DRAFT", 3],
  ["SUBMITTED", 8],
  ["RETURNED", 3],
  ["VERIFIED", 6],
  ["IN_PROGRESS", 55],
  ["COMPLETED", 18],
  ["REJECTED", 3],
  ["STOPPED", 4],
];
/** Installments paid on a case still being built. */
const PAID_SHARES: Share<number> = [
  [0, 15],
  [1, 30],
  [2, 25],
  [3, 20],
  [4, 10],
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

/** The made-up person on a case (SEC-11). A draft may lose some of these (CASE-4). */
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
   * The office's officers: the first enters a case and takes the DS office's steps on it, and each one
   * gets its notices (NTF-1).
   */
  officers: (office: Office) => string[];
  /** Who takes Head Office's steps on a case: checking, releasing and stopping. */
  headOffice: (r: Random) => string;
  person: (r: Random, office: Office, category: Category | null) => Person;
  /** How many days ago a case on its way to `path` was entered; at least `minAge`. */
  age: (r: Random, path: CaseStatus, minAge: number) => number;
  /** The day a case verified on `verifiedDay` is released: after it, but never after `today` (REL-2). */
  releaseDay: (r: Random, verifiedDay: string, office: Office, today: string) => string;
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
 * writer fills in what is known only then: the case number of a submit, the letter of a release.
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

/** A release before its allocation letter is known: the cases released on the same day in a district share one. */
type PlannedRelease = Omit<Prisma.ReleaseCreateManyInput, "letterId"> & { districtId: number; day: string };

export type Planned = {
  office: Office;
  case: Prisma.CaseCreateManyInput;
  decisions: Prisma.DecisionCreateManyInput[];
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

/** One case and everything that hangs off it, with a story that follows the rules of SPEC section 6. */
export function planCase(ctx: Context, office: Office, status: CaseStatus): Planned {
  const { r, today, cast } = ctx;
  const upToToday = (day: string) => (day > today ? today : day);
  // A moment during office hours on `day`, after `after`, and never after now.
  const moment = (day: string, after: Date | null) => {
    let at = new Date(colomboStartOf(day).getTime() + r.int(510, 990) * MINUTE);
    if (after && at <= after) at = new Date(after.getTime() + r.int(5, 90) * MINUTE);
    return at > ctx.now ? ctx.now : at;
  };

  const id = `${cast.idPrefix}${randomUUID()}`;
  const officers = cast.officers(office);
  const officer = officers[0]!;
  const headOffice = cast.headOffice(r);
  const draft = status === "DRAFT";
  // A draft may still have empty fields (CASE-4).
  const maybe = <T>(value: T) => (draft && r.chance(0.2) ? null : value);
  const category = maybe<Category>(r.chance(1 / 3) ? "CARE_LEAVER" : "CHILD_AT_RISK");
  const kind: Kind = r.chance(0.8) ? "NEW_HOUSE" : "RENOVATION";
  const person = cast.person(r, office, category);
  const nic = maybe(person.nic);
  const fields = {
    dsOfficeId: office.id,
    category,
    kind: maybe(kind),
    name: person.name,
    childName: category === "CHILD_AT_RISK" ? person.childName : null,
    nic,
    address: maybe(person.address),
    gnDivision: person.gnDivision,
    mobile1: maybe(person.mobile1),
    mobile2: person.mobile2,
    remark: person.remark,
  };

  // A stopped case was verified or being built when it stopped (CLS-3).
  const stoppedFrom: CaseStatus | null = status === "STOPPED" ? (r.chance(0.6) ? "IN_PROGRESS" : "VERIFIED") : null;
  const path = stoppedFrom ?? status;
  const released = path === "IN_PROGRESS" || path === "COMPLETED";
  const minAge = path === "COMPLETED" ? 150 : released ? 45 : path === "VERIFIED" ? 10 : 0;

  const createdDay = addDays(today, -cast.age(r, path, minAge));
  const createdAt = moment(createdDay, null);
  let last = createdAt;

  const history: Step[] = [];
  const notifications: Prisma.NotificationCreateManyInput[] = [];
  const record = (step: Omit<Step, "entityType" | "entityId"> & Partial<Step>, notice?: NotificationType) => {
    history.push({ entityType: "case", entityId: id, ...step });
    if (notice) {
      const read = ctx.now.getTime() - step.at.getTime() > UNREAD_DAYS * DAY;
      for (const userId of officers) {
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

  const decisions: Prisma.DecisionCreateManyInput[] = [];
  const decide = (type: DecisionType, at: Date, reason: string | null = null) =>
    decisions.push({ id: randomUUID(), caseId: id, type, reason, byId: type === "SUBMIT" ? officer : headOffice, at });

  record({
    at: createdAt,
    actorId: officer,
    action: "case_created",
    after: { ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)), documentsAdded: [] },
  });

  let submittedAt: Date | null = null;
  let verifiedAt: Date | null = null;
  let completedAt: Date | null = null;
  let release: PlannedRelease | null = null;
  const installments: Prisma.InstallmentCreateManyInput[] = [];
  const stageUpdates: Prisma.StageUpdateCreateManyInput[] = [];
  let steps = 0;

  if (draft) {
    last = moment(upToToday(addDays(createdDay, r.int(0, 10))), createdAt);
  } else {
    const submittedDay = upToToday(addDays(createdDay, r.int(0, 7)));
    submittedAt = last = moment(submittedDay, last);
    decide("SUBMIT", submittedAt);
    record(move(submittedAt, officer, "case_submitted", "DRAFT", "SUBMITTED"));

    if (path === "RETURNED" || path === "REJECTED") {
      last = moment(upToToday(addDays(submittedDay, r.int(1, 20))), last);
      if (path === "RETURNED") {
        const reason = r.pick(SEND_BACK_REASONS);
        decide("SEND_BACK", last, reason);
        record(move(last, headOffice, "case_sent_back", "SUBMITTED", "RETURNED", { reason }), "SENT_BACK");
      } else {
        const reason = r.pick(REJECT_REASONS);
        decide("REJECT", last, reason);
        record(move(last, headOffice, "case_rejected", "SUBMITTED", "REJECTED", { reason }), "REJECTED");
      }
    }

    if (path === "VERIFIED" || released) {
      const verifiedDay = upToToday(addDays(submittedDay, r.int(2, 30)));
      verifiedAt = last = moment(verifiedDay, last);
      decide("VERIFY", verifiedAt);
      record(move(verifiedAt, headOffice, "case_verified", "SUBMITTED", "VERIFIED"), "VERIFIED");

      if (released) {
        // REL-2: on or after the verification day, never in the future.
        const releasedDay = cast.releaseDay(r, verifiedDay, office, today);
        const releaseAt = (last = moment(releasedDay, last));
        release = {
          id: randomUUID(),
          caseId: id,
          releasedOn: dayToDate(releasedDay),
          amount: RELEASE_AMOUNT,
          byId: headOffice,
          at: releaseAt,
          districtId: office.districtId,
          day: releasedDay,
        };
        // The writer adds the allocation letter's details.
        record(
          move(releaseAt, headOffice, "case_released", "VERIFIED", "IN_PROGRESS", { amount: RELEASE_AMOUNT }),
          "RELEASED",
        );

        const stages = ctx.stages[kind];
        let paid: number;
        let reached: number;
        if (path === "COMPLETED") {
          paid = INSTALLMENT_COUNT;
          reached = stages.length;
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

        const lastDay =
          path === "COMPLETED"
            ? upToToday(addDays(releasedDay, r.int(90, 360)))
            : stoppedFrom
              ? upToToday(addDays(releasedDay, r.int(0, 200)))
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
              byId: officer,
              at: last,
            };
            stageUpdates.push(update);
            // As src/server/stages/commands.ts records it.
            record({
              at: last,
              actorId: officer,
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
            actorId: officer,
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
            // INS-3: expected on or after the release.
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
              actorId: officer,
              action: "installment_paid",
              entityType: "installment",
              entityId: base.id,
              before: { number, status: "PROCESSING", note: null },
              after: { number, status: "RELEASED", releasedOn: payment.day, note: null },
            });
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
          // The system finishes it in the same step (CLS-1), so the history names no one.
          record(move(last, null, "case_completed", "IN_PROGRESS", "COMPLETED"), "COMPLETED");
        }
      }
    }

    if (stoppedFrom) {
      last = moment(upToToday(addDays(colomboDay(last), r.int(1, 60))), last);
      const reason = r.pick(STOP_REASONS);
      decide("STOP", last, reason);
      record(move(last, headOffice, "case_stopped", stoppedFrom, "STOPPED", { reason }), "STOPPED");
    }
  }

  return {
    office,
    case: {
      id,
      ...fields,
      // The 12-digit form, so old and new numbers match (CASE-6).
      nicKey: nic && nicKey(nic),
      status,
      createdById: officer,
      createdAt,
      updatedAt: last,
      submittedAt,
      verifiedAt,
      completedAt,
      statusBeforeStop: stoppedFrom,
      version: 1 + decisions.length + steps,
    },
    decisions,
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
  /** Their allocation letters' ids start with this too. */
  idPrefix: string;
  /** Also write each case's history to the audit log, and its notices. The load-test data writes neither. */
  history: boolean;
  /** Runs first, in the same transaction. */
  prepare?: (tx: Prisma.TransactionClient) => Promise<void>;
};

/** Writes the planned cases in one transaction, with their case numbers and allocation letters. */
export async function writePlanned(
  db: PrismaClient,
  r: Random,
  planned: Planned[],
  { idPrefix, history, prepare }: WriteOptions,
): Promise<void> {
  // REL-2: one allocation letter for the cases of a district released on the same day.
  const letters = new Map<string, Prisma.ReleaseLetterCreateManyInput>();
  const onLetter = new Map<string, Planned[]>();
  const releases: Prisma.ReleaseCreateManyInput[] = [];
  for (const p of planned) {
    if (!p.release) continue;
    const { districtId, day, ...row } = p.release;
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
    releases.push({ ...row, letterId: letter.id });
  }
  // The release's history names its letter, as recordLetter writes it (src/server/releases/commands.ts).
  for (const [key, cases] of onLetter) {
    const letter = letters.get(key)!;
    for (const p of cases) {
      const step = p.history.find((s) => s.action === "case_released")!;
      Object.assign(step.after, {
        letterId: letter.id,
        letterNumber: letter.letterNumber,
        letterDate: p.release!.day,
        validUntil: `${p.release!.day.slice(0, 4)}-12-31`,
        district: p.office.districtSi,
        cases: cases.length,
      });
    }
  }

  // CASE-5: numbers in the order of submitting, within each office and year.
  const groups = new Map<string, { office: Office; year: number; cases: Prisma.CaseCreateManyInput[] }>();
  for (const { office, case: c } of planned) {
    if (!c.submittedAt) continue;
    const year = colomboYear(new Date(c.submittedAt));
    const key = `${office.id}:${year}`;
    const group = groups.get(key) ?? { office, year, cases: [] };
    group.cases.push(c);
    groups.set(key, group);
  }

  await db.$transaction(
    async (tx) => {
      await prepare?.(tx);
      for (const { office, year, cases } of groups.values()) {
        cases.sort((a, b) => new Date(a.submittedAt!).getTime() - new Date(b.submittedAt!).getTime());
        // Takes a block of numbers in one statement, so a real submit at the same moment can't take one of them.
        const counter = await tx.caseNumberCounter.upsert({
          where: { dsOfficeId_year: { dsOfficeId: office.id, year } },
          create: { dsOfficeId: office.id, year, last: cases.length },
          update: { last: { increment: cases.length } },
          select: { last: true },
        });
        const first = counter.last - cases.length + 1;
        cases.forEach((c, index) => (c.caseNumber = formatCaseNumber(office.code, year, first + index)));
      }
      for (const rows of chunks(planned.map((p) => p.case))) await tx.case.createMany({ data: rows });
      for (const rows of chunks(planned.flatMap((p) => p.decisions))) await tx.decision.createMany({ data: rows });
      for (const rows of chunks([...letters.values()])) await tx.releaseLetter.createMany({ data: rows });
      for (const rows of chunks(releases)) await tx.release.createMany({ data: rows });
      for (const rows of chunks(planned.flatMap((p) => p.installments)))
        await tx.installment.createMany({ data: rows });
      for (const rows of chunks(planned.flatMap((p) => p.stageUpdates)))
        await tx.stageUpdate.createMany({ data: rows });

      if (!history) return;
      // In the order things happened, so steps at the same moment keep their order in the history.
      const audit = planned
        .flatMap((p) =>
          p.history.map((step) => {
            if (step.action === "case_submitted") step.after.caseNumber = p.case.caseNumber ?? null;
            return { ...step, caseId: p.case.id };
          }),
        )
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      for (const rows of chunks(audit)) await tx.auditLog.createMany({ data: rows });
      for (const rows of chunks(planned.flatMap((p) => p.notifications)))
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
 * anything people added to one while trying the system. Each case-number counter the cases took
 * numbers from goes back to where it stood before them, unless a later case holds a higher number.
 * Audit records stay, because the audit log can never be cleaned up (HIS-3). Returns how many cases
 * were removed.
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
      // The counters the cases took numbers from, with the lowest number each one gave them.
      const used = new Map<string, { dsOfficeId: number; year: number; prefix: string; lowest: number }>();
      for (const { dsOfficeId, caseNumber } of await tx.case.findMany({
        where: { id: { startsWith: idPrefix }, caseNumber: { not: null } },
        select: { dsOfficeId: true, caseNumber: true },
      })) {
        const prefix = caseNumber!.slice(0, caseNumber!.lastIndexOf("-") + 1);
        const year = Number(prefix.slice(-5, -1));
        const sequence = Number(caseNumber!.slice(prefix.length));
        const key = `${dsOfficeId}:${year}`;
        if (sequence < (used.get(key)?.lowest ?? Infinity))
          used.set(key, { dsOfficeId, year, prefix, lowest: sequence });
      }

      await tx.storedFile.deleteMany({ where: theirs });
      await tx.notification.deleteMany({ where: theirs });
      await tx.installment.deleteMany({ where: theirs });
      await tx.release.deleteMany({ where: theirs });
      // Their letters, and any letter someone recorded only for these cases, with its scan.
      const emptyLetter = { letter: { releases: { none: {} } } };
      letterScans.push(
        ...(await tx.storedFile.findMany({ where: emptyLetter, select: { storedName: true, thumbName: true } })),
      );
      await tx.storedFile.deleteMany({ where: emptyLetter });
      await tx.releaseLetter.deleteMany({ where: { releases: { none: {} } } });
      await tx.stageUpdate.deleteMany({ where: theirs });
      await tx.decision.deleteMany({ where: theirs });
      const cases = await tx.case.deleteMany({ where: { id: { startsWith: idPrefix } } });

      for (const { dsOfficeId, year, prefix, lowest } of used.values()) {
        const left = await tx.case.findMany({
          where: { dsOfficeId, caseNumber: { startsWith: prefix } },
          select: { caseNumber: true },
        });
        // Numbers below theirs were real ones, so they are never given out again (CASE-5).
        const last = Math.max(lowest - 1, ...left.map((c) => Number(c.caseNumber!.slice(prefix.length))));
        const where = { dsOfficeId_year: { dsOfficeId, year } };
        if (last > 0) await tx.caseNumberCounter.update({ where, data: { last } });
        else await tx.caseNumberCounter.delete({ where });
      }
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

const LOAD_CAST: Cast = {
  idPrefix: LOAD_ID_PREFIX,
  officers: () => [LOAD_USER_ID],
  headOffice: () => LOAD_USER_ID,
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
  age: (r, _path, minAge) => r.int(minAge, MAX_AGE_DAYS),
  releaseDay: (r, verifiedDay, _office, today) => {
    const day = addDays(verifiedDay, r.int(1, 30));
    return day > today ? today : day;
  },
};

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
  const ctx: Context = { r, now, today: colomboDay(now), stages: await readStages(db), cast: LOAD_CAST };
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
          role: "HO_OFFICER",
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
