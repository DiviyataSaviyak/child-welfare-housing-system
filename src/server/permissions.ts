import type { Prisma } from "@/generated/prisma/client";
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

/** A DS office with the places above it. Select it with `OFFICE_PLACE`. */
export type OfficePlace = { id: number; districtId: number; district: { provinceId: number } };

export const OFFICE_PLACE = {
  select: { id: true, districtId: true, district: { select: { provinceId: true } } },
} as const;

/**
 * A case's two offices (CASE-13): the DS office where the beneficiary lives, which entered the case,
 * and the DS office where the house is built or the land bought, which pays the installments. They are
 * the same office unless the form said otherwise. Select them with `CASE_PLACES`.
 */
export type CasePlaces = { dsOffice: OfficePlace; buildDsOffice: OfficePlace };

export const CASE_PLACES = { dsOffice: OFFICE_PLACE, buildDsOffice: OFFICE_PLACE } as const;

/** Which of a case's offices a rule means: where the beneficiary lives, or where the house is built. */
export type CaseOffice = "residence" | "built";

/** What an office does to a case, each through one of its two offices (`actingOffice`). */
export type CaseAction = "edit" | "delete" | "installment" | "stage" | "release";

const ACTING: Record<CaseAction, CaseOffice> = {
  // CASE-8, CASE-9: the DS of residence entered the case, so it corrects or deletes it.
  edit: "residence",
  delete: "residence",
  // CASE-13: the DS where it is built pays the installments and records the stages.
  installment: "built",
  stage: "built",
  // REL-6, REL-9: the District where it is built releases it to that DS.
  release: "built",
};

/** Which of the two offices an action goes through (CASE-13). */
export function actingOffice(action: CaseAction): CaseOffice {
  return ACTING[action];
}

const officeOf = (places: CasePlaces, which: CaseOffice) =>
  which === "residence" ? places.dsOffice : places.buildDsOffice;

function inScope(scope: CaseScope, office: OfficePlace): boolean {
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

/**
 * Whether the viewer may see the case (PRM-1, PRM-4): one of its two offices is in their area, so the
 * DS of residence and the DS where it is built both see it, and so do both districts.
 */
export function canSeeCase(viewer: Viewer, places: CasePlaces): boolean {
  const scope = caseScope(viewer);
  return inScope(scope, places.dsOffice) || inScope(scope, places.buildDsOffice);
}

/**
 * Whether the action's office (`actingOffice`) is in the viewer's area: only the DS whose turn it is
 * has the action, though both offices see the case (CASE-13). It says nothing about the role or the
 * status: the commands check those as before (rules.ts, transitions.ts). A Ministry officer's area is
 * every office, so this never stops one.
 */
export function canActOn(viewer: Viewer, places: CasePlaces, action: CaseAction): boolean {
  return inScope(caseScope(viewer), officeOf(places, actingOffice(action)));
}

/** A `where` on one of a case's offices that keeps the scope's area, or null for none. */
function officeWhere(scope: CaseScope, which: CaseOffice): Prisma.CaseWhereInput | null {
  const id = which === "residence" ? "dsOfficeId" : "buildDsOfficeId";
  const relation = which === "residence" ? "dsOffice" : "buildDsOffice";
  switch (scope.kind) {
    case "all":
      return {};
    case "office":
      return { [id]: scope.dsOfficeId };
    case "district":
      return { [relation]: { districtId: scope.districtId } };
    case "province":
      return { [relation]: { district: { provinceId: scope.provinceId } } };
    case "none":
      return null;
  }
}

/**
 * A Prisma `where` fragment that limits a case query to what the viewer may see: either office in
 * their area (PRM-1, PRM-4). With `which`, only that office counts, as for the money, which is counted
 * where the house is built (CASE-13), or for a list of what one office has to do.
 * Returns null when the viewer may see no cases at all; callers then answer "not found".
 * It may hold an `OR`, so combine it with other conditions through `AND`, or spread it only beside
 * fields that aren't `OR`.
 */
export function officeFilter(viewer: Viewer, which?: CaseOffice): Prisma.CaseWhereInput | null {
  const scope = caseScope(viewer);
  if (which) return officeWhere(scope, which);
  if (scope.kind === "none") return null;
  if (scope.kind === "all") return {};
  return { OR: [officeWhere(scope, "residence")!, officeWhere(scope, "built")!] };
}
