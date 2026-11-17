import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/locales";
import { ACCOUNTS_PER_PAGE, type AccountSort, type AccountStatus } from "@/lib/account-filters";
import { localName, NAMES, type Names } from "@/lib/names";
import { type Designation, isDesignation, OFFICE_TYPES, type OfficeType, officeTypeOf } from "../auth/designations";
import { isRole, type Role } from "../auth/roles";
import { accountLabel, LABEL_SELECT } from "./label";

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

export type AccountFilter = {
  q?: string;
  officeType?: OfficeType;
  provinceId?: number;
  districtId?: number;
  dsOfficeId?: number;
  status?: AccountStatus;
  sort?: AccountSort;
  /** Turns the sort round. */
  reversed?: boolean;
  /** From 1. */
  page?: number;
};

export type AccountList = {
  rows: AccountRow[];
  /** How many accounts the filters leave, over every page. */
  total: number;
  /** The page shown: a page past the end shows the last. */
  page: number;
  /** ADM-12: how many accounts each choice would leave, under the other filters. */
  counts: {
    /** Each office type's tab, under the places, status and search; `all` is the first tab. */
    officeTypes: Record<OfficeType | "all", number>;
    /** Each place, under the office type, status and search, but not the places chosen. */
    provinces: Record<number, number>;
    districts: Record<number, number>;
    dsOffices: Record<number, number>;
  };
};

/** Where an account is (ADM-12): its DS office, district and province, as far as it has them. */
type Whereabouts = { provinceId: number | null; districtId: number | null; dsOfficeId: number | null };

function whereabouts(u: {
  dsOfficeId: number | null;
  districtId: number | null;
  provinceId: number | null;
  dsOffice: { districtId: number; district: { provinceId: number } } | null;
  district: { provinceId: number } | null;
}): Whereabouts {
  if (u.dsOffice)
    return { provinceId: u.dsOffice.district.provinceId, districtId: u.dsOffice.districtId, dsOfficeId: u.dsOfficeId };
  if (u.district) return { provinceId: u.district.provinceId, districtId: u.districtId, dsOfficeId: null };
  return { provinceId: u.provinceId, districtId: null, dsOfficeId: null };
}

function statusWhere(status: AccountStatus | undefined): Prisma.UserWhereInput {
  if (status === "active") return { banned: false };
  if (status === "disabled") return { banned: true };
  if (status === "neverSignedIn") return { banned: false, lastSignInAt: null };
  return {};
}

function countIn(counts: Record<number, number>, id: number | null) {
  if (id !== null) counts[id] = (counts[id] ?? 0) + 1;
}

/** The accounts with no place first, then by province, district and DS office, each in the lists' order. */
const byPlace = (a: Whereabouts, b: Whereabouts) =>
  (a.provinceId ?? 0) - (b.provinceId ?? 0) ||
  (a.districtId ?? 0) - (b.districtId ?? 0) ||
  (a.dsOfficeId ?? 0) - (b.dsOfficeId ?? 0);

type Listed = { row: AccountRow; at: Whereabouts };

/**
 * ADM-1, ADM-12: one page of the accounts, searchable by name or username and filtered by office type, place
 * and status, with the total and each choice's count. Places come in the screen's language (UI-9).
 *
 * The admin has some 1,500 accounts at most, so the database is asked for the search and the status, and the
 * rest is done here: the places, which follow a DS officer's office up to its district and province, the
 * counts of every choice at once, and the sort by the label the screen shows (ADM-10).
 */
export async function listAccounts(db: PrismaClient, filter: AccountFilter, locale: Locale): Promise<AccountList> {
  const q = filter.q?.trim();
  const users = await db.user.findMany({
    where: {
      AND: [
        statusWhere(filter.status),
        q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { username: { contains: q.toLowerCase() } }] } : {},
      ],
    },
    select: {
      id: true,
      username: true,
      role: true,
      banned: true,
      lastSignInAt: true,
      dsOfficeId: true,
      districtId: true,
      provinceId: true,
      ...LABEL_SELECT,
      dsOffice: { select: { ...NAMES, districtId: true, district: { select: { ...NAMES, provinceId: true } } } },
      district: { select: { ...NAMES, provinceId: true } },
    },
  });

  const counts: AccountList["counts"] = {
    officeTypes: { all: 0, DS: 0, DISTRICT: 0, PROVINCE: 0, DEPARTMENT: 0, MINISTRY: 0, ADMINISTRATOR: 0 },
    provinces: {},
    districts: {},
    dsOffices: {},
  };
  const inPlace = (at: Whereabouts) =>
    (!filter.provinceId || at.provinceId === filter.provinceId) &&
    (!filter.districtId || at.districtId === filter.districtId) &&
    (!filter.dsOfficeId || at.dsOfficeId === filter.dsOfficeId);

  const chosen: Listed[] = [];
  for (const u of users) {
    if (!isRole(u.role) || !u.username) continue;
    const designation = isDesignation(u.designation) ? u.designation : null;
    const officeType = officeTypeOf(designation);
    const at = whereabouts(u);
    const placed = inPlace(at);
    if (placed) {
      counts.officeTypes.all += 1;
      counts.officeTypes[officeType] += 1;
    }
    if (filter.officeType && officeType !== filter.officeType) continue;
    countIn(counts.provinces, at.provinceId);
    countIn(counts.districts, at.districtId);
    countIn(counts.dsOffices, at.dsOfficeId);
    if (!placed) continue;
    chosen.push({
      at,
      row: {
        id: u.id,
        name: u.name,
        label: accountLabel(u, locale),
        username: u.username,
        officeType,
        designation,
        role: u.role,
        place: placeOfRow(u, locale),
        lastSignInAt: u.lastSignInAt,
        active: !u.banned,
      },
    });
  }

  const collator = new Intl.Collator(locale);
  const byName = (a: Listed, b: Listed) =>
    collator.compare(a.row.label, b.row.label) || a.row.username.localeCompare(b.row.username);
  const orders: Record<AccountSort | "place", (a: Listed, b: Listed) => number> = {
    place: (a, b) => byPlace(a.at, b.at) || byName(a, b),
    name: byName,
    office: (a, b) =>
      OFFICE_TYPES.indexOf(a.row.officeType) - OFFICE_TYPES.indexOf(b.row.officeType) ||
      byPlace(a.at, b.at) ||
      byName(a, b),
    // The latest first; an account that has never signed in counts as the earliest.
    lastSignIn: (a, b) => (b.row.lastSignInAt?.getTime() ?? 0) - (a.row.lastSignInAt?.getTime() ?? 0) || byName(a, b),
  };
  const order = orders[filter.sort ?? "place"];
  chosen.sort(filter.reversed ? (a, b) => order(b, a) : order);

  const total = chosen.length;
  const page = Math.min(Math.max(1, filter.page ?? 1), Math.max(1, Math.ceil(total / ACCOUNTS_PER_PAGE)));
  const rows = chosen.slice((page - 1) * ACCOUNTS_PER_PAGE, page * ACCOUNTS_PER_PAGE).map((a) => a.row);
  return { rows, total, page, counts };
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

export type PlaceFilterChoices = {
  provinces: PlaceChoice[];
  districts: (PlaceChoice & { provinceId: number })[];
  /** The chosen district's DS offices, active or not, since an inactive office may still have accounts. */
  dsOffices: (PlaceChoice & { active: boolean })[];
};

/** ADM-12: the users screen's place filters, in the screen's language and the lists' order. */
export async function placeFilterChoices(
  db: PrismaClient,
  locale: Locale,
  districtId: number | undefined,
): Promise<PlaceFilterChoices> {
  const [provinces, districts, dsOffices] = await Promise.all([
    db.province.findMany({ orderBy: { id: "asc" }, select: { id: true, ...NAMES } }),
    db.district.findMany({ orderBy: { id: "asc" }, select: { id: true, provinceId: true, ...NAMES } }),
    districtId
      ? db.dsOffice.findMany({
          where: { districtId },
          orderBy: { id: "asc" },
          select: { id: true, active: true, ...NAMES },
        })
      : [],
  ]);
  return {
    provinces: provinces.map((p) => ({ id: p.id, name: localName(p, locale) })),
    districts: districts.map((d) => ({ id: d.id, provinceId: d.provinceId, name: localName(d, locale) })),
    dsOffices: dsOffices.map((o) => ({ id: o.id, active: o.active, name: localName(o, locale) })),
  };
}

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
