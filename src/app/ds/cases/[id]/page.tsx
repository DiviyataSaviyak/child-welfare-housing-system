import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  CaseColumns,
  CaseDetailsSection,
  CaseNotes,
  caseSubtitle,
  ReplacementNotes,
} from "@/components/cases/case-view";
import { MoneySection } from "@/components/cases/money-section";
import { caseName, PageHeader } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { FormNotice } from "@/components/forms/form-field";
import { CompletedBanner, StoppedBanner } from "@/components/progress/case-banners";
import { CaseHistory } from "@/components/progress/case-history";
import { InstallmentAction } from "@/components/progress/installment-action";
import { StageSection } from "@/components/progress/stage-section";
import { StageUpdate } from "@/components/progress/stage-update";
import { colomboDay } from "@/lib/dates";
import { paidLimits, stageLimits, startLimits } from "@/lib/validation/progress";
import { getCase, type InstallmentDetails } from "@/server/cases/queries";
import { canEditDetails } from "@/server/cases/rules";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { caseHistory } from "@/server/history/queries";
import { nextInstallment, previousPaidOn } from "@/server/installments/rules";
import { getStageProgress } from "@/server/stages/queries";
import { payInstallmentAction, stageUpdateAction, startInstallmentAction, uploadPhotoAction } from "./actions";

/** What a progress action leaves on the page, by its key under "progress.notices". */
const NOTICES = ["started", "paid", "stage", "completed"] as const;
const isNotice = (value: unknown): value is (typeof NOTICES)[number] =>
  typeof value === "string" && (NOTICES as readonly string[]).includes(value);

/**
 * The DS officer's case page (UI-7), as in the prototype: the money and its installments with the
 * next step (INS-1 to INS-5), the history (HIS-2), the building stages with the update button
 * (STG-1 to STG-6) and the beneficiary's details. Another office's case is "not found" (PRM-1, AC-1).
 */
export default async function DsCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const viewer = await requireRole("DS_OFFICER");
  const locale = await getLocale();
  const { id } = await params;
  const details = await getCase(db, viewer, id, locale);
  if (!details) notFound();

  const [t, tp, history, progress, subtitle] = await Promise.all([
    getTranslations("cases"),
    getTranslations("progress"),
    caseHistory(db, viewer, details.id, locale),
    details.release ? getStageProgress(db, details.id, details.kind, locale) : Promise.resolve(null),
    caseSubtitle(details, "ds"),
  ]);
  const notice = (await searchParams).notice;
  const justSubmitted = notice === "submitted" && details.caseNumber !== null;
  const running = details.status === "IN_PROGRESS" && details.release !== null;
  const today = colomboDay(new Date());
  const next = running ? nextInstallment(details.installments) : null;

  /** The next installment's button (INS-2); a later one says which it waits for. */
  const installmentStep = (item: InstallmentDetails) => {
    if (!running || !details.release || item.status === "RELEASED") return null;
    const name = t(`installment.name.${item.number as 1 | 2 | 3 | 4}`);
    if (item.number !== next?.number) {
      const previous = t(`installment.name.${(item.number - 1) as 1 | 2 | 3}`);
      return (
        <span className="text-[15px] text-[#4F5752]">{tp("installments.waitFor", { installment: previous })}</span>
      );
    }
    const starting = item.status === "NOT_STARTED";
    return (
      <InstallmentAction
        key={`${details.version}-${item.number}`}
        step={starting ? "start" : "pay"}
        caseId={details.id}
        version={details.version}
        number={item.number}
        installmentName={name}
        limits={
          starting
            ? startLimits(details.release.releasedOn)
            : paidLimits(today, details.release.releasedOn, previousPaidOn(details.installments, item.number))
        }
        initial={{ day: starting ? "" : today, purpose: item.purpose ?? "", note: item.note ?? "" }}
        action={starting ? startInstallmentAction : payInstallmentAction}
      />
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref="/ds"
        backLabel={t("back.ds")}
        title={caseName(t, details.name, details.childName)}
        subtitle={subtitle}
        aside={<StatusChip status={details.status} />}
      />
      {justSubmitted && (
        <section
          aria-labelledby="submitted-title"
          className="flex max-w-4xl flex-col gap-2 rounded-xl border-2 border-primary bg-accent px-6 py-5"
        >
          <h2 id="submitted-title" className="text-[22px] font-bold text-primary">
            {t("submitted.title")}
          </h2>
          <p className="text-lg">
            {t("submitted.number")} <strong data-testid="case-number">{details.caseNumber}</strong>
          </p>
          <p className="text-[#3F4843]">{t("submitted.text")}</p>
          <Link href="/ds/cases/new" className="self-start font-semibold text-primary underline">
            {t("submitted.addAnother")}
          </Link>
        </section>
      )}
      {isNotice(notice) && <FormNotice message={tp(`notices.${notice}`)} />}
      <CaseNotes details={details} audience="ds" />
      <StoppedBanner details={details} />
      <ReplacementNotes details={details} audience="ds" />
      <CompletedBanner details={details} />
      <CaseColumns
        main={
          <>
            {details.release && (
              <MoneySection
                audience="ds"
                release={details.release}
                installments={details.installments}
                actions={installmentStep}
              />
            )}
            <CaseHistory entries={history ?? []} />
          </>
        }
        side={
          <>
            {progress && details.release && (
              <StageSection
                progress={progress}
                update={
                  running && (
                    <StageUpdate
                      key={details.version}
                      caseId={details.id}
                      version={details.version}
                      choices={progress.choices}
                      limits={stageLimits(today, details.release.releasedOn, progress.current?.reachedOn ?? null)}
                      today={today}
                      buttonLabel={tp(progress.choices.length > 0 ? "stages.update" : "stages.addNote")}
                      action={stageUpdateAction}
                      upload={uploadPhotoAction}
                    />
                  )
                }
              />
            )}
            <CaseDetailsSection
              details={details}
              editHref={canEditDetails(viewer.role, details.status) ? `/ds/cases/${details.id}/edit` : null}
            />
          </>
        }
      />
    </div>
  );
}
