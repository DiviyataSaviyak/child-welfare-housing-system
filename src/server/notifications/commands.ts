import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { NotificationType } from "@/generated/prisma/enums";
import { officeFilter, type Viewer } from "../permissions";

/**
 * NTF-1: tells every active officer of a case's DS offices about it: the DS of residence and the DS
 * where it is built (CASE-13). An officer has one office, so nobody hears twice, even when the two
 * offices are the same. Call it in the same transaction as the change, so the notice exists exactly
 * when the change does.
 */
export async function notifyOffice(
  tx: Prisma.TransactionClient,
  notice: { dsOfficeIds: number[]; caseId: string; type: NotificationType; at: Date },
): Promise<void> {
  const officers = await tx.user.findMany({
    where: { dsOfficeId: { in: [...new Set(notice.dsOfficeIds)] }, role: "DS_OFFICER", banned: false },
    select: { id: true },
  });
  if (officers.length === 0) return;
  await tx.notification.createMany({
    data: officers.map((officer) => ({
      id: randomUUID(),
      userId: officer.id,
      caseId: notice.caseId,
      type: notice.type,
      createdAt: notice.at,
    })),
  });
}

/**
 * NTF-1: tells every active District officer of a district about a Ministry letter to it, once per letter
 * (REL-3). A notification belongs to a case, so it hangs on the letter's first case, from which the list
 * reads the letter and how many cases it allocates. Call it in the letter's transaction.
 */
export async function notifyDistrict(
  tx: Prisma.TransactionClient,
  notice: { districtId: number; caseId: string; type: NotificationType; at: Date },
): Promise<void> {
  const officers = await tx.user.findMany({
    where: { districtId: notice.districtId, role: "DISTRICT_OFFICER", banned: false },
    select: { id: true },
  });
  if (officers.length === 0) return;
  await tx.notification.createMany({
    data: officers.map((officer) => ({
      id: randomUUID(),
      userId: officer.id,
      caseId: notice.caseId,
      type: notice.type,
      createdAt: notice.at,
    })),
  });
}

/**
 * Marks one of the user's own notifications read and gives its case, so the screen can open it (NTF-1).
 * Anyone else's notification, or one about a case the user may no longer see (PRM-3), reads as not found.
 */
export async function openNotification(
  db: PrismaClient,
  viewer: Viewer & { userId: string },
  id: string,
): Promise<{ caseId: string } | null> {
  const scope = officeFilter(viewer);
  if (!scope) return null;
  const found = await db.notification.findFirst({
    where: { id, userId: viewer.userId, case: scope },
    select: { caseId: true, readAt: true },
  });
  if (!found) return null;
  if (!found.readAt) await db.notification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
  return { caseId: found.caseId };
}

/** Marks every unread notification of the user read. */
export async function markAllRead(db: PrismaClient, userId: string): Promise<void> {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
