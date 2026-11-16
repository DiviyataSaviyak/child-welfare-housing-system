import type { AmendmentStatus } from "@/generated/prisma/enums";
import type { Audience } from "../cases/case-view";

/** AMD-9: the amendments list's tabs as the address names them (`?tab=approved`), and the status each lists. */
const TAB_STATUS = { waiting: "WAITING", approved: "APPROVED", rejected: "REJECTED" } as const satisfies Record<
  string,
  AmendmentStatus
>;
type TabKey = keyof typeof TAB_STATUS;
const TAB_KEY = { WAITING: "waiting", APPROVED: "approved", REJECTED: "rejected" } as const satisfies Record<
  AmendmentStatus,
  TabKey
>;

/** The tab the address asks for; the waiting one, the queue, for anything else. */
export function readAmendmentTab(value: unknown): AmendmentStatus {
  return typeof value === "string" && Object.hasOwn(TAB_STATUS, value) ? TAB_STATUS[value as TabKey] : "WAITING";
}

/**
 * The reader's own list of amendments, on the tab of one status (AMD-9): the DS's is under its home page's
 * tabs (HOME-2), the Ministry's and the view-only accounts' a screen of its own. The dashboard links here
 * (DSH-1).
 */
export function amendmentsHref(audience: Audience, status: AmendmentStatus, page = 1): string {
  const query = new URLSearchParams();
  if (audience === "ds") {
    query.set(
      "tab",
      { WAITING: "amendmentsWaiting", APPROVED: "amendmentsApproved", REJECTED: "amendmentsRejected" }[status],
    );
  } else if (status !== "WAITING") {
    query.set("tab", TAB_KEY[status]);
  }
  if (page > 1) query.set("page", String(page));
  const path = audience === "ds" ? "/ds" : `/${audience}/amendments`;
  return query.size > 0 ? `${path}?${query}` : path;
}
