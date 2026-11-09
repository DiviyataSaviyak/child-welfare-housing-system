import { CaseStatus } from "@/generated/prisma/enums";
import { CATEGORIES, KINDS } from "@/lib/validation/case";
import type { CaseFilter } from "@/server/cases/queries";

export const STATUSES = Object.values(CaseStatus);
export const FILTERS = ["q", "districtId", "dsOfficeId", "status", "category", "kind"] as const;

/** The filters as the address holds them. */
export type FilterValues = Record<(typeof FILTERS)[number], string>;

const oneOf = <T extends string>(list: readonly T[], value: string): T | undefined =>
  list.find((item) => item === value);
export const positive = (value: string) => (/^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined);

/**
 * FND-1: the case list's filters from the address, and the search they make. The list page and its
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
  };
  const status = oneOf(STATUSES, values.status);
  return {
    values,
    filter: {
      q: values.q,
      districtId: positive(values.districtId),
      dsOfficeId: positive(values.dsOfficeId),
      statuses: status ? [status] : undefined,
      category: oneOf(CATEGORIES, values.category),
      kind: oneOf(KINDS, values.kind),
    },
  };
}

/** The filters in use as an address query, without the page. */
export function filterQuery(values: FilterValues): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of FILTERS) if (values[key]) query.set(key, values[key]);
  return query;
}
