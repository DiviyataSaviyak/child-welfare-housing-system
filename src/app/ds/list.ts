import { type FilterValues, NOT_ALLOCATED_STATUSES, readCategory, readPeriod } from "@/components/cases/list-filters";
import type { AmendmentStatus } from "@/generated/prisma/enums";
import type { CaseFilter } from "@/server/cases/queries";

/**
 * HOME-2: the home page's tabs, in order: five of cases, then, set apart, the three of amendments (AMD-9).
 * A replaced case is under "all" only.
 */
export const TABS = [
  "all",
  "notAllocated",
  "received",
  "inProgress",
  "completed",
  "amendmentsWaiting",
  "amendmentsApproved",
  "amendmentsRejected",
] as const;
export type Tab = (typeof TABS)[number];

/** The amendment tabs and the status each lists (AMD-9). */
const AMENDMENT_TABS = {
  amendmentsWaiting: "WAITING",
  amendmentsApproved: "APPROVED",
  amendmentsRejected: "REJECTED",
} as const satisfies Partial<Record<Tab, AmendmentStatus>>;
export type AmendmentTab = keyof typeof AMENDMENT_TABS;
export type CaseTab = Exclude<Tab, AmendmentTab>;

export const CASE_TABS = TABS.filter((tab): tab is CaseTab => !isAmendmentTab(tab));

const isTab = (value: unknown): value is Tab => TABS.includes(value as Tab);
export function isAmendmentTab(tab: Tab): tab is AmendmentTab {
  return Object.hasOwn(AMENDMENT_TABS, tab);
}

/** The amendments an amendment tab lists. */
export function amendmentStatusOf(tab: AmendmentTab): AmendmentStatus {
  return AMENDMENT_TABS[tab];
}

/** The cases a case tab shows. */
export function tabFilter(tab: CaseTab): Omit<CaseFilter, "q" | "page"> {
  switch (tab) {
    case "all":
      return {};
    case "notAllocated":
      // The cases whose money hasn't reached the DS yet.
      return { statuses: [...NOT_ALLOCATED_STATUSES] };
    case "received":
      return { statuses: ["ALLOCATION_RECEIVED"] };
    case "inProgress":
      return { statuses: ["IN_PROGRESS"] };
    case "completed":
      return { statuses: ["COMPLETED"] };
  }
}

/** The DS's list offers only these of the case list's filters; its tabs take the status's place (HOME-2, EXP-4). */
export const HOME_FILTERS = ["q", "category", "from", "until"] as const satisfies (keyof FilterValues)[];

const text = (value: unknown, length = 100) => (typeof value === "string" ? value.slice(0, length) : "");

/**
 * HOME-2, EXP-4: the DS officer's list from the address: a tab, a search, the category and the period. The
 * home page and its Excel export (EXP-1) both read it here, so the file holds the cases the screen shows.
 * `values` are the filters as the form shows them, the others empty. An amendment tab lists amendments
 * instead (AMD-9): it has no filters and no file, so `amendments` names the status and the case filter is
 * unused.
 */
export function readHomeList(params: {
  tab?: unknown;
  q?: unknown;
  category?: unknown;
  from?: unknown;
  until?: unknown;
}): {
  tab: Tab;
  q: string;
  values: FilterValues;
  filter: Omit<CaseFilter, "page">;
  amendments: AmendmentStatus | null;
} {
  const tab: Tab = isTab(params.tab) ? params.tab : "all";
  const values: FilterValues = {
    q: "",
    districtId: "",
    dsOfficeId: "",
    status: "",
    category: "",
    kind: "",
    from: "",
    until: "",
  };
  if (isAmendmentTab(tab)) return { tab, q: "", values, filter: { q: "" }, amendments: amendmentStatusOf(tab) };
  for (const key of HOME_FILTERS) values[key] = text(params[key]);
  const category = readCategory(values.category);
  return {
    tab,
    q: values.q,
    values,
    filter: {
      ...tabFilter(tab),
      q: values.q,
      ...(category && { category }),
      ...readPeriod(values.from, values.until),
    },
    amendments: null,
  };
}
