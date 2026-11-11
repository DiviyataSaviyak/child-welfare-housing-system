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
  /** The cases it allocated. */
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

/** A DS office of the district with cases waiting for the District's release (REL-5). */
export type WaitingOffice = {
  id: number;
  name: string;
  /** Cases waiting. */
  count: number;
  /** "YYYY-MM-DD": the date of the oldest Ministry letter among them. */
  oldestLetter: string | null;
};

/**
 * REL-5: the DS offices of the District officer's district whose cases the Ministry allocated wait for the
 * District's release, by the DS where each is built (CASE-13): the most cases first, then the longest
 * waiting. Anyone else gets none.
 */
export async function dsOfficesWaiting(db: PrismaClient, viewer: Viewer, locale: Locale): Promise<WaitingOffice[]> {
  const districtId = releasingDistrict(viewer);
  if (districtId === null) return [];
  const found = await db.case.findMany({
    where: waitingInDistrict(districtId),
    select: { buildDsOffice: { select: { id: true, ...NAMES } }, release: { select: { releasedOn: true } } },
  });
  const offices = new Map<number, WaitingOffice>();
  for (const c of found) {
    const office = offices.get(c.buildDsOffice.id) ?? {
      id: c.buildDsOffice.id,
      name: localName(c.buildDsOffice, locale),
      count: 0,
      oldestLetter: null,
    };
    office.count += 1;
    const letterDay = c.release ? dateToDay(c.release.releasedOn) : null;
    if (letterDay && (!office.oldestLetter || letterDay < office.oldestLetter)) office.oldestLetter = letterDay;
    offices.set(office.id, office);
  }
  return [...offices.values()].sort(
    (a, b) =>
      b.count - a.count ||
      (a.oldestLetter ?? "").localeCompare(b.oldestLetter ?? "") ||
      a.name.localeCompare(b.name, locale),
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
};

/** The DS office a District release goes to, when it is in the District officer's district. */
export type ReleasingOffice = { id: number; name: string; districtName: string };

/**
 * REL-6: one DS office of the District officer's district, with its cases waiting for the District's
 * release, the oldest letter first. Null for an office of another district or anyone else (PRM-1).
 */
export async function casesForDsRelease(
  db: PrismaClient,
  viewer: Viewer,
  dsOfficeId: number,
  locale: Locale,
): Promise<{ office: ReleasingOffice; cases: DsReleaseCase[] } | null> {
  const districtId = releasingDistrict(viewer);
  if (districtId === null) return null;
  const office = await db.dsOffice.findFirst({
    where: { id: dsOfficeId, districtId },
    select: { id: true, ...NAMES, district: { select: NAMES } },
  });
  if (!office) return null;
  const found = await db.case.findMany({
    where: { ...waitingInDistrict(districtId), buildDsOfficeId: dsOfficeId },
    orderBy: [{ release: { releasedOn: "asc" } }, { createdAt: "asc" }, { id: "asc" }],
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
    },
  });
  return {
    office: { id: office.id, name: localName(office, locale), districtName: localName(office.district, locale) },
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
  /** The cases it released. */
  count: number;
};

const DS_RELEASE_SELECT = {
  id: true,
  referenceNumber: true,
  releasedOn: true,
  dsOffice: { select: NAMES },
  _count: { select: { releases: true } },
} as const;

const dsSummary =
  (locale: Locale) =>
  (found: {
    id: string;
    referenceNumber: string;
    releasedOn: Date;
    dsOffice: Names;
    _count: { releases: number };
  }): DsReleaseSummary => ({
    id: found.id,
    officeName: localName(found.dsOffice, locale),
    referenceNumber: found.referenceNumber,
    releasedOn: dateToDay(found.releasedOn),
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
