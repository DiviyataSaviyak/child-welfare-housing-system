import type { Role } from "./auth/roles";

/** Who is asking: enough to decide which cases they may see. */
export type Viewer = { role: Role; dsOfficeId: number | null };

/**
 * Which DS offices' cases a viewer may see (PRM-1, PRM-2):
 * a DS officer sees only their own office, Head Office sees every office, an admin sees none.
 */
export type CaseScope = { kind: "all" } | { kind: "office"; dsOfficeId: number } | { kind: "none" };

export function caseScope(viewer: Viewer): CaseScope {
  switch (viewer.role) {
    case "HO_OFFICER":
      return { kind: "all" };
    case "DS_OFFICER":
      // A DS officer without an office is a broken account: show nothing rather than everything.
      return viewer.dsOfficeId === null ? { kind: "none" } : { kind: "office", dsOfficeId: viewer.dsOfficeId };
    case "DISTRICT_OFFICER":
    case "VIEWER":
    case "ADMIN":
      return { kind: "none" };
  }
}

export function canSeeOffice(viewer: Viewer, dsOfficeId: number): boolean {
  const scope = caseScope(viewer);
  return scope.kind === "all" || (scope.kind === "office" && scope.dsOfficeId === dsOfficeId);
}

/**
 * A Prisma `where` fragment that limits a query to what the viewer may see.
 * Returns null when the viewer may see no cases at all; callers then answer "not found".
 */
export function officeFilter(viewer: Viewer): { dsOfficeId?: number } | null {
  const scope = caseScope(viewer);
  if (scope.kind === "none") return null;
  return scope.kind === "all" ? {} : { dsOfficeId: scope.dsOfficeId };
}
