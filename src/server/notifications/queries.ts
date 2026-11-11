import type { PrismaClient } from "@/generated/prisma/client";
import type { NotificationType } from "@/generated/prisma/enums";
import { officeFilter, type Viewer } from "../permissions";

export type NotificationRow = {
  id: string;
  type: NotificationType;
  createdAt: Date;
  read: boolean;
  caseId: string;
  applicationNumber: string;
  name: string | null;
  childName: string | null;
  /**
   * For a District officer's notice of a Ministry letter (DISTRICT_LETTER): the letter on the case it hangs
   * on, with how many cases it allocates (NTF-1); null for any other notice.
   */
  letter: { number: string; count: number } | null;
};

/**
 * Notifications about cases the user may still see: an officer moved to another office (ADM-4) no
 * longer sees the old office's cases, nor their notices (PRM-3).
 */
function visibleTo(viewer: Viewer & { userId: string }) {
  const scope = officeFilter(viewer);
  return scope ? { userId: viewer.userId, case: scope } : null;
}

/** NTF-1: the bell's count. */
export async function unreadCount(db: PrismaClient, viewer: Viewer & { userId: string }): Promise<number> {
  const where = visibleTo(viewer);
  return where ? db.notification.count({ where: { ...where, readAt: null } }) : 0;
}

/** The bell's count with when it was read, so the screen can tell which of two readings is newer. */
export async function unreadNow(
  db: PrismaClient,
  viewer: Viewer & { userId: string },
): Promise<{ count: number; at: number }> {
  const at = Date.now();
  return { count: await unreadCount(db, viewer), at };
}

/** NTF-1: the newest notifications first. */
export async function listNotifications(
  db: PrismaClient,
  viewer: Viewer & { userId: string },
  take = 50,
): Promise<NotificationRow[]> {
  const where = visibleTo(viewer);
  if (!where) return [];
  const rows = await db.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take,
    select: {
      id: true,
      type: true,
      createdAt: true,
      readAt: true,
      case: {
        select: {
          id: true,
          applicationNumber: true,
          name: true,
          childName: true,
          release: { select: { letter: { select: { letterNumber: true, _count: { select: { releases: true } } } } } },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    createdAt: row.createdAt,
    read: row.readAt !== null,
    caseId: row.case.id,
    applicationNumber: row.case.applicationNumber,
    name: row.case.name,
    childName: row.case.childName,
    letter:
      row.type === "DISTRICT_LETTER" && row.case.release
        ? { number: row.case.release.letter.letterNumber, count: row.case.release.letter._count.releases }
        : null,
  }));
}
