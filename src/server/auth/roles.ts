/** The three roles of version 1 (application spec, Roles and permissions). */
export const ROLES = ["DS_OFFICER", "HO_OFFICER", "ADMIN"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** The part of the site each role works in. */
const AREA: Record<Role, string> = {
  DS_OFFICER: "/ds",
  HO_OFFICER: "/ho",
  ADMIN: "/admin",
};

const HOME: Record<Role, string> = {
  DS_OFFICER: "/ds",
  HO_OFFICER: "/ho",
  ADMIN: "/admin/users",
};

/** Where a role lands after signing in. */
export function homeFor(role: Role): string {
  return HOME[role];
}

/**
 * The page to return to after signing in (ERR-4), if it is safe: a path inside this role's own area.
 * Anything else (another site, another role's pages, odd input) gives null, and the caller uses homeFor().
 */
export function safeReturnPath(value: unknown, role: Role): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return null;
  const path = value.split(/[?#]/)[0];
  const area = AREA[role];
  return path === area || path.startsWith(`${area}/`) ? value : null;
}
