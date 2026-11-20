import { ACCOUNT_SORTS, ACCOUNT_STATUSES } from "@/lib/account-filters";
import { OFFICE_TYPES } from "@/server/auth/designations";
import type { AccountFilter } from "@/server/users/queries";

/** ADM-12: the users screen's filters, in the order the address holds them. */
export const USER_FILTERS = ["q", "officeType", "provinceId", "districtId", "dsOfficeId", "status"] as const;
export type UserFilterKey = (typeof USER_FILTERS)[number];

/** The users screen's address: its filters, the sort (`sort`, `order=reversed`) and the page. */
export type UsersAddress = Record<UserFilterKey | "sort" | "order" | "page", string>;

const oneOf = <T extends string>(list: readonly T[], value: string): T | undefined =>
  list.find((item) => item === value);
const positive = (value: string) => (/^\d{1,9}$/.test(value) && Number(value) > 0 ? Number(value) : undefined);

/**
 * The address as the screen holds it, and the filter it asks `listAccounts` for. A value that isn't one is
 * left out, and so is a DS office without its district (ADM-12: the DS office is chosen within a district).
 */
export function readUsersAddress(read: (key: string) => string): { address: UsersAddress; filter: AccountFilter } {
  const address: UsersAddress = {
    q: read("q").slice(0, 100),
    officeType: read("officeType"),
    provinceId: read("provinceId"),
    districtId: read("districtId"),
    dsOfficeId: read("dsOfficeId"),
    status: read("status"),
    sort: read("sort"),
    order: read("order"),
    page: read("page"),
  };
  const districtId = positive(address.districtId);
  const sort = oneOf(ACCOUNT_SORTS, address.sort);
  return {
    address,
    filter: {
      q: address.q,
      officeType: oneOf(OFFICE_TYPES, address.officeType),
      provinceId: positive(address.provinceId),
      districtId,
      dsOfficeId: districtId ? positive(address.dsOfficeId) : undefined,
      status: oneOf(ACCOUNT_STATUSES, address.status),
      sort,
      reversed: sort !== undefined && address.order === "reversed",
      page: positive(address.page),
    },
  };
}

/**
 * The screen's address with some values changed (an empty one removes it). Any change but the page goes back
 * to the first page (ADM-12).
 */
export function usersHref(address: UsersAddress, change: Partial<UsersAddress>): string {
  const next: UsersAddress = { ...address, ...change };
  if (!("page" in change)) next.page = "";
  const query = new URLSearchParams();
  for (const key of [...USER_FILTERS, "sort", "order", "page"] as const) {
    const value = next[key];
    if (value && !(key === "page" && value === "1")) query.set(key, value);
  }
  return query.size > 0 ? `/admin/users?${query}` : "/admin/users";
}

/**
 * Removing a place takes the places within it too: a province its district and DS office, a district its DS
 * office (AC-72).
 */
export function withoutFilter(key: UserFilterKey): Partial<UsersAddress> {
  if (key === "provinceId") return { provinceId: "", districtId: "", dsOfficeId: "" };
  if (key === "districtId") return { districtId: "", dsOfficeId: "" };
  return { [key]: "" };
}

/** A heading's link: a click sorts by it, and a click on the column already sorted turns the order round. */
export function sortChange(address: UsersAddress, column: string): Partial<UsersAddress> {
  if (address.sort !== column) return { sort: column, order: "" };
  return { sort: column, order: address.order === "reversed" ? "" : "reversed" };
}
