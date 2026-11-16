import { AppShell } from "@/components/shell/app-shell";
import { amendmentsWaiting } from "@/server/amendments/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { awaitingAllocation } from "@/server/releases/queries";

/**
 * The menu shows how many cases await the Ministry's allocation (NTF-1, REL-1) and how many amendments
 * await its decision (AMD-9). A layout isn't rendered again on a client-side move: the actions that change
 * a count refresh it with revalidatePath, and the menu reads each count again from /ministry/waiting and
 * /ministry/amendments/waiting after every move, so it agrees with the page beside it.
 */
export default async function HoLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("MINISTRY_OFFICER");
  const [waiting, amendments] = await Promise.all([awaitingAllocation(db, context), amendmentsWaiting(db, context)]);
  return (
    <AppShell
      area="ministry"
      userName={context.label}
      nav={[
        { href: "/ministry", labelKey: "ministryDashboard", exact: true },
        { href: "/ministry/cases", labelKey: "ministryCases" },
        {
          href: "/ministry/allocate",
          labelKey: "ministryAllocate",
          count: { ...waiting, source: "/ministry/waiting" },
        },
        {
          href: "/ministry/amendments",
          labelKey: "ministryAmendments",
          count: { ...amendments, source: "/ministry/amendments/waiting" },
          countWords: "amendmentsWaiting",
        },
      ]}
    >
      {children}
    </AppShell>
  );
}
