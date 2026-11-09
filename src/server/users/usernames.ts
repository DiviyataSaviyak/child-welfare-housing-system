import type { OfficeType } from "../auth/designations";

/** ADM-2: a username is the office type's prefix plus at least 4 digits, such as ds0101. */
export const USERNAME_PREFIX: Record<OfficeType, string> = {
  DS: "ds",
  DISTRICT: "dt",
  PROVINCE: "pv",
  DEPARTMENT: "pd",
  MINISTRY: "ho",
  ADMINISTRATOR: "ad",
};

/** The next free username for an office type, one above the highest number already used with that prefix. */
export function nextUsername(officeType: OfficeType, existing: readonly string[]): string {
  const prefix = USERNAME_PREFIX[officeType];
  const pattern = new RegExp(`^${prefix}(\\d{4,})$`);
  let highest = 0;
  for (const username of existing) {
    const match = pattern.exec(username);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}
