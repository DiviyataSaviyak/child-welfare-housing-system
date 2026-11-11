import { AppShell } from "@/components/shell/app-shell";
import type { NavEntry } from "@/components/shell/types";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { unreadNow } from "@/server/notifications/queries";
import { awaitingDsRelease } from "@/server/releases/queries";
import { oversightArea } from "./area";

/**
 * The area for the district, province, Department and Ministry accounts that see cases without entering
 * them (PRM-4, PRM-5): the dashboard and the case list of the account's own area. A District officer also
 * releases the Ministry's allocations to the district's DS offices (REL-5), with the menu's count of cases
 * waiting and the bell (NTF-1), each read again after every move from /oversight/waiting and
 * /oversight/notifications/unread. Every other account here only views and has no notifications.
 */
export default async function OversightLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const releases = context.role === "DISTRICT_OFFICER";
  const [area, waiting, unread] = await Promise.all([
    oversightArea(context),
    releases ? awaitingDsRelease(db, context) : null,
    releases ? unreadNow(db, context) : null,
  ]);
  const nav: NavEntry[] = [
    { href: "/oversight", labelKey: "oversightDashboard", exact: true },
    { href: "/oversight/cases", labelKey: "oversightCases" },
  ];
  if (waiting) {
    nav.push({
      href: "/oversight/release",
      labelKey: "districtRelease",
      count: { ...waiting, source: "/oversight/waiting" },
    });
  }
  return (
    <AppShell
      area="oversight"
      userName={context.label}
      areaLabel={area.header}
      nav={nav}
      bell={
        unread
          ? { href: "/oversight/notifications", unread: { ...unread, source: "/oversight/notifications/unread" } }
          : undefined
      }
    >
      {children}
    </AppShell>
  );
}
