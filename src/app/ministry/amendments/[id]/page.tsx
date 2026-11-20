import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { AmendmentStatusChip, AmendmentView } from "@/components/amendments/amendment-view";
import { ApproveAction, type ReturnAsk } from "@/components/amendments/approve-action";
import { caseName, PageHeader } from "@/components/cases/page-header";
import { FormNotice } from "@/components/forms/form-field";
import { ReasonAction } from "@/components/progress/reason-action";
import { DuplicateCases } from "@/components/review/duplicate-cases";
import { colomboDay } from "@/lib/dates";
import { returnLimits } from "@/lib/validation/progress";
import { type AmendmentView as View, getAmendment } from "@/server/amendments/queries";
import { replacementStep } from "@/server/amendments/rules";
import { duplicatesInFull } from "@/server/cases/duplicates";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { approveAmendmentAction, rejectAmendmentAction } from "./actions";

/** What a decision leaves on the page, by its key under "cases.amend.view". */
const NOTICES = ["approved", "rejected"] as const;
const isNotice = (value: unknown): value is (typeof NOTICES)[number] =>
  typeof value === "string" && (NOTICES as readonly string[]).includes(value);

/**
 * AMD-4: the Ministry's page for one amendment: the existing and the new beneficiary side by side, the
 * reason, and the other cases sharing the new beneficiary's NIC (CASE-6). While it waits, a Ministry officer
 * approves it (asked once to confirm; AMD-5) or rejects it with a reason (AMD-6).
 */
export default async function MinistryAmendmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const locale = await getLocale();
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const view = await getAmendment(db, viewer, id, locale);
  if (!view) notFound();

  const waiting = view.status === "WAITING";
  const { existing, proposed } = view;
  const [t, tp, duplicates] = await Promise.all([
    getTranslations("cases"),
    getTranslations("progress"),
    // The amendment's own id: no case has it, so every case with the new NIC is listed, the existing one too.
    waiting && proposed
      ? duplicatesInFull(db, viewer, { caseId: view.id, nic: proposed.nic, dsOfficeId: existing.dsOfficeId }, locale)
      : Promise.resolve([]),
  ]);
  const existingName = caseName(t, existing.name, existing.childName);
  const person = (name: string, number: string) => t("amend.person", { name, number });
  const hidden = { amendmentId: view.id, version: String(view.version) };
  const working = tp("reasonPopup.working");
  const cancel = tp("reasonPopup.cancel");

  const actions = waiting && (
    <>
      {proposed && (
        <ApproveAction
          key={`approve-${view.version}-${existing.version}`}
          hidden={{ ...hidden, caseVersion: String(existing.version) }}
          action={approveAmendmentAction}
          returnAsk={returnAsk(view, t)}
          texts={{
            button: t("amend.view.approve"),
            title: t("amend.view.approveTitle"),
            text: t("amend.view.approveText", {
              new: person(caseName(t, proposed.name, proposed.childName), proposed.applicationNumber),
              existing: person(existingName, existing.applicationNumber),
            }),
            money: existing.release ? t("amend.view.approveMoney") : null,
            confirm: t("amend.view.approveConfirm"),
            cancel,
            working,
          }}
        />
      )}
      <ReasonAction
        key={`reject-${view.version}`}
        id="reject"
        look="danger"
        hidden={hidden}
        action={rejectAmendmentAction}
        texts={{
          button: t("amend.view.reject"),
          title: t("amend.view.rejectTitle"),
          text: t("amend.view.rejectText"),
          reason: t("amend.view.rejectReason"),
          reasonHelp: tp("reasonPopup.reasonHelp"),
          confirm: t("amend.view.rejectConfirm"),
          cancel,
          working,
        }}
      />
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref={`/ministry/cases/${existing.id}`}
        backLabel={t("back.case")}
        title={t("amend.view.title")}
        subtitle={[existing.applicationNumber, existingName, existing.officeName].join(" · ")}
        aside={<AmendmentStatusChip status={view.status} />}
      />
      {isNotice(notice) && <FormNotice message={t(`amend.view.${notice}`)} />}
      <AmendmentView
        view={view}
        audience="ministry"
        actions={actions}
        above={duplicates.length > 0 && <DuplicateCases matches={duplicates} />}
      />
    </div>
  );
}

/**
 * AMD-11: what the approval asks about the money going back to the District, when the new beneficiary is
 * built in another DS office than the one the existing case's money has reached; null when nothing goes back.

 */
function returnAsk(view: View, t: Awaited<ReturnType<typeof getTranslations<"cases">>>): ReturnAsk | null {
  const { existing, proposed } = view;
  const release = existing.release;
  if (!proposed || !release) return null;
  const step = replacementStep(
    { status: existing.status, buildDsOffice: { id: existing.buildDsOfficeId, districtId: existing.buildDistrictId } },
    { id: proposed.buildDsOfficeId, districtId: proposed.buildDistrictId },
  );
  // Null is refused by the approval (buildOfficeNotAllowed), which then says so.
  if (step?.returnedTo !== "DISTRICT") return null;
  return {
    title: t("amend.view.returnTitle"),
    text: t("amend.view.approveReturnDistrict", {
      office: existing.buildOfficeName,
      district: existing.buildDistrictName,
    }),
    limits: returnLimits(colomboDay(new Date()), release.letter.letterDate, release.dsRelease?.releasedOn ?? null),
    labels: {
      returnedOn: t("amend.view.returnedOn"),
      referenceNumber: t("amend.view.returnReference"),
      note: t("amend.view.returnNote"),
    },
  };
}
