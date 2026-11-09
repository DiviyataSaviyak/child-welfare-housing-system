import { isDesignation, officeTypeOf, roleOf } from "./auth/designations";
import type { Role } from "./auth/roles";

/**
 * Who is asking: enough to decide which cases they may see. Read from the account on every request
 * (PRM-3), so a new designation or place applies at once.
 */
export type Viewer = {
  role: Role;
  designation: string | null;
  dsOfficeId: number | null;
  districtId: number | null;
  provinceId: number | null;
};

/**
 * Which DS offices' cases a viewer may see (PRM-1, PRM-2, PRM-4): their own office, district or
 * province, or every office. An admin sees none.
 */
export type CaseScope =
  | { kind: "all" }
  | { kind: "office"; dsOfficeId: number }
  | { kind: "district"; districtId: number }
  | { kind: "province"; provinceId: number }
  | { kind: "none" };

/**
 * The scope follows the designation's office type, never whichever place happens to be filled in, so a
 * view-only account of a DS sees its office whatever else the row holds. Anything that doesn't add up
 * (an unknown designation, one that doesn't go with the role, a missing place) sees nothing rather
 * than everything. The database refuses such accounts too (app_user_designation_check,
 * app_user_place_check).
 */
export function caseScope(viewer: Viewer): CaseScope {
  if (viewer.role === "ADMIN" || !isDesignation(viewer.designation)) return { kind: "none" };
  if (roleOf(viewer.designation) !== viewer.role) return { kind: "none" };
  switch (officeTypeOf(viewer.designation)) {
    case "DS":
      return viewer.dsOfficeId === null ? { kind: "none" } : { kind: "office", dsOfficeId: viewer.dsOfficeId };
    case "DISTRICT":
      return viewer.districtId === null ? { kind: "none" } : { kind: "district", districtId: viewer.districtId };
    case "PROVINCE":
      return viewer.provinceId === null ? { kind: "none" } : { kind: "province", provinceId: viewer.provinceId };
    case "DEPARTMENT":
    case "MINISTRY":
      return { kind: "all" };
    case "ADMINISTRATOR":
      return { kind: "none" };
  }
}

/** A DS office with the places above it, as `canSeeOffice` needs it. Select it with `OFFICE_PLACE`. */
export type OfficePlace = { id: number; districtId: number; district: { provinceId: number } };

export const OFFICE_PLACE = {
  select: { id: true, districtId: true, district: { select: { provinceId: true } } },
} as const;

export function canSeeOffice(viewer: Viewer, office: OfficePlace): boolean {
  const scope = caseScope(viewer);
  switch (scope.kind) {
    case "all":
      return true;
    case "office":
      return scope.dsOfficeId === office.id;
    case "district":
      return scope.districtId === office.districtId;
    case "province":
      return scope.provinceId === office.district.provinceId;
    case "none":
      return false;
  }
}

/** A `where` on a case that keeps the viewer's area: by its office, or through the office's district. */
export type OfficeWhere = {
  dsOfficeId?: number;
  dsOffice?: { districtId: number } | { district: { provinceId: number } };
};

/**
 * A Prisma `where` fragment that limits a case query to what the viewer may see.
 * Returns null when the viewer may see no cases at all; callers then answer "not found".
 */
export function officeFilter(viewer: Viewer): OfficeWhere | null {
  const scope = caseScope(viewer);
  switch (scope.kind) {
    case "all":
      return {};
    case "office":
      return { dsOfficeId: scope.dsOfficeId };
    case "district":
      return { dsOffice: { districtId: scope.districtId } };
    case "province":
      return { dsOffice: { district: { provinceId: scope.provinceId } } };
    case "none":
      return null;
  }
}
