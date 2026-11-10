import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CaseColumns, CaseDetailsSection, caseSubtitle, ReplacementNotes } from "@/components/cases/case-view";
import { MoneySection } from "@/components/cases/money-section";
import { caseName, PageHeader } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { CompletedBanner } from "@/components/progress/case-banners";
import { CaseHistory } from "@/components/progress/case-history";
import { StageSection } from "@/components/progress/stage-section";
import { getCase } from "@/server/cases/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { caseHistory } from "@/server/history/queries";
import { getStageProgress } from "@/server/stages/queries";

/**
 * The case page of the view-only area (PRM-4, PRM-5): the case of the account's own area, with its
 * money, stages and photos, documents and history, as Head Office reads it, but with no action at all.
 * A case outside the area answers "not found" (PRM-1).
 */
export default async function OversightCasePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const locale = await getLocale();
  const { id } = await params;
  const details = await getCase(db, viewer, id, locale);
  if (!details) notFound();

  const [t, history, progress, subtitle] = await Promise.all([
    getTranslations("cases"),
    caseHistory(db, viewer, details.id, locale),
    details.release ? getStageProgress(db, details.id, details.kind, locale) : Promise.resolve(null),
    caseSubtitle(details, "oversight"),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref="/oversight/cases"
        backLabel={t("back.oversight")}
        title={caseName(t, details.name, details.childName)}
        subtitle={subtitle}
        aside={<StatusChip status={details.status} />}
      />
      <ReplacementNotes details={details} audience="oversight" />
      <CompletedBanner details={details} />
      <CaseColumns
        main={
          <>
            {details.release && (
              <MoneySection audience="oversight" release={details.release} installments={details.installments} />
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
