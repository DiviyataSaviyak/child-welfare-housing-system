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
  const context = await requireRole("HO_OFFICER");
  const waiting = await waitingNow(db, context);
  return (
    <AppShell
      area="ho"
      userName={context.label}
      nav={[
        { href: "/ho", labelKey: "hoDashboard", exact: true },
        { href: "/ho/cases", labelKey: "hoCases" },
        {
          href: "/ho/check",
          labelKey: "hoCheck",
          alsoActive: ["/ho/release"],
          count: { ...waiting, source: "/ho/waiting" },
        },
      ]}
    >
      {children}
    </AppShell>
  );
}
