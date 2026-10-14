import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/locales";
import { localName, NAMES } from "@/lib/names";
import { isRole, type Role } from "../auth/roles";

export type AccountRow = {
  id: string;
  name: string;
  username: string;
  designation: string | null;
  mobile: string | null;
  role: Role;
  officeName: string | null;
  districtName: string | null;
  lastSignInAt: Date | null;
  active: boolean;
  /** When someone asked for a new password on the sign-in page, while the request waits (AUTH-7). */
  newPasswordAskedAt: Date | null;
};

/**
 * ADM-1: every account, searchable by name, office (in any of its three names) or username, and
 * filterable by role. Office and district names come in the screen's language (UI-9). Accounts waiting
 * for a new password come first, the longest waiting at the top (AUTH-7).
 */
export async function listAccounts(
  db: PrismaClient,
  filter: { q?: string; role?: Role },
  locale: Locale,
): Promise<AccountRow[]> {
  const q = filter.q?.trim();
  const where: Prisma.UserWhereInput = {
    ...(filter.role ? { role: filter.role } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { username: { contains: q.toLowerCase() } },
            { dsOffice: { nameSi: { contains: q } } },
            { dsOffice: { nameTa: { contains: q } } },
            { dsOffice: { nameEn: { contains: q, mode: "insensitive" } } },
            { dsOffice: { district: { nameSi: { contains: q } } } },
            { dsOffice: { district: { nameTa: { contains: q } } } },
            { dsOffice: { district: { nameEn: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const users = await db.user.findMany({
    where,
    orderBy: [{ newPasswordAskedAt: { sort: "asc", nulls: "last" } }, { role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      username: true,
      designation: true,
      mobile: true,
      role: true,
      banned: true,
      lastSignInAt: true,
      newPasswordAskedAt: true,
      dsOffice: { select: { ...NAMES, district: { select: NAMES } } },
    },
  });
  return users.flatMap((u) =>
    isRole(u.role) && u.username
      ? [
          {
            id: u.id,
            name: u.name,
            username: u.username,
            designation: u.designation,
            mobile: u.mobile,
            role: u.role,
            officeName: u.dsOffice ? localName(u.dsOffice, locale) : null,
            districtName: u.dsOffice ? localName(u.dsOffice.district, locale) : null,
            lastSignInAt: u.lastSignInAt,
            active: !u.banned,
            newPasswordAskedAt: u.newPasswordAskedAt,
          },
        ]
      : [],
  );
}

export async function accountCounts(db: PrismaClient): Promise<{ total: number; active: number; disabled: number }> {
  const [total, disabled] = await Promise.all([db.user.count(), db.user.count({ where: { banned: true } })]);
  return { total, active: total - disabled, disabled };
}

/**
 * AUTH-7: how many accounts wait for a new password, for the admin's menu, and when it was read. The menu
 * reads it again from /admin/waiting after every move (src/components/shell/live-count.ts).
 */
export async function newPasswordRequestsNow(db: PrismaClient): Promise<{ count: number; at: number }> {
  const at = Date.now();
  const count = await db.user.count({ where: { newPasswordAskedAt: { not: null }, banned: false } });
  return { count, at };
}

export async function activeAdminCount(db: PrismaClient | Prisma.TransactionClient): Promise<number> {
  return db.user.count({ where: { role: "ADMIN", banned: false } });
}

export type AccountDetails = {
  id: string;
  name: string;
  username: string;
  designation: string | null;
  mobile: string | null;
  contactEmail: string | null;
  role: Role;
  dsOfficeId: number | null;
  districtId: number | null;
  active: boolean;
};

export async function getAccount(db: PrismaClient, id: string): Promise<AccountDetails | null> {
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      username: true,
      designation: true,
      mobile: true,
      contactEmail: true,
      role: true,
      banned: true,
      dsOfficeId: true,
      dsOffice: { select: { districtId: true } },
    },
  });
  if (!u || !isRole(u.role) || !u.username) return null;
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    designation: u.designation,
    mobile: u.mobile,
    contactEmail: u.contactEmail,
    role: u.role,
    dsOfficeId: u.dsOfficeId,
    districtId: u.dsOffice?.districtId ?? null,
    active: !u.banned,
  };
}

export type OfficeChoice = { id: number; name: string; active: boolean };
export type DistrictChoice = { id: number; name: string; offices: OfficeChoice[] };

/**
 * Districts and their DS offices for the account form, by name only (ADM-3). Inactive offices are
 * included only if the account already belongs to one.
 */
export async function officeChoices(
  db: PrismaClient,
  locale: Locale,
  keepOfficeId: number | null = null,
): Promise<DistrictChoice[]> {
  const districts = await db.district.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      ...NAMES,
      dsOffices: {
        where: { OR: [{ active: true }, ...(keepOfficeId ? [{ id: keepOfficeId }] : [])] },
        orderBy: { id: "asc" },
        select: { id: true, ...NAMES, active: true },
      },
    },
  });
  return districts.map((d) => ({
    id: d.id,
    name: localName(d, locale),
    offices: d.dsOffices.map((o) => ({
      id: o.id,
      name: localName(o, locale),
      active: o.active,
    })),
  }));
}

/** Every office's name in the screen's language, active or not, for showing an account's past offices. */
export async function officeNames(db: PrismaClient, locale: Locale): Promise<Record<number, string>> {
  const offices = await db.dsOffice.findMany({ select: { id: true, ...NAMES } });
  return Object.fromEntries(offices.map((o) => [o.id, localName(o, locale)]));
}

export type HistoryEntry = {
  at: Date;
  action: string;
  actorName: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
};

/** The account's own history from the audit log, newest first (ADM-4). */
export async function accountHistory(db: PrismaClient, id: string): Promise<HistoryEntry[]> {
  const rows = await db.auditLog.findMany({
    where: { entityType: "user", entityId: id },
    orderBy: { at: "desc" },
    take: 50,
    select: { at: true, action: true, actorId: true, before: true, after: true },
  });
  const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
  const actors = new Map(
    (await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((a) => [
      a.id,
      a.name,
    ]),
  );
  return rows.map((r) => ({
    at: r.at,
    action: r.action,
    actorName: r.actorId ? (actors.get(r.actorId) ?? null) : null,
    before: r.before,
    after: r.after,
  }));
}
