import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { localName, NAMES } from "@/lib/names";
import { isRole, type Role } from "./auth/roles";
import { sessionVerdict, shouldRecordActivity } from "./auth/session-rules";
import { db } from "./db";
import { logEvent } from "./log";

/** The signed-in user, as every server check sees them. */
export type Context = {
  userId: string;
  sessionId: string;
  name: string;
  role: Role;
  /** A code from src/server/auth/designations.ts; null for an admin. */
  designation: string | null;
  dsOfficeId: number | null;
  districtId: number | null;
  provinceId: number | null;
  /** In the screen's language (UI-9). */
  dsOfficeName: string | null;
  mustChangePassword: boolean;
};

/**
 * Reads the session from the database on every request (ARC-2), once per render thanks to cache().
 * Returns null when nobody is signed in, or when the session is over: disabled account, too old,
 * or idle for more than 30 minutes (AUTH-4, AUTH-5). An expired session is deleted.
 */
export const getContext = cache(async (): Promise<Context | null> => {
  const found = await auth.api.getSession({ headers: await headers() });
  if (!found) return null;

  const row = await db.session.findUnique({
    where: { id: found.session.id },
    select: {
      id: true,
      createdAt: true,
      lastActiveAt: true,
      user: {
        select: {
          id: true,
          name: true,
          role: true,
          banned: true,
          designation: true,
          dsOfficeId: true,
          districtId: true,
          provinceId: true,
          mustChangePassword: true,
          dsOffice: { select: NAMES },
        },
      },
    },
  });
  if (!row) return null;

  const now = new Date();
  const verdict = sessionVerdict(
    { createdAt: row.createdAt, lastActiveAt: row.lastActiveAt, banned: row.user.banned, role: row.user.role },
    now,
  );
  if (verdict !== "ok" || !isRole(row.user.role)) {
    await db.session.deleteMany({ where: { id: row.id } });
    logEvent("session_ended", { reason: verdict, userId: row.user.id });
    return null;
  }

  if (shouldRecordActivity(row.lastActiveAt, now)) {
    await db.session.update({ where: { id: row.id }, data: { lastActiveAt: now } });
  }

  return {
    userId: row.user.id,
    sessionId: row.id,
    name: row.user.name,
    role: row.user.role,
    designation: row.user.designation,
    dsOfficeId: row.user.dsOfficeId,
    districtId: row.user.districtId,
    provinceId: row.user.provinceId,
    dsOfficeName: row.user.dsOffice ? localName(row.user.dsOffice, await getLocale()) : null,
    mustChangePassword: row.user.mustChangePassword,
  };
});

/**
 * For every protected page and action: sends signed-out users to the sign-in page, and users with a
 * temporary password to the "set a new password" page (AUTH-3).
 */
export async function requireSignedIn(options: { allowTemporaryPassword?: boolean } = {}): Promise<Context> {
  const context = await getContext();
  if (!context) redirect("/login");
  if (context.mustChangePassword && !options.allowTemporaryPassword) redirect("/change-password");
  return context;
}

/** Like requireSignedIn, and answers "not found" to any other role (PRM-1, ERR-2). */
export async function requireRole(...roles: Role[]): Promise<Context> {
  const context = await requireSignedIn();
  if (!roles.includes(context.role)) notFound();
  return context;
}
