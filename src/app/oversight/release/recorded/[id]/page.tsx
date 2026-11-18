import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/cases/page-header";
import { SentCases } from "@/components/review/sent-cases";
import { formatDate } from "@/lib/dates";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { dsReleaseWithCases } from "@/server/releases/queries";

/**
 * REL-11: one of the district's releases to a DS office, opened from "releases recorded last": its Ministry
 * letter (REL-12), the beneficiaries it sent money for, their number and the amount. A release of another district is
 * "not found" (PRM-1).
 */
export default async function DistrictReleaseRecordedPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("DISTRICT_OFFICER");
  const { id } = await params;
  const locale = await getLocale();
  const release = id.length <= 64 ? await dsReleaseWithCases(db, viewer, id, locale) : null;
  if (!release) notFound();
  const t = await getTranslations("review");

  return (
    <div className="flex flex-col gap-4.5">
      <PageHeader
        backHref="/oversight/release"
        backLabel={t("sent.backToReleases")}
        title={t("sent.releaseTitle", { office: release.officeName, reference: release.referenceNumber })}
        subtitle={t("sent.releaseSubtitle", {
          date: formatDate(release.releasedOn),
          letter: release.letterNumber,
          letterDate: formatDate(release.letterDate),
        })}
      />
      <SentCases cases={release.cases} href={(caseId) => `/oversight/cases/${caseId}`} />
    </div>
  );
}
