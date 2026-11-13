import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CaseColumns, CaseDetailsSection, caseSubtitle, ReplacementNotes } from "@/components/cases/case-view";
import { MoneySection } from "@/components/cases/money-section";
import { caseName, PageHeader } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { CompletedBanner } from "@/components/progress/case-banners";
import { CaseHistory } from "@/components/progress/case-history";
import { StageSection } from "@/components/progress/stage-section";
import { CorrectDsRelease } from "@/components/review/correct-ds-release";
import { ReviewNotice } from "@/components/review/review-notice";
import { colomboDay } from "@/lib/dates";
import { getCase } from "@/server/cases/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { caseHistory } from "@/server/history/queries";
import { getStageProgress } from "@/server/stages/queries";
import { correctDsReleaseAction } from "../../release/actions";

/**
 * The case page of the view-only area (PRM-4, PRM-5): the case of the account's own area, with its
 * money, stages and photos, documents and history, as the Ministry reads it. Its one action is the District
 * officer's correction of the District release, for a case built in the officer's district (REL-8, REL-9).
 * A case outside the area answers "not found" (PRM-1).
 */
export default async function OversightCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const viewer = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const locale = await getLocale();
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const details = await getCase(db, viewer, id, locale);
  if (!details) notFound();

  const [t, history, progress, subtitle] = await Promise.all([
    getTranslations("cases"),
    caseHistory(db, viewer, details.id, locale),
    details.release ? getStageProgress(db, details.id, details.kind, locale) : Promise.resolve(null),
    caseSubtitle(details, "oversight"),
  ]);

  const dsRelease = details.release?.dsRelease ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref="/oversight/cases"
        backLabel={t("back.oversight")}
        title={caseName(t, details.name, details.childName)}
        subtitle={subtitle}
        aside={<StatusChip status={details.status} />}
      />
      <ReviewNotice notice={notice} />
      <ReplacementNotes details={details} audience="oversight" />
      <CompletedBanner details={details} />
      <CaseColumns
        main={
          <>
            {details.release && (
              <MoneySection
                audience="oversight"
                kind={details.kind}
                release={details.release}
                installments={details.installments}
                dsCorrection={
                  details.actsOn.release &&
                  dsRelease && (
                    <CorrectDsRelease
                      key={details.version}
                      caseId={details.id}
                      version={details.version}
                      limits={{ earliest: dsRelease.latestLetter, today: colomboDay(new Date()) }}
                      current={{
                        referenceNumber: dsRelease.referenceNumber,
                        releasedOn: dsRelease.releasedOn,
                        note: dsRelease.note ?? "",
                      }}
                      cases={dsRelease.cases}
                      action={correctDsReleaseAction}
                    />
                  )
                }
              />
            )}
            <CaseHistory entries={history ?? []} />
          </>
        }
        side={
          <>
            {progress && <StageSection progress={progress} />}
            <CaseDetailsSection details={details} editHref={null} />
          </>
        }
      />
    </div>
  );
}
