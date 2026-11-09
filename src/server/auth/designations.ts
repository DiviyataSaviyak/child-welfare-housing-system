import type { Role } from "./roles";

/** The six kinds of office (ADM-8). The office type isn't stored: the designation decides it. */
export const OFFICE_TYPES = ["DS", "DISTRICT", "PROVINCE", "DEPARTMENT", "MINISTRY", "ADMINISTRATOR"] as const;

export type OfficeType = (typeof OFFICE_TYPES)[number];

/**
 * ADM-8: the fixed list of designations, in the order the form offers them, each with its office type
 * and the role it gives (application spec, Roles and permissions). The database holds the same pairs
 * of role and designation in a check (migration 20261106090000_offices_and_designations), so a new one
 * needs a migration as well as its labels in the three message files.
 */
const TABLE = {
  DS_CRPO: { officeType: "DS", role: "DS_OFFICER" },
  DS_SECRETARY: { officeType: "DS", role: "VIEWER" },
  DS_ASSISTANT_SECRETARY: { officeType: "DS", role: "VIEWER" },
  DS_ACCOUNTANT: { officeType: "DS", role: "VIEWER" },
  DISTRICT_SECRETARY: { officeType: "DISTRICT", role: "VIEWER" },
  DISTRICT_ADDITIONAL_SECRETARY: { officeType: "DISTRICT", role: "VIEWER" },
  DISTRICT_CRPO: { officeType: "DISTRICT", role: "DISTRICT_OFFICER" },
  DISTRICT_CHIEF_ACCOUNTANT: { officeType: "DISTRICT", role: "VIEWER" },
  PROVINCE_COMMISSIONER: { officeType: "PROVINCE", role: "VIEWER" },
  PROVINCE_PROBATION_OFFICER: { officeType: "PROVINCE", role: "VIEWER" },
  DEPARTMENT_ASSISTANT_COMMISSIONER: { officeType: "DEPARTMENT", role: "VIEWER" },
  DEPARTMENT_COMMISSIONER: { officeType: "DEPARTMENT", role: "VIEWER" },
  MINISTRY_SECRETARY: { officeType: "MINISTRY", role: "VIEWER" },
  MINISTRY_ADDITIONAL_SECRETARY: { officeType: "MINISTRY", role: "VIEWER" },
  MINISTRY_CHIEF_ACCOUNTANT: { officeType: "MINISTRY", role: "HO_OFFICER" },
  MINISTRY_PROGRAMME_OFFICER: { officeType: "MINISTRY", role: "HO_OFFICER" },
} as const satisfies Record<string, { officeType: OfficeType; role: Role }>;

export type Designation = keyof typeof TABLE;

export const DESIGNATIONS = Object.keys(TABLE) as Designation[];

export function isDesignation(value: unknown): value is Designation {
  return typeof value === "string" && Object.hasOwn(TABLE, value);
}

export function designationsOf(officeType: OfficeType): Designation[] {
  return DESIGNATIONS.filter((designation) => TABLE[designation].officeType === officeType);
}

/** An account with no designation is an administrator. */
export function officeTypeOf(designation: Designation | null): OfficeType {
  return designation === null ? "ADMINISTRATOR" : TABLE[designation].officeType;
}

/** An account with no designation is an administrator. */
export function roleOf(designation: Designation | null): Role {
  return designation === null ? "ADMIN" : TABLE[designation].role;
}

/** The place an account of this office type belongs to, if any. */
export type PlaceKind = "dsOffice" | "district" | "province";

const PLACE: Record<OfficeType, PlaceKind | null> = {
  DS: "dsOffice",
  DISTRICT: "district",
  PROVINCE: "province",
  DEPARTMENT: null,
  MINISTRY: null,
  ADMINISTRATOR: null,
};

export function placeOf(officeType: OfficeType): PlaceKind | null {
  return PLACE[officeType];
}
