import type { PrismaClient } from "@/generated/prisma/client";
import { writeAudit } from "../audit";
import { normaliseUsername } from "./accounts";

/**
 * AUTH-7: someone on the sign-in page asks for a new password for this username. The request waits on
 * the admin's users screen; the admin calls the officer on the number in their account and gives a
 * temporary password (ADM-5). The page says the same whatever happens here, so it never shows whether a
 * username exists. An unknown username or a disabled account opens nothing, and neither does a second
 * request while one is open.
 *
 * Answers the account's id when a request was opened, for the log.
 */
export async function askForNewPassword(db: PrismaClient, username: string, now = new Date()): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { username: normaliseUsername(username) },
    select: { id: true, role: true, banned: true, newPasswordAskedAt: true },
  });
  if (!user?.role || user.banned || user.newPasswordAskedAt) return null;

  return db.$transaction(async (tx) => {
    // Only while none is open, so two requests at once make one request and one audit record.
    const opened = await tx.user.updateMany({
      where: { id: user.id, newPasswordAskedAt: null },
      data: { newPasswordAskedAt: now },
    });
    if (opened.count === 0) return null;
    await writeAudit(tx, { actorId: null, action: "new_password_asked", entityType: "user", entityId: user.id });
    return user.id;
  });
}
