import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DsReleaseNotice } from "@/components/review/review-notice";
import { formatDate } from "@/lib/dates";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { dsOfficesWaiting, getDsRelease, recentDsReleases } from "@/server/releases/queries";

type SearchParams = Promise<{ notice?: string | string[]; release?: string | string[] }>;

/**
 * REL-5: the District officer's "to release to DS offices" screen. The DS offices of the district whose
 * cases the Ministry allocated wait for the District's release, the most cases first, each opening its
 * release form (REL-6); beside them, the releases the district recorded last. The district comes only from
 * the account (PRM-4).
 */
export default async function DistrictReleasePage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireRole("DISTRICT_OFFICER");
  const params = await searchParams;
  const releaseId = params.notice === "released" && typeof params.release === "string" ? params.release : null;
  const locale = await getLocale();
  const [t, offices, releases, recorded] = await Promise.all([
    getTranslations("review"),
    dsOfficesWaiting(db, viewer, locale),
    recentDsReleases(db, viewer, locale),
    releaseId && releaseId.length <= 64 ? getDsRelease(db, viewer, releaseId, locale) : null,
  ]);

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[28px] leading-snug font-bold">{t("district.title")}</h1>
        <p className="max-w-4xl text-muted-foreground">{t("district.intro")}</p>
      </div>

      <DsReleaseNotice release={recorded} />

      <div className="flex items-start gap-6">
        <section aria-labelledby="waiting-title" className="flex min-w-0 flex-1 flex-col gap-2.5">
          <h2 id="waiting-title" className="text-[17px] font-bold text-[#3F4843]">
            {t("district.waitingTitle")}
          </h2>
          {offices.length === 0 ? (
            <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">{t("district.none")}</p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2.5">
              {offices.map((office) => (
                <li key={office.id}>
                  <Link
                    href={`/oversight/release/${office.id}`}
                    className="flex h-full flex-col gap-0.5 rounded-xl border-2 border-border bg-card px-4 py-3.5 hover:border-primary/60"
                  >
                    <span className="text-[17px] font-bold">{t("district.office", { name: office.name })}</span>
                    <span className="text-[15px] font-semibold">
                      {t("letters.districtCount", {
                        count: office.count,
                        amount: formatRupees(office.count * RELEASE_AMOUNT, locale),
                      })}
                    </span>
                    {office.oldestLetter && (
                      <span className="text-sm text-[#3F4843]">
                        {t("district.oldestLetter", { date: formatDate(office.oldestLetter) })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="releases-title"
          className="flex w-[400px] shrink-0 flex-col gap-1 rounded-xl border bg-card px-4.5 py-4"
        >
          <h2 id="releases-title" className="mb-1 text-[17px] font-bold">
            {t("district.recordedTitle")}
          </h2>
          {releases.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">{t("district.recordedNone")}</p>
          ) : (
            <ul className="flex flex-col">
              {releases.map((release) => (
                <li key={release.id} className="flex flex-col border-t py-2">
                  <span className="text-[15px] font-bold">
                    {t("district.recordedName", { office: release.officeName, reference: release.referenceNumber })}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t("letters.recordedSub", {
                      date: formatDate(release.releasedOn),
                      count: release.count,
                      amount: formatRupees(release.count * RELEASE_AMOUNT, locale),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
