import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import type { Locale } from "@/i18n/locales";
import { localName, NAMES } from "@/lib/names";
import { nicKey } from "@/lib/nic";
import { caseScope, type Viewer } from "../permissions";

/**
 * Another case with the same NIC. What it shows depends on who asks (CASE-6):
 * - a DS officer sees the case number and name of a case in their own office,
 * - and only the case number and office of a case elsewhere;
 * - Head Office sees all three (CHK-2).
 * A draft has no case number yet.
 */
export type NicMatch = { applicationNumber: string | null; name: string | null; officeName: string | null };

/**
 * The cases that share a NIC key with a case of `ownOffice`. Drafts count only in that office;
 * elsewhere they have no number to show (CASE-6).
 */
function matchWhere(key: string, ownOffice: number | null, exceptCaseId: string | null): Prisma.CaseWhereInput {
  return {
    nicKey: key,
    ...(exceptCaseId ? { id: { not: exceptCaseId } } : {}),
    OR: [{ status: { not: "DRAFT" } }, ...(ownOffice !== null ? [{ dsOfficeId: ownOffice }] : [])],
  };
}

/**
 * CASE-6: other cases with the same NIC, in either format, so 880001234V matches 198800001234.
 * The warning never blocks saving or submitting.
 */
export async function findNicMatches(
  db: PrismaClient,
  viewer: Viewer,
  input: { nic: string; dsOfficeId: number | null; exceptCaseId: string | null },
  locale: Locale,
): Promise<NicMatch[]> {
  const scope = caseScope(viewer);
  const key = nicKey(input.nic);
  // The warning is for the case form, which only an office's officers and Head Office open.
  if ((scope.kind !== "office" && scope.kind !== "all") || !key) return [];

  const ownOffice = scope.kind === "office" ? scope.dsOfficeId : input.dsOfficeId;
  const rows = await db.case.findMany({
    where: matchWhere(key, ownOffice, input.exceptCaseId),
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

/** A matching case as Head Office's check view shows it: everything, with a link (CHK-2). */
export type DuplicateCase = {
  id: string;
  applicationNumber: string | null;
  status: CaseStatus;
  name: string | null;
  childName: string | null;
  officeName: string;
};

/** CHK-2: every other case with the same NIC as a case Head Office is checking, in full. */
export async function duplicatesInFull(
  db: PrismaClient,
  viewer: Viewer,
  input: { caseId: string; nic: string | null; dsOfficeId: number },
  locale: Locale,
): Promise<DuplicateCase[]> {
  const key = input.nic ? nicKey(input.nic) : null;
  if (caseScope(viewer).kind !== "all" || !key) return [];
  const rows = await db.case.findMany({
    where: matchWhere(key, input.dsOfficeId, input.caseId),
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
 * CHK-1: which of these cases share their NIC with another case, for the flag in the check queue.
 * One query for the whole page of cases.
 */
export async function duplicateFlags(
  db: PrismaClient,
  cases: { id: string; nicKey: string | null; dsOfficeId: number }[],
): Promise<Set<string>> {
  const keys = [...new Set(cases.flatMap((c) => (c.nicKey ? [c.nicKey] : [])))];
  if (keys.length === 0) return new Set();
  const sharing = await db.case.findMany({
    where: { nicKey: { in: keys } },
    select: { id: true, nicKey: true, status: true, dsOfficeId: true },
  });
  return new Set(
    cases
      .filter((c) =>
        sharing.some(
          (other) =>
            other.nicKey === c.nicKey &&
            other.id !== c.id &&
            (other.status !== "DRAFT" || other.dsOfficeId === c.dsOfficeId),
        ),
      )
      .map((c) => c.id),
  );
}
