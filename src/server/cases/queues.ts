import type { PrismaClient } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/locales";
import { localName, NAMES } from "@/lib/names";
import { officeFilter, type Viewer } from "../permissions";
import { duplicateFlags } from "./duplicates";
import { PAGE_SIZE } from "./queries";

/** Head Office's two queues (CHK-1, REL-1): cases to check, then cases to release money for. */
export type Queue = "check" | "release";

export type QueueRow = {
  id: string;
  caseNumber: string | null;
  name: string | null;
  childName: string | null;
  officeName: string;
  /** Sent for checking, or verified: the queue's oldest comes first. */
  waitingSince: Date | null;
  /** The NIC is on another case too (CHK-1). Only the check queue looks. */
  duplicate: boolean;
  /** The number of the case this one was entered in place of (CASE-11). */
  replacesNumber: string | null;
};

/** The part of the country a queue is narrowed to (CHK-4): a district, or one DS office in it. */
export type QueuePlace = { districtId?: number; dsOfficeId?: number };

const STATUS = { check: "SUBMITTED", release: "VERIFIED" } as const;

/**
 * One page of a queue, the longest waiting first: by submission for the check (CHK-1) and by
 * verification for the release (REL-1), in the chosen place only (CHK-4). Only Head Office has
 * queues; anyone else gets none.
 */
export async function listQueue(
  db: PrismaClient,
  viewer: Viewer,
  queue: Queue,
  page: number,
  locale: Locale,
  place: QueuePlace = {},
): Promise<{ rows: QueueRow[]; total: number }> {
  const scope = officeFilter(viewer);
  if (viewer.role !== "HO_OFFICER" || !scope) return { rows: [], total: 0 };
  const where = {
    AND: [
      scope,
      place.districtId ? { dsOffice: { districtId: place.districtId } } : {},
      place.dsOfficeId ? { dsOfficeId: place.dsOfficeId } : {},
    ],
    status: STATUS[queue],
  };
  const since = queue === "check" ? "submittedAt" : "verifiedAt";

  const [found, total] = await Promise.all([
    db.case.findMany({
      where,
      orderBy: [{ [since]: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      skip: (Math.max(1, page) - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        caseNumber: true,
        name: true,
        childName: true,
        nicKey: true,
        dsOfficeId: true,
        submittedAt: true,
        verifiedAt: true,
        dsOffice: { select: NAMES },
        replaces: { select: { caseNumber: true } },
      },
    }),
    db.case.count({ where }),
  ]);
  const flagged = queue === "check" ? await duplicateFlags(db, found) : new Set<string>();

  return {
    rows: found.map((row) => ({
      id: row.id,
      caseNumber: row.caseNumber,
      name: row.name,
      childName: row.childName,
      officeName: localName(row.dsOffice, locale),
      waitingSince: row[since],
      duplicate: flagged.has(row.id),
      replacesNumber: row.replaces?.caseNumber ?? null,
    })),
    total,
  };
}

/** How many cases wait in a queue at each DS office, by its id, for choosing a place (CHK-4). */
export async function queueByOffice(db: PrismaClient, viewer: Viewer, queue: Queue): Promise<Map<number, number>> {
  const scope = officeFilter(viewer);
  if (viewer.role !== "HO_OFFICER" || !scope) return new Map();
  const groups = await db.case.groupBy({
    by: ["dsOfficeId"],
    where: { ...scope, status: STATUS[queue] },
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.dsOfficeId, group._count._all]));
}

/** How many cases wait in each queue, for the tabs and the menu (NTF-1). */
export async function queueCounts(db: PrismaClient, viewer: Viewer): Promise<Record<Queue, number>> {
  const scope = officeFilter(viewer);
  if (viewer.role !== "HO_OFFICER" || !scope) return { check: 0, release: 0 };
  const [check, release] = await Promise.all([
    db.case.count({ where: { ...scope, status: STATUS.check } }),
    db.case.count({ where: { ...scope, status: STATUS.release } }),
  ]);
  return { check, release };
}

/**
 * The menu's count (NTF-1): both queues together, with when they were read, so the screen can tell
 * which of two readings is newer (src/components/shell/live-count.ts).
 */
export async function waitingNow(db: PrismaClient, viewer: Viewer): Promise<{ count: number; at: number }> {
  const at = Date.now();
  const { check, release } = await queueCounts(db, viewer);
  return { count: check + release, at };
}
