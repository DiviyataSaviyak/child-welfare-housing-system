import { CaseStatus } from "@/generated/prisma/enums";
import { addDays, addMonths, parseDay } from "@/lib/dates";
import { CATEGORIES, KINDS } from "@/lib/validation/case";
import type { CaseFilter } from "@/server/cases/queries";

export const STATUSES = Object.values(CaseStatus);

/**
 * FND-1, HOME-2: "not yet allocated", the cases whose money hasn't reached the DS, as one choice of the status
 * filter (`NOT_ALLOCATED`) and one tab of the DS's list.
 */
export const NOT_ALLOCATED_STATUSES = ["AWAITING_ALLOCATION", "ALLOCATED_TO_DISTRICT"] as const satisfies CaseStatus[];
export const NOT_ALLOCATED = "NOT_ALLOCATED";
export const FILTERS = ["q", "districtId", "dsOfficeId", "status", "category", "kind", "from", "until"] as const;

/** The filters as the address holds them. */
export type FilterValues = Record<(typeof FILTERS)[number], string>;

const oneOf = <T extends string>(list: readonly T[], value: string): T | undefined =>
  list.find((item) => item === value);
export const positive = (value: string) => (/^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined);

/** EXP-4: the category filter, both when the address names none or something else. */
export const readCategory = (value: string) => oneOf(CATEGORIES, value);

/**
 * EXP-4: the period, the days a case was entered ("YYYY-MM-DD", from and until, both in), each optional.
 * A day that isn't one is left out, and a pair whose "until" is before its "from" is left out whole, as a
 * bad status is: the list doesn't guess which of the two was meant.
 */
export function readPeriod(from: string, until: string): Pick<CaseFilter, "enteredFrom" | "enteredUntil"> {
  const enteredFrom = parseDay(from) ?? undefined;
  const enteredUntil = parseDay(until) ?? undefined;
  if (enteredFrom && enteredUntil && enteredUntil < enteredFrom) return {};
  return { ...(enteredFrom && { enteredFrom }), ...(enteredUntil && { enteredUntil }) };
}

/** EXP-4's three shortcuts and the months each covers. */
export const PERIODS = { month: 1, twoMonths: 2, year: 12 } as const;
export type Period = keyof typeof PERIODS;

/**
 * A shortcut's days, ending today (ARC-6): one month is 17 Oct to 16 Nov, so a month's cases are counted
 * once, as a calendar month's are (1 to 31 Oct).
 */
export function periodDays(period: Period, today: string): { from: string; until: string } {
  return { from: addDays(addMonths(today, -PERIODS[period]), 1), until: today };
}

/**
 * FND-1, EXP-4: the case list's filters from the address, and the search they make. The list page and its
 * Excel export (EXP-1) both read them here, so the file holds the cases the screen shows.
 */
export function readFilters(read: (key: string) => string): { values: FilterValues; filter: Omit<CaseFilter, "page"> } {
  const values: FilterValues = {
    q: read("q").slice(0, 100),
    districtId: read("districtId"),
    dsOfficeId: read("dsOfficeId"),
    status: read("status"),
    category: read("category"),
    kind: read("kind"),
    from: read("from"),
    until: read("until"),
  };
  const status = oneOf(STATUSES, values.status);
  const statuses = values.status === NOT_ALLOCATED ? [...NOT_ALLOCATED_STATUSES] : status ? [status] : undefined;
  return {
    values,
    filter: {
      q: values.q,
      districtId: positive(values.districtId),
      dsOfficeId: positive(values.dsOfficeId),
      statuses,
      category: readCategory(values.category),
      kind: oneOf(KINDS, values.kind),
      ...readPeriod(values.from, values.until),
    },
  };
}

/** The filters in use as an address query, without the page. */
export function filterQuery(values: FilterValues): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of FILTERS) if (values[key]) query.set(key, values[key]);
  return query;
}
