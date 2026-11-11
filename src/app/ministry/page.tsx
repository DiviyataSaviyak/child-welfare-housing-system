import { getLocale, getTranslations } from "next-intl/server";
import { DashboardScreen, WaitingPanel } from "@/components/dashboard/dashboard-screen";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices } from "@/server/lists/queries";
import { awaitingAllocation } from "@/server/releases/queries";

/** DSH-1, DSH-2: the Ministry's national picture, with the cases awaiting its allocation beside it. */
export default async function MinistryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const locale = await getLocale();
  const [t, params, districts, waiting] = await Promise.all([
    getTranslations("dashboard"),
    searchParams,
    districtsWithOffices(db, locale),
    awaitingAllocation(db, viewer),
  ]);

  return (
    <DashboardScreen
      path="/ministry"
      viewer={viewer}
      params={params}
      districts={districts}
      areaName={t("allDistricts")}
      side={<WaitingPanel href="/ministry/allocate" label={t("waiting.release")} count={waiting.count} />}
    />
  );
}
