import { AppShell } from "@/components/shell/app-shell";
import { waitingNow } from "@/server/cases/queues";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";

/**
 * The menu shows how many cases wait for a check or a release (NTF-1). A layout isn't rendered again
 * on a client-side move: the actions that change a queue refresh it with revalidatePath, and the menu
 * reads the count again from /ho/waiting after every move, so it agrees with the page beside it.
 */
export default async function HoLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("MINISTRY_OFFICER");
  const waiting = await waitingNow(db, context);
  return (
    <AppShell
      area="ministry"
      userName={context.label}
      nav={[
        { href: "/ministry", labelKey: "ministryDashboard", exact: true },
        { href: "/ministry/cases", labelKey: "ministryCases" },
        {
          href: "/ministry/check",
          labelKey: "ministryCheck",
          alsoActive: ["/ministry/release"],
          count: { ...waiting, source: "/ministry/waiting" },
        },
      ]}
    >
      {children}
    </AppShell>
  );
}
