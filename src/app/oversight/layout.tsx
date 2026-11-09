import { AppShell } from "@/components/shell/app-shell";
import { requireRole } from "@/server/context";
import { oversightArea } from "./area";

/**
 * The view-only area (PRM-4, PRM-5): the dashboard and the case list of the account's own area, for the
 * District CRPO and every designation that only views. Nothing here changes a case, and it has no
 * notifications.
 */
export default async function OversightLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const area = await oversightArea(context);
  return (
    <AppShell
      area="oversight"
      userName={context.label}
      areaLabel={area.header}
      nav={[
        { href: "/oversight", labelKey: "oversightDashboard", exact: true },
        { href: "/oversight/cases", labelKey: "oversightCases" },
      ]}
    >
      {children}
    </AppShell>
  );
}
