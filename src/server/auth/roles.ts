/**
 * What an account can do (application spec, Roles and permissions). The designation decides the
 * role (designations.ts), and the admin has no designation. VIEWER can change nothing, so every check
 * that names the roles allowed to act refuses it.
 */
export const ROLES = ["DS_OFFICER", "DISTRICT_OFFICER", "MINISTRY_OFFICER", "VIEWER", "ADMIN"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** The part of the site each role works in. */
const AREA: Record<Role, string> = {
  DS_OFFICER: "/ds",
  DISTRICT_OFFICER: "/oversight",
  MINISTRY_OFFICER: "/ministry",
  VIEWER: "/oversight",
  ADMIN: "/admin",
};

const HOME: Record<Role, string> = {
  DS_OFFICER: "/ds",
  DISTRICT_OFFICER: "/oversight",
  MINISTRY_OFFICER: "/ministry",
  VIEWER: "/oversight",
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
