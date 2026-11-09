import type { PrismaClient } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/locales";
import { dateToDay } from "@/lib/dates";
import { localName, NAMES, nameField, type Names } from "@/lib/names";
import { officeFilter, type Viewer } from "../permissions";

/** A district with verified cases waiting for an allocation letter (REL-1). */
export type WaitingDistrict = {
  id: number;
  name: string;
  /** Verified cases waiting. */
  count: number;
  /** The DS offices they belong to, by name. */
  offices: string[];
  /** The oldest verification among them. */
  oldest: Date | null;
};

/**
 * REL-1: the districts whose verified cases wait for an allocation letter, the most cases first, as in
 * the prototype; then the longest waiting. Only Head Office records letters; anyone else gets none.
 */
export async function districtsWaiting(db: PrismaClient, viewer: Viewer, locale: Locale): Promise<WaitingDistrict[]> {
  const scope = officeFilter(viewer);
  if (viewer.role !== "MINISTRY_OFFICER" || !scope) return [];
  const groups = await db.case.groupBy({
    by: ["dsOfficeId"],
    where: { ...scope, status: "VERIFIED" },
    _count: { _all: true },
    _min: { verifiedAt: true },
  });
  if (groups.length === 0) return [];
  const offices = await db.dsOffice.findMany({
    where: { id: { in: groups.map((g) => g.dsOfficeId) } },
    orderBy: { [nameField(locale)]: "asc" },
    select: { id: true, ...NAMES, district: { select: { id: true, ...NAMES } } },
  });

  const districts = new Map<number, WaitingDistrict>();
  for (const office of offices) {
    const group = groups.find((g) => g.dsOfficeId === office.id);
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
    const verified = group._min.verifiedAt;
    if (verified && (!district.oldest || verified < district.oldest)) district.oldest = verified;
    districts.set(district.id, district);
  }
  const time = (date: Date | null) => date?.getTime() ?? 0;
  return [...districts.values()].sort(
    (a, b) => b.count - a.count || time(a.oldest) - time(b.oldest) || a.name.localeCompare(b.name),
  );
}

/** A verified case that can go on a district's letter (REL-2). */
export type LetterCase = {
  id: string;
  version: number;
  caseNumber: string | null;
  name: string | null;
  childName: string | null;
  officeName: string;
  verifiedAt: Date | null;
};

/** REL-2: a district's verified cases for its letter, by DS office, then the longest waiting first. */
export async function casesForLetter(
  db: PrismaClient,
  viewer: Viewer,
  districtId: number,
  locale: Locale,
): Promise<LetterCase[]> {
  const scope = officeFilter(viewer);
  if (viewer.role !== "MINISTRY_OFFICER" || !scope) return [];
  const found = await db.case.findMany({
    where: { AND: [scope, { dsOffice: { districtId } }], status: "VERIFIED" },
    orderBy: [
      { dsOffice: { [nameField(locale)]: "asc" } },
      { verifiedAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ],
    select: {
      id: true,
      version: true,
      caseNumber: true,
      name: true,
      childName: true,
      verifiedAt: true,
      dsOffice: { select: NAMES },
    },
  });
  return found.map(({ dsOffice, ...row }) => ({ ...row, officeName: localName(dsOffice, locale) }));
}

/** An allocation letter as the release screen and its notice show it. */
export type LetterSummary = {
  id: string;
  districtName: string;
  letterNumber: string;
  /** "YYYY-MM-DD" */
  letterDate: string;
  /** "YYYY-MM-DD" */
  validUntil: string;
  /** The cases it released. */
  count: number;
  /** Their DS offices, by name. */
  offices: string[];
};

const LETTER_SELECT = {
  id: true,
  letterNumber: true,
  letterDate: true,
  validUntil: true,
  district: { select: NAMES },
  releases: { select: { case: { select: { dsOffice: { select: NAMES } } } } },
} as const;

type FoundLetter = {
  id: string;
  letterNumber: string;
  letterDate: Date;
  validUntil: Date;
  district: Names;
  releases: { case: { dsOffice: Names } }[];
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
    offices: [...new Set(letter.releases.map((r) => localName(r.case.dsOffice, locale)))].sort(),
  });

/** The letters recorded last, newest first, for the release screen's list (REL-2). Head Office only. */
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

/** One letter, for the notice after it is recorded. Head Office only; anything else is null. */
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
