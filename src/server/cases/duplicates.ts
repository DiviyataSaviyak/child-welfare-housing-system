import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/locales";
import { localName, NAMES } from "@/lib/names";
import { nicKey } from "@/lib/nic";
import { caseScope, type Viewer } from "../permissions";

/**
 * Another case with the same NIC. What it shows depends on who asks (CASE-6):
 * - a DS officer sees the Application Number and name of a case of their own office,
 * - and only the Application Number and DS office of a case elsewhere, since another DS may use the
 *   same number (CASE-12);
 * - the Ministry sees all three.
 */
export type NicMatch = { applicationNumber: string; name: string | null; officeName: string | null };

/** The other cases that share a NIC key (CASE-6). There are no drafts, so every case counts. */
function matchWhere(key: string, exceptCaseId: string | null): Prisma.CaseWhereInput {
  return { nicKey: key, ...(exceptCaseId ? { id: { not: exceptCaseId } } : {}) };
}

/**
 * CASE-6: other cases with the same NIC, in either format, so 880001234V matches 198800001234.
 * The warning never blocks saving. `dsOfficeId` is the office the Ministry chose on the form; it is no
 * longer needed, since a match shows the same whatever office the case is entered for.
 */
export async function findNicMatches(
  db: PrismaClient,
  viewer: Viewer,
  input: { nic: string; dsOfficeId: number | null; exceptCaseId: string | null },
  locale: Locale,
): Promise<NicMatch[]> {
  const scope = caseScope(viewer);
  const key = nicKey(input.nic);
  // The warning is for the case form, which only an office's officers and the Ministry open.
  if ((scope.kind !== "office" && scope.kind !== "all") || !key) return [];

  const rows = await db.case.findMany({
    where: matchWhere(key, input.exceptCaseId),
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { applicationNumber: true, name: true, dsOfficeId: true, dsOffice: { select: NAMES } },
  });

  return rows.map((row) => {
    const officeName = localName(row.dsOffice, locale);
    if (scope.kind === "all") return { applicationNumber: row.applicationNumber, name: row.name, officeName };
    return row.dsOfficeId === scope.dsOfficeId
      ? { applicationNumber: row.applicationNumber, name: row.name, officeName: null }
      : { applicationNumber: row.applicationNumber, name: null, officeName };
  });
}

/** A matching case as the Ministry's case page shows it: everything, with a link (CASE-6). */
export type DuplicateCase = {
  id: string;
  applicationNumber: string;
  status: CaseStatus;
  name: string | null;
  childName: string | null;
  officeName: string;
};

/**
 * CASE-6: every other case with the same NIC as a case awaiting the Ministry's allocation, in full, for the
 * Ministry's case page. Nobody checks a case first any more (change 0006).
 */
export async function duplicatesInFull(
  db: PrismaClient,
  viewer: Viewer,
  input: { caseId: string; nic: string | null; dsOfficeId: number },
  locale: Locale,
): Promise<DuplicateCase[]> {
  const key = input.nic ? nicKey(input.nic) : null;
  if (caseScope(viewer).kind !== "all" || !key) return [];
  const rows = await db.case.findMany({
    where: matchWhere(key, input.caseId),
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      name: true,
      childName: true,
      dsOffice: { select: NAMES },
    },
  });
  return rows.map(({ dsOffice, ...row }) => ({ ...row, officeName: localName(dsOffice, locale) }));
}

/**
 * CASE-6: for each of these cases, every other case with the same NIC, in full, for the duplicate flag on
 * each row of the Ministry's letter form (REL-2), as version 1's check queue showed them. One query for all
 * the cases; a case with no match has no entry. The Ministry only.
 */
export async function duplicatesOf(
  db: PrismaClient,
  viewer: Viewer,
  cases: { id: string; nicKey: string | null }[],
  locale: Locale,
): Promise<Map<string, DuplicateCase[]>> {
  const keys = [...new Set(cases.flatMap((c) => (c.nicKey ? [c.nicKey] : [])))];
  if (caseScope(viewer).kind !== "all" || keys.length === 0) return new Map();
  const sharing = await db.case.findMany({
    where: { nicKey: { in: keys } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      nicKey: true,
      applicationNumber: true,
      status: true,
      name: true,
      childName: true,
      dsOffice: { select: NAMES },
    },
  });
  const found = new Map<string, DuplicateCase[]>();
  for (const c of cases) {
    const matches = sharing
      .filter((other) => other.nicKey === c.nicKey && other.id !== c.id)
      .slice(0, 20)
      .map((match) => ({
        id: match.id,
        applicationNumber: match.applicationNumber,
        status: match.status,
        name: match.name,
        childName: match.childName,
        officeName: localName(match.dsOffice, locale),
      }));
    if (matches.length > 0) found.set(c.id, matches);
  }
  return found;
}
