import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { formatNumber } from "@/lib/money";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices } from "@/server/lists/queries";
import { awaitingAllocation } from "@/server/releases/queries";

/** DSH-1, DSH-2: the Ministry's national picture, with the cases awaiting its allocation beside it. */
export default async function HoDashboardPage({
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
      side={
        <section aria-labelledby="waiting-title" className="flex flex-col rounded-xl border bg-card px-5 py-4.5">
          <h2 id="waiting-title" className="mb-1.5 text-[19px] font-bold">
            {t("waiting.title")}
          </h2>
          <Link href="/ministry/release" className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
            <span className="font-semibold underline-offset-3 hover:underline">{t("waiting.release")} →</span>
            <span className="text-xl font-bold tabular-nums">{formatNumber(waiting.count)}</span>
          </Link>
        </section>
      }
    />
  );
}
