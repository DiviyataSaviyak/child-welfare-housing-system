import { NOT_ALLOCATED_STATUSES } from "@/components/cases/list-filters";
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

/**
 * HOME-2: the DS officer's list from the address, a tab and a search. The home page and its Excel
 * export (EXP-1) both read it here, so the file holds the cases the screen shows. An amendment tab lists
 * amendments instead (AMD-9): it has no search and no file, so `amendments` names the status and the
 * case filter is unused.
 */
export function readHomeList(params: { tab?: unknown; q?: unknown }): {
  tab: Tab;
  q: string;
  filter: Omit<CaseFilter, "page">;
  amendments: AmendmentStatus | null;
} {
  const tab: Tab = isTab(params.tab) ? params.tab : "all";
  if (isAmendmentTab(tab)) return { tab, q: "", filter: { q: "" }, amendments: amendmentStatusOf(tab) };
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  return { tab, q, filter: { ...tabFilter(tab), q }, amendments: null };
}
