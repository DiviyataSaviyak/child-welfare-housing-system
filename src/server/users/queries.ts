import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/locales";
import { localName, NAMES, type Names } from "@/lib/names";
import { type Designation, designationsOf, isDesignation, type OfficeType, officeTypeOf } from "../auth/designations";
import { isRole, type Role } from "../auth/roles";
import { accountLabel, designationsNamed, LABEL_SELECT } from "./label";

export type AccountRow = {
  id: string;
  /** Empty when the account has no name (ADM-2). */
  name: string;
  /** The name, or the designation and place of an account with none (ADM-10). */
  label: string;
  username: string;
  officeType: OfficeType;
  designation: Designation | null;
  role: Role;
  /** Where the account belongs, in the screen's language: a DS office with its district, a district, or a province. */
  place: AccountPlace | null;
  lastSignInAt: Date | null;
  active: boolean;
};

export type AccountPlace =
  | { kind: "dsOffice"; office: string; district: string }
  | { kind: "district"; district: string }
  | { kind: "province"; province: string };

const PLACE_SELECT = {
  dsOffice: { select: { ...NAMES, district: { select: NAMES } } },
  district: { select: NAMES },
  province: { select: NAMES },
} as const;

type PlaceRow = {
  dsOffice: (Names & { district: Names }) | null;
  district: Names | null;
  province: Names | null;
};

function placeOfRow(u: PlaceRow, locale: Locale): AccountPlace | null {
  if (u.dsOffice)
    return {
      kind: "dsOffice",
      office: localName(u.dsOffice, locale),
      district: localName(u.dsOffice.district, locale),
    };
  if (u.district) return { kind: "district", district: localName(u.district, locale) };
  if (u.province) return { kind: "province", province: localName(u.province, locale) };
  return null;
}

/** Matches a place's name in any of its three languages. */
const nameMatches = (q: string) => [
  { nameSi: { contains: q } },
  { nameTa: { contains: q } },
  { nameEn: { contains: q, mode: "insensitive" as const } },
];

/** The accounts of one office type: an administrator is the one with no designation (ADM-8). */
function officeTypeWhere(officeType: OfficeType): Prisma.UserWhereInput {
  return officeType === "ADMINISTRATOR" ? { role: "ADMIN" } : { designation: { in: designationsOf(officeType) } };
}

/**
 * ADM-1: every account, searchable by name, designation (in the screen's language), office, district or
 * province (in any of their three names) or username, and filterable by office type. Places come in the
 * screen's language (UI-9).
 */
export async function listAccounts(
  db: PrismaClient,
  filter: { q?: string; officeType?: OfficeType },
  locale: Locale,
): Promise<AccountRow[]> {
  const q = filter.q?.trim();
  const where: Prisma.UserWhereInput = {
    AND: [
      filter.officeType ? officeTypeWhere(filter.officeType) : {},
      q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { username: { contains: q.toLowerCase() } },
              { designation: { in: designationsNamed(q, locale) } },
              ...nameMatches(q).flatMap((match) => [
                { dsOffice: match },
                { dsOffice: { district: match } },
                { district: match },
                { province: match },
              ]),
            ],
          }
        : {},
    ],
  };
  const users = await db.user.findMany({
    where,
    orderBy: [{ role: "asc" }, { name: "asc" }, { username: "asc" }],
    select: {
      id: true,
      username: true,
      role: true,
      banned: true,
      lastSignInAt: true,
      ...LABEL_SELECT,
      ...PLACE_SELECT,
    },
  });
  return users.flatMap((u) => {
    if (!isRole(u.role) || !u.username) return [];
    const designation = isDesignation(u.designation) ? u.designation : null;
    return [
      {
        id: u.id,
        name: u.name,
        label: accountLabel(u, locale),
        username: u.username,
        officeType: officeTypeOf(designation),
        designation,
        role: u.role,
        place: placeOfRow(u, locale),
        lastSignInAt: u.lastSignInAt,
        active: !u.banned,
      },
    ];
  });
}

export async function accountCounts(db: PrismaClient): Promise<{ total: number; active: number; disabled: number }> {
  const [total, disabled] = await Promise.all([db.user.count(), db.user.count({ where: { banned: true } })]);
  return { total, active: total - disabled, disabled };
}

export async function activeAdminCount(db: PrismaClient | Prisma.TransactionClient): Promise<number> {
  return db.user.count({ where: { role: "ADMIN", banned: false } });
}

export type AccountDetails = {
  id: string;
  name: string;
  username: string;
  officeType: OfficeType;
  designation: Designation | null;
  mobile: string | null;
  contactEmail: string | null;
  role: Role;
  dsOfficeId: number | null;
  /** The account's own district, or its DS office's district. */
  districtId: number | null;
  provinceId: number | null;
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
      districtId: true,
      provinceId: true,
      dsOffice: { select: { districtId: true } },
    },
  });
  if (!u || !isRole(u.role) || !u.username) return null;
  const designation = isDesignation(u.designation) ? u.designation : null;
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    officeType: officeTypeOf(designation),
    designation,
    mobile: u.mobile,
    contactEmail: u.contactEmail,
    role: u.role,
    dsOfficeId: u.dsOfficeId,
    districtId: u.districtId ?? u.dsOffice?.districtId ?? null,
    provinceId: u.provinceId,
    active: !u.banned,
  };
}

/** ADM-10: how the account with this username is shown, in the screen's language. */
export async function labelOf(db: PrismaClient, username: string, locale: Locale): Promise<string> {
  const u = await db.user.findUniqueOrThrow({ where: { username }, select: LABEL_SELECT });
  return accountLabel(u, locale);
}

export type Profile = {
  /** Empty when the officer has none (ADM-11). */
  name: string;
  username: string;
  officeType: OfficeType;
  designation: Designation | null;
  mobile: string | null;
  contactEmail: string | null;
  role: Role;
  /** In the screen's language; the profile shows it but can't change it (ADM-11). */
  place: AccountPlace | null;
};

/** The signed-in user's own account, for the profile pop-up; the place in the screen's language. */
export async function getProfile(db: PrismaClient, userId: string, locale: Locale): Promise<Profile | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      username: true,
      designation: true,
      mobile: true,
      contactEmail: true,
      role: true,
      ...PLACE_SELECT,
    },
  });
  if (!u || !isRole(u.role) || !u.username) return null;
  const designation = isDesignation(u.designation) ? u.designation : null;
  return {
    name: u.name,
    username: u.username,
    officeType: officeTypeOf(designation),
    designation,
    mobile: u.mobile,
    contactEmail: u.contactEmail,
    role: u.role,
    place: placeOfRow(u, locale),
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

export type PlaceChoice = { id: number; name: string };

/** The provinces for the account form, in the screen's language. */
export async function provinceChoices(db: PrismaClient, locale: Locale): Promise<PlaceChoice[]> {
  const provinces = await db.province.findMany({ orderBy: { id: "asc" }, select: { id: true, ...NAMES } });
  return provinces.map((p) => ({ id: p.id, name: localName(p, locale) }));
}

export type PlaceNames = {
  offices: Record<number, string>;
  districts: Record<number, string>;
  provinces: Record<number, string>;
};

/** Every place's name in the screen's language, active or not, for showing an account's past places. */
export async function placeNames(db: PrismaClient, locale: Locale): Promise<PlaceNames> {
  const [offices, districts, provinces] = await Promise.all([
    db.dsOffice.findMany({ select: { id: true, ...NAMES } }),
    db.district.findMany({ select: { id: true, ...NAMES } }),
    db.province.findMany({ select: { id: true, ...NAMES } }),
  ]);
  const byId = (rows: (Names & { id: number })[]) => Object.fromEntries(rows.map((r) => [r.id, localName(r, locale)]));
  return { offices: byId(offices), districts: byId(districts), provinces: byId(provinces) };
}

export type HistoryEntry = {
  at: Date;
  action: string;
  /** The actor's name, or designation and place (ADM-10); null for the system. */
  actorName: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
};

/** The account's own history from the audit log, newest first (ADM-4). */
export async function accountHistory(db: PrismaClient, id: string, locale: Locale): Promise<HistoryEntry[]> {
  const rows = await db.auditLog.findMany({
    where: { entityType: "user", entityId: id },
    orderBy: { at: "desc" },
    take: 50,
    select: { at: true, action: true, actorId: true, before: true, after: true },
  });
  const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
  const actors = new Map(
    (await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, ...LABEL_SELECT } })).map((a) => [
      a.id,
      accountLabel(a, locale),
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
