import { getLocale, getTranslations } from "next-intl/server";
import { amendmentsHref } from "@/components/amendments/tabs";
import { DashboardScreen, WaitingPanel } from "@/components/dashboard/dashboard-screen";
import { amendmentsWaiting } from "@/server/amendments/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices } from "@/server/lists/queries";
import { awaitingAllocation } from "@/server/releases/queries";

/**
 * DSH-1, DSH-2: the Ministry's national picture, with the cases awaiting its allocation and the amendments
 * awaiting its decision beside it.
 */
export default async function MinistryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const locale = await getLocale();
  const [t, params, districts, waiting, amendments] = await Promise.all([
    getTranslations("dashboard"),
    searchParams,
    districtsWithOffices(db, locale),
    awaitingAllocation(db, viewer),
    amendmentsWaiting(db, viewer),
  ]);

  return (
    <DashboardScreen
      path="/ministry"
      viewer={viewer}
      params={params}
      districts={districts}
      areaName={t("allDistricts")}
      side={
        <WaitingPanel
          rows={[
            { href: "/ministry/allocate", label: t("waiting.release"), count: waiting.count },
            { href: amendmentsHref("ministry", "WAITING"), label: t("waiting.amendments"), count: amendments.count },
          ]}
        />
      }
    />
  );
}
