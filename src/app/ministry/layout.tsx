import { AppShell } from "@/components/shell/app-shell";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { awaitingAllocation } from "@/server/releases/queries";

/**
 * The menu shows how many cases await the Ministry's allocation (NTF-1, REL-1). A layout isn't rendered
 * again on a client-side move: the actions that change the count refresh it with revalidatePath, and the
 * menu reads the count again from /ministry/waiting after every move, so it agrees with the page beside it.
 */
export default async function HoLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("MINISTRY_OFFICER");
  const waiting = await awaitingAllocation(db, context);
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
      ]}
    >
      {children}
    </AppShell>
  );
}
