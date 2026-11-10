import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CaseColumns, CaseDetailsSection, caseSubtitle, ReplacementNotes } from "@/components/cases/case-view";
import { MoneySection } from "@/components/cases/money-section";
import { caseName, PageHeader } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { FormNotice } from "@/components/forms/form-field";
import { CompletedBanner } from "@/components/progress/case-banners";
import { CaseHistory } from "@/components/progress/case-history";
import { ReasonAction } from "@/components/progress/reason-action";
import { StageSection } from "@/components/progress/stage-section";
import { CorrectRelease } from "@/components/review/correct-release";
import { DuplicateCases } from "@/components/review/duplicate-cases";
import { ReviewNotice } from "@/components/review/review-notice";
import { colomboDay } from "@/lib/dates";
import { duplicatesInFull } from "@/server/cases/duplicates";
import { getCase, type InstallmentDetails } from "@/server/cases/queries";
import { canDeleteCase, canEditDetails } from "@/server/cases/rules";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { caseHistory } from "@/server/history/queries";
import { lastPaid } from "@/server/installments/rules";
import { getStageProgress } from "@/server/stages/queries";
import { correctReleaseAction } from "../../release/actions";
import { deleteCaseAction } from "../actions";
import { undoInstallmentAction } from "./actions";

/** What an undone payment leaves on the page, by its key under "progress.notices". */
const NOTICES = ["undone"] as const;
const isNotice = (value: unknown): value is (typeof NOTICES)[number] =>
  typeof value === "string" && (NOTICES as readonly string[]).includes(value);

/**
 * The Ministry's case page (UI-7). A case awaiting its allocation shows the other cases with its NIC
 * (CASE-6) and leads to its district's allocation letter (REL-2); the letter of a recorded release can be
 * corrected (REL-4). A running case shows its installments, stages with photos (STG-6) and history
 * (HIS-2), and the Ministry can undo the last payment (INS-6). Nobody checks, stops or reopens a case any
 * more (change 0006).
 */
export default async function HoCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const locale = await getLocale();
  const { id } = await params;
  const details = await getCase(db, viewer, id, locale);
  if (!details) notFound();

  const awaiting = details.status === "AWAITING_ALLOCATION";
  const [t, tr, tp, history, progress, subtitle, duplicates] = await Promise.all([
    getTranslations("cases"),
    getTranslations("review"),
    getTranslations("progress"),
    caseHistory(db, viewer, details.id, locale),
    details.release ? getStageProgress(db, details.id, details.kind, locale) : Promise.resolve(null),
    caseSubtitle(details, "ministry"),
    // Nobody checks a case before the Ministry allocates it, so its NIC matches show here (CASE-6).
    awaiting
      ? duplicatesInFull(db, viewer, { caseId: details.id, nic: details.nic, dsOfficeId: details.dsOfficeId }, locale)
      : Promise.resolve([]),
  ]);
  const notice = (await searchParams).notice;
  const justCreated = notice === "created";
  const name = caseName(t, details.name, details.childName);
  const number = details.applicationNumber;
  const now = new Date();
  const hidden = { caseId: details.id, version: String(details.version) };
  const reasonTexts = {
    reasonHelp: tp("reasonPopup.reasonHelp"),
    cancel: tp("reasonPopup.cancel"),
    working: tp("reasonPopup.working"),
  };

  // CASE-8: a case awaiting its allocation can be deleted, with a reason.
  const remove = canDeleteCase(viewer.role, details.status) && (
    <ReasonAction
      key={`delete-${details.version}`}
      id="delete"
      look="danger"
      hidden={hidden}
      action={deleteCaseAction}
      texts={{
        button: t("deleteCase.button"),
        title: t("deleteCase.title"),
        text: t("deleteCase.text", { number }),
        reason: t("deleteCase.reason"),
        reasonHelp: t("deleteCase.reasonHelp"),
        confirm: t("deleteCase.confirm"),
        cancel: t("deleteCase.cancel"),
        working: t("deleteCase.working"),
      }}
    />
  );

  /** INS-6: only the most recently paid installment of a running case can be moved back. */
  const undoTarget = details.status === "IN_PROGRESS" ? lastPaid(details.installments) : null;
  const undo = (item: InstallmentDetails) => {
    if (item.number !== undoTarget?.number) return null;
    const installment = t(`installment.name.${item.number as 1 | 2 | 3 | 4}`);
    return (
      <ReasonAction
        key={`undo-${details.version}`}
        id="undo"
        look="small"
        hidden={{ ...hidden, number: String(item.number) }}
        action={undoInstallmentAction}
        texts={{
          ...reasonTexts,
          button: tp("installments.undo"),
          title: tp("installments.undoTitle", { installment }),
          text: tp("installments.undoText"),
          reason: tp("installments.undoReason"),
          confirm: tp("installments.undoConfirm"),
        }}
      />
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref="/ministry/cases"
        backLabel={t("back.ministry")}
        title={name}
        subtitle={subtitle}
        aside={
          <div className="flex items-center gap-3.5">
            <StatusChip status={details.status} />
            {remove}
          </div>
        }
      />
      {justCreated && (
        <section
          aria-labelledby="created-title"
          className="flex max-w-4xl flex-col gap-2 rounded-xl border-2 border-primary bg-accent px-6 py-5"
        >
          <h2 id="created-title" className="text-[22px] font-bold text-primary">
            {t("created.title")}
          </h2>
          <p className="text-lg">
            {t("created.number")} <strong data-testid="case-number">{details.applicationNumber}</strong>
          </p>
          <p className="text-[#3F4843]">{t("created.textMinistry")}</p>
        </section>
      )}
      {notice === "changed" && <FormNotice message={t("notices.changed")} />}
      {isNotice(notice) && <FormNotice message={tp(`notices.${notice}`)} />}
      <ReviewNotice notice={notice} />
      <ReplacementNotes details={details} audience="ministry" />
      <CompletedBanner details={details} />
      <CaseColumns
        main={
          <>
            {duplicates.length > 0 && <DuplicateCases matches={duplicates} />}
            {awaiting && (
              <section
                aria-labelledby="release-title"
                className="flex flex-col gap-3 rounded-xl border bg-card px-6 py-5"
              >
                <h2 id="release-title" className="text-xl font-bold">
                  {tr("letters.caseTitle")}
                </h2>
                {/* CASE-13: the letter goes to the district where it is built. */}
                <p>{tr("letters.caseText", { district: details.buildDistrictName })}</p>
                <Link
                  href={`/ministry/release?districtId=${details.buildDistrictId}`}
                  className="flex h-12 items-center self-start rounded-lg bg-primary px-5.5 text-[17px] font-bold text-primary-foreground"
                >
                  {tr("letters.caseGo")}
                </Link>
              </section>
            )}
            {details.release && (
              <MoneySection
                audience="ministry"
                release={details.release}
                installments={details.installments}
                actions={undoTarget ? undo : undefined}
                correction={
                  <CorrectRelease
                    key={details.version}
                    caseId={details.id}
                    version={details.version}
                    limits={{ earliest: details.release.letter.latestEntered, today: colomboDay(now) }}
                    current={{
                      letterNumber: details.release.letter.letterNumber,
                      letterDate: details.release.letter.letterDate,
                      validUntil: details.release.letter.validUntil,
                      note: details.release.letter.note ?? "",
                    }}
                    cases={details.release.letter.cases}
                    action={correctReleaseAction}
                  />
                }
              />
            )}
            <CaseHistory entries={history ?? []} />
          </>
        }
        side={
          <>
            {progress && <StageSection progress={progress} />}
            <CaseDetailsSection
              details={details}
              editHref={canEditDetails(viewer.role, details.status) ? `/ministry/cases/${details.id}/edit` : null}
            />
          </>
        }
      />
    </div>
  );
}
