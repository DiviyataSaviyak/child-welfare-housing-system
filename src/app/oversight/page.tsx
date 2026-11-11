import { getTranslations } from "next-intl/server";
import { DashboardScreen, WaitingPanel } from "@/components/dashboard/dashboard-screen";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { awaitingDsRelease } from "@/server/releases/queries";
import { oversightArea } from "./area";

/**
 * DSH-1, DSH-2 for the oversight area: the dashboard of the account's own area (PRM-4). A District
 * officer also sees the district's cases waiting for its release (REL-5); a view-only account has none.
 */
export default async function OversightDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const releases = viewer.role === "DISTRICT_OFFICER";
  const [t, area, params, waiting] = await Promise.all([
    getTranslations("dashboard"),
    oversightArea(viewer),
    searchParams,
    releases ? awaitingDsRelease(db, viewer) : null,
  ]);
  return (
    <DashboardScreen
      path="/oversight"
      viewer={viewer}
      params={params}
      districts={area.districts}
      oneDistrict={area.kind === "district" || area.kind === "office"}
      areaName={area.covers}
      side={waiting && <WaitingPanel href="/oversight/release" label={t("waiting.dsRelease")} count={waiting.count} />}
    />
  );
}
