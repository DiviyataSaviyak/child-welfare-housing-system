import { isHeld, WAITING_ONE } from "../amendments/held";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/locales";
import { dateToDay } from "@/lib/dates";
import { localName, NAMES, nameField, type Names } from "@/lib/names";
import type { Category, Kind } from "@/generated/prisma/enums";
import { type DuplicateCase, duplicatesOf } from "../cases/duplicates";
import { caseScope, officeFilter, type Viewer } from "../permissions";

/** A district with cases awaiting their allocation letter (REL-1). */
export type WaitingDistrict = {
  id: number;
  name: string;
  /** Cases waiting. */
  count: number;
  /** The DS offices where they are built, by name (CASE-13). */
  offices: string[];
  /** When the one waiting longest was entered. */
  oldest: Date | null;
};

/**
 * REL-1: the districts whose cases await their allocation letter, the most cases first, as in the
 * prototype; then the longest waiting since it was entered. A case waits in the district where it is built (CASE-13).
 * Only the Ministry records letters; anyone else gets none.
 */
export async function districtsWaiting(db: PrismaClient, viewer: Viewer, locale: Locale): Promise<WaitingDistrict[]> {
  const scope = officeFilter(viewer);
  if (viewer.role !== "MINISTRY_OFFICER" || !scope) return [];
  const groups = await db.case.groupBy({
    by: ["buildDsOfficeId"],
    where: { AND: [scope], status: "AWAITING_ALLOCATION" },
    _count: { _all: true },
    _min: { createdAt: true },
  });
  if (groups.length === 0) return [];
  const offices = await db.dsOffice.findMany({
    where: { id: { in: groups.map((g) => g.buildDsOfficeId) } },
    orderBy: { [nameField(locale)]: "asc" },
    select: { id: true, ...NAMES, district: { select: { id: true, ...NAMES } } },
  });

  const districts = new Map<number, WaitingDistrict>();
  for (const office of offices) {
    const group = groups.find((g) => g.buildDsOfficeId === office.id);
    if (!group) continue;
    const district = districts.get(office.district.id) ?? {
      id: office.district.id,
      name: localName(office.district, locale),
      count: 0,
      offices: [],
      oldest: null,
    };
    district.count += group._count._all;
    district.offices.push(localName(office, locale));
    const entered = group._min.createdAt;
    if (entered && (!district.oldest || entered < district.oldest)) district.oldest = entered;
    districts.set(district.id, district);
  }
  const time = (date: Date | null) => date?.getTime() ?? 0;
  return [...districts.values()].sort(
    (a, b) => b.count - a.count || time(a.oldest) - time(b.oldest) || a.name.localeCompare(b.name),
  );
}

/** A case awaiting its allocation that can go on a district's letter (REL-2). */
export type LetterCase = {
  id: string;
  version: number;
  applicationNumber: string;
  name: string | null;
  childName: string | null;
  category: Category;
  kind: Kind;
  /** The DS office where it is built, which the form groups by (CASE-13). */
  officeName: string;
  /** The DS office of residence, when it is another one. */
  residenceName: string | null;
  /** When the DS entered it. */
  createdAt: Date;
  /** The other cases with the same NIC (CASE-6); empty for none. */
  duplicates: DuplicateCase[];
  /** AMD-3: an amendment of the case waits for the Ministry. It can still be ticked. */
  amendmentWaiting: boolean;
};

/**
 * REL-2: a district's cases awaiting their allocation, for its letter, by the DS office where each is
 * built (CASE-13), then the longest waiting first, each with the other cases that share its NIC (CASE-6).
 */
export async function casesForLetter(
  db: PrismaClient,
  viewer: Viewer,
  districtId: number,
  locale: Locale,
): Promise<LetterCase[]> {
  const scope = officeFilter(viewer);
  if (viewer.role !== "MINISTRY_OFFICER" || !scope) return [];
  const found = await db.case.findMany({
    where: { AND: [scope, { buildDsOffice: { districtId } }], status: "AWAITING_ALLOCATION" },
    orderBy: [{ buildDsOffice: { [nameField(locale)]: "asc" } }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      version: true,
      applicationNumber: true,
      name: true,
      childName: true,
      category: true,
      kind: true,
      nicKey: true,
      createdAt: true,
      dsOfficeId: true,
      buildDsOfficeId: true,
      dsOffice: { select: NAMES },
      buildDsOffice: { select: NAMES },
      amendments: WAITING_ONE,
      nominations: WAITING_ONE,
    },
  });
  const duplicates = await duplicatesOf(db, viewer, found, locale);
  return found.map((c) => ({
    id: c.id,
    version: c.version,
    applicationNumber: c.applicationNumber,
    name: c.name,
    childName: c.childName,
    category: c.category,
    kind: c.kind,
    officeName: localName(c.buildDsOffice, locale),
    residenceName: c.dsOfficeId === c.buildDsOfficeId ? null : localName(c.dsOffice, locale),
    createdAt: c.createdAt,
    duplicates: duplicates.get(c.id) ?? [],
    amendmentWaiting: isHeld(c),
  }));
}

/** An allocation letter as the allocation screen and its notice show it. */
export type LetterSummary = {
  id: string;
  districtName: string;
  letterNumber: string;
  /** "YYYY-MM-DD" */
  letterDate: string;
  /** "YYYY-MM-DD" */
  validUntil: string;
  /** The cases it allocated. A return to the District keeps the case's allocation on it (AMD-11). */
  count: number;
  /** The DS offices where they are built, by name. */
  offices: string[];
};

const LETTER_SELECT = {
  id: true,
  letterNumber: true,
  letterDate: true,
  validUntil: true,
  district: { select: NAMES },
  releases: { select: { case: { select: { buildDsOffice: { select: NAMES } } } } },
} as const;

type FoundLetter = {
  id: string;
  letterNumber: string;
  letterDate: Date;
  validUntil: Date;
  district: Names;
  releases: { case: { buildDsOffice: Names } }[];
};

const summary =
  (locale: Locale) =>
  (letter: FoundLetter): LetterSummary => ({
    id: letter.id,
    districtName: localName(letter.district, locale),
    letterNumber: letter.letterNumber,
    letterDate: dateToDay(letter.letterDate),
    validUntil: dateToDay(letter.validUntil),
    count: letter.releases.length,
    offices: [...new Set(letter.releases.map((r) => localName(r.case.buildDsOffice, locale)))].sort(),
  });

/** The letters recorded last, newest first, for the allocation screen's list (REL-1). The Ministry only. */
export async function recentLetters(
  db: PrismaClient,
  viewer: Viewer,
  locale: Locale,
  take = 10,
): Promise<LetterSummary[]> {
  if (viewer.role !== "MINISTRY_OFFICER" || !officeFilter(viewer)) return [];
  const found = await db.releaseLetter.findMany({
    orderBy: [{ at: "desc" }, { id: "asc" }],
    take,
    select: LETTER_SELECT,
  });
  return found.map(summary(locale));
}

/** One letter, for the notice after it is recorded. The Ministry only; anything else is null. */
export async function getLetter(
  db: PrismaClient,
  viewer: Viewer,
  id: string,
  locale: Locale,
): Promise<LetterSummary | null> {
  if (viewer.role !== "MINISTRY_OFFICER" || !officeFilter(viewer)) return null;
  const found = await db.releaseLetter.findUnique({ where: { id }, select: LETTER_SELECT });
  return found && summary(locale)(found);
}

/**
 * The district whose releases a District officer records (REL-9), from the account, never from the address;
 * null for anyone else.
 */
function releasingDistrict(viewer: Viewer): number | null {
  const scope = caseScope(viewer);
  return viewer.role === "DISTRICT_OFFICER" && scope.kind === "district" ? scope.districtId : null;
}

/** The cases of the district awaiting its release: allocated to it, and built in it (CASE-13). */
const waitingInDistrict = (districtId: number) =>
  ({ buildDsOffice: { districtId }, status: "ALLOCATED_TO_DISTRICT" }) as const;

/** A DS office of the district and one Ministry letter, with cases waiting for the District's release (REL-5). */
export type WaitingOffice = {
  /** The DS office. */
  id: number;
  name: string;
  letterId: string;
  letterNumber: string;
  /** "YYYY-MM-DD" */
  letterDate: string;
  /** Cases of the letter built in the office, waiting. */
  count: number;
};

/**
 * REL-5: one row for each DS office of the District officer's district and Ministry letter whose cases wait
 * for the District's release, by the DS where each is built (CASE-13): the most cases first, then the oldest
 * letter. A release is for one letter (REL-12). Anyone else gets none.
 */
export async function dsOfficesWaiting(db: PrismaClient, viewer: Viewer, locale: Locale): Promise<WaitingOffice[]> {
  const districtId = releasingDistrict(viewer);
  if (districtId === null) return [];
  const found = await db.case.findMany({
    where: waitingInDistrict(districtId),
    select: {
      buildDsOffice: { select: { id: true, ...NAMES } },
      release: { select: { letter: { select: { id: true, letterNumber: true, letterDate: true } } } },
    },
  });
  const rows = new Map<string, WaitingOffice>();
  for (const c of found) {
    if (!c.release) continue;
    const { letter } = c.release;
    const key = `${c.buildDsOffice.id}:${letter.id}`;
    const row = rows.get(key) ?? {
      id: c.buildDsOffice.id,
      name: localName(c.buildDsOffice, locale),
      letterId: letter.id,
      letterNumber: letter.letterNumber,
      letterDate: dateToDay(letter.letterDate),
      count: 0,
    };
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.letterDate.localeCompare(b.letterDate) ||
      a.name.localeCompare(b.name, locale) ||
      a.letterNumber.localeCompare(b.letterNumber, locale, { numeric: true }),
  );
}

/** A case the Ministry allocated that can go on the District's release to its DS office (REL-6). */
export type DsReleaseCase = {
  id: string;
  version: number;
  applicationNumber: string;
  name: string | null;
  childName: string | null;
  category: Category;
  kind: Kind;
  /** The DS office of residence, when it is another one (CASE-13). */
  residenceName: string | null;
  /** The Ministry's letter that allocated it. */
  letterNumber: string;
  /** "YYYY-MM-DD" */
  letterDate: string;
  /** AMD-3: an amendment of the case waits for the Ministry. It can still be ticked. */
  amendmentWaiting: boolean;
};

/** The DS office a District release goes to, when it is in the District officer's district. */
export type ReleasingOffice = { id: number; name: string; districtName: string };

/** The Ministry letter a District release is for (REL-12). */
export type ReleasingLetter = {
  id: string;
  letterNumber: string;
  /** "YYYY-MM-DD" */
  letterDate: string;
};

/**
 * REL-6, REL-12: one DS office of the District officer's district and one Ministry letter to the district,
 * with the letter's cases built in the office that wait for the District's release, the longest waiting
 * first. Null for an office or a letter of another district, or anyone else (PRM-1).
 */
export async function casesForDsRelease(
  db: PrismaClient,
  viewer: Viewer,
  dsOfficeId: number,
  letterId: string,
  locale: Locale,
): Promise<{ office: ReleasingOffice; letter: ReleasingLetter; cases: DsReleaseCase[] } | null> {
  const districtId = releasingDistrict(viewer);
  if (districtId === null) return null;
  const [office, letter] = await Promise.all([
    db.dsOffice.findFirst({
      where: { id: dsOfficeId, districtId },
      select: { id: true, ...NAMES, district: { select: NAMES } },
    }),
    db.releaseLetter.findFirst({
      where: { id: letterId, districtId },
      select: { id: true, letterNumber: true, letterDate: true },
    }),
  ]);
  if (!office || !letter) return null;
  const found = await db.case.findMany({
    where: { ...waitingInDistrict(districtId), buildDsOfficeId: dsOfficeId, release: { letterId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      version: true,
      applicationNumber: true,
      name: true,
      childName: true,
      category: true,
      kind: true,
      dsOfficeId: true,
      dsOffice: { select: NAMES },
      release: { select: { letter: { select: { letterNumber: true, letterDate: true } } } },
      amendments: WAITING_ONE,
      nominations: WAITING_ONE,
    },
  });
  return {
    office: { id: office.id, name: localName(office, locale), districtName: localName(office.district, locale) },
    letter: { id: letter.id, letterNumber: letter.letterNumber, letterDate: dateToDay(letter.letterDate) },
    cases: found.flatMap((c) =>
      c.release
        ? [
            {
              id: c.id,
              version: c.version,
              applicationNumber: c.applicationNumber,
              name: c.name,
              childName: c.childName,
              category: c.category,
              kind: c.kind,
              residenceName: c.dsOfficeId === dsOfficeId ? null : localName(c.dsOffice, locale),
              letterNumber: c.release.letter.letterNumber,
              letterDate: dateToDay(c.release.letter.letterDate),
              amendmentWaiting: isHeld(c),
            },
          ]
        : [],
    ),
  };
}

/** A District release as its screen and notice show it. */
export type DsReleaseSummary = {
  id: string;
  officeName: string;
  referenceNumber: string;
  /** "YYYY-MM-DD" */
  releasedOn: string;
  /** The Ministry letter it is for (REL-12). */
  letterNumber: string;
  /** The cases it holds now. One whose allocation went back with an amendment (AMD-11) is not counted (REL-11). */
  count: number;
};

const DS_RELEASE_SELECT = {
  id: true,
  referenceNumber: true,
  releasedOn: true,
  dsOffice: { select: NAMES },
  letter: { select: { letterNumber: true } },
  _count: { select: { releases: true } },
} as const;

const dsSummary =
  (locale: Locale) =>
  (found: {
    id: string;
    referenceNumber: string;
    releasedOn: Date;
    dsOffice: Names;
    letter: { letterNumber: string };
    _count: { releases: number };
  }): DsReleaseSummary => ({
    id: found.id,
    officeName: localName(found.dsOffice, locale),
    referenceNumber: found.referenceNumber,
    releasedOn: dateToDay(found.releasedOn),
    letterNumber: found.letter.letterNumber,
    count: found._count.releases,
  });

/** REL-5: the releases the District officer's district recorded last, newest first. */
export async function recentDsReleases(
  db: PrismaClient,
  viewer: Viewer,
  locale: Locale,
  take = 10,
): Promise<DsReleaseSummary[]> {
  const districtId = releasingDistrict(viewer);
  if (districtId === null) return [];
  const found = await db.dsRelease.findMany({
    where: { districtId },
    orderBy: [{ at: "desc" }, { id: "asc" }],
    take,
    select: DS_RELEASE_SELECT,
  });
  return found.map(dsSummary(locale));
}

/** One of the district's releases, for the notice after it is recorded; null for anything else. */
export async function getDsRelease(
  db: PrismaClient,
  viewer: Viewer,
  id: string,
  locale: Locale,
): Promise<DsReleaseSummary | null> {
  const districtId = releasingDistrict(viewer);
  if (districtId === null) return null;
  const found = await db.dsRelease.findFirst({ where: { id, districtId }, select: DS_RELEASE_SELECT });
  return found && dsSummary(locale)(found);
}

/**
 * NTF-1, REL-5: how many of the district's cases wait for the District officer's release, for the menu,
 * with when they were counted (src/components/shell/live-count.ts). Anyone else gets 0.
 */
export async function awaitingDsRelease(db: PrismaClient, viewer: Viewer): Promise<{ count: number; at: number }> {
  const at = Date.now();
  const districtId = releasingDistrict(viewer);
  if (districtId === null) return { count: 0, at };
  return { count: await db.case.count({ where: waitingInDistrict(districtId) }), at };
}

/**
 * NTF-1, REL-1: how many cases await the Ministry's allocation, for the menu and the dashboard, with when
 * they were counted, so the screen can tell which of two readings is newer (src/components/shell/live-count.ts).
 * Only the Ministry has the count; anyone else gets 0.
 */
export async function awaitingAllocation(db: PrismaClient, viewer: Viewer): Promise<{ count: number; at: number }> {
  const at = Date.now();
  const scope = officeFilter(viewer);
  if (viewer.role !== "MINISTRY_OFFICER" || !scope) return { count: 0, at };
  return { count: await db.case.count({ where: { AND: [scope], status: "AWAITING_ALLOCATION" } }), at };
}

/**
 * A beneficiary on a letter or a District release, as its page lists them (REL-10, REL-11). One whose
 * allocation went back with an amendment (AMD-11) never received it, so it is not listed.
 */
export type SentCase = { id: string; name: string | null; childName: string | null };

const SENT_CASES = {
  select: { case: { select: { id: true, name: true, childName: true, applicationNumber: true } } },
} as const;

/** By Application Number, as the officers file them. */
const sentCases = (locale: Locale, found: { case: SentCase & { applicationNumber: string } }[]): SentCase[] =>
  found
    .map((r) => r.case)
    .sort((a, b) => a.applicationNumber.localeCompare(b.applicationNumber, locale, { numeric: true }))
    .map(({ id, name, childName }) => ({ id, name, childName }));

/** One letter with its beneficiaries, as its page shows it (REL-10). */
export type LetterDetails = {
  districtName: string;
  letterNumber: string;
  /** "YYYY-MM-DD" */
  letterDate: string;
  cases: SentCase[];
};

/** REL-10: one allocation letter and its beneficiaries. The Ministry only; anything else is null. */
export async function letterWithCases(
  db: PrismaClient,
  viewer: Viewer,
  id: string,
  locale: Locale,
): Promise<LetterDetails | null> {
  if (viewer.role !== "MINISTRY_OFFICER" || !officeFilter(viewer)) return null;
  const found = await db.releaseLetter.findUnique({
    where: { id },
    select: { letterNumber: true, letterDate: true, district: { select: NAMES }, releases: SENT_CASES },
  });
  if (!found) return null;
  return {
    districtName: localName(found.district, locale),
    letterNumber: found.letterNumber,
    letterDate: dateToDay(found.letterDate),
    cases: sentCases(locale, found.releases),
  };
}

/** One District release with its beneficiaries, as its page shows it (REL-11). */
export type DsReleaseDetails = {
  officeName: string;
  referenceNumber: string;
  /** "YYYY-MM-DD" */
  releasedOn: string;
  /** The Ministry letter it is for (REL-11, REL-12). */
  letterNumber: string;
  /** "YYYY-MM-DD" */
  letterDate: string;
  cases: SentCase[];
};

/**
 * REL-11: one of the District officer's district's releases and its beneficiaries; null for a release of
 * another district or anyone else (PRM-1).
 */
export async function dsReleaseWithCases(
  db: PrismaClient,
  viewer: Viewer,
  id: string,
  locale: Locale,
): Promise<DsReleaseDetails | null> {
  const districtId = releasingDistrict(viewer);
  if (districtId === null) return null;
  const found = await db.dsRelease.findFirst({
    where: { id, districtId },
    select: {
      referenceNumber: true,
      releasedOn: true,
      dsOffice: { select: NAMES },
      letter: { select: { letterNumber: true, letterDate: true } },
      releases: SENT_CASES,
    },
  });
  if (!found) return null;
  return {
    officeName: localName(found.dsOffice, locale),
    referenceNumber: found.referenceNumber,
    releasedOn: dateToDay(found.releasedOn),
    letterNumber: found.letter.letterNumber,
    letterDate: dateToDay(found.letter.letterDate),
    cases: sentCases(locale, found.releases),
  };
}
