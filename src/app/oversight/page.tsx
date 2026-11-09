import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { requireRole } from "@/server/context";
import { oversightArea } from "./area";

/** DSH-1, DSH-2 for a view-only account: the dashboard of its own area (PRM-4), with no queues. */
export default async function OversightDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const [area, params] = await Promise.all([oversightArea(viewer), searchParams]);
  return (
    <DashboardScreen
      path="/oversight"
      viewer={viewer}
      params={params}
      districts={area.districts}
      oneDistrict={area.kind === "district" || area.kind === "office"}
      areaName={area.covers}
    />
  );
}
