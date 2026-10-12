import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DeleteDraft } from "@/components/cases/delete-draft";
import { formValues, PageHeader, replacementOptions } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { CaseForm, type OfficeSetting } from "@/components/forms/case-form";
import { FormNotice } from "@/components/forms/form-field";
import { getCase } from "@/server/cases/queries";
import { openRequests } from "@/server/cases/replacements";
import { canChangeOffice, canDeleteDraft, canEditDetails, isBeingEntered } from "@/server/cases/rules";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices } from "@/server/lists/queries";
import {
  checkNicAction,
  deleteDraftAction,
  removeDocumentAction,
  saveCaseAction,
  uploadDocumentAction,
} from "../../actions";

/**
 * Head Office changes a draft or a returned case of any office (SPEC section 4), or corrects a verified
 * case, with every changed field logged (CASE-9).
 */
export default async function HoEditCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const viewer = await requireRole("HO_OFFICER");
  const locale = await getLocale();
  const { id } = await params;
  const details = await getCase(db, viewer, id, locale);
  if (!details) notFound();
  if (!canEditDetails(viewer.role, details.status)) redirect(`/ho/cases/${id}`);

  const t = await getTranslations("cases");
  const notice = (await searchParams).notice === "saved";
  // The office can change only until the first submit puts its code in the case number (CASE-3).
  const office: OfficeSetting = canChangeOffice(viewer.role, details.status)
    ? {
        kind: "choose",
        districts: await districtsWithOffices(db, locale),
        districtId: details.districtId,
        dsOfficeId: details.dsOfficeId,
      }
    : { kind: "fixed", districtName: details.districtName, officeName: details.officeName };
  // CASE-11: while the office can still change, the form offers each office's own requests.
  const requests = isBeingEntered(details.status)
    ? await openRequests(db, viewer, {
        forCaseId: details.id,
        ...(office.kind === "fixed" ? { dsOfficeId: details.dsOfficeId } : {}),
      })
    : [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref={isBeingEntered(details.status) ? "/ho/cases" : `/ho/cases/${details.id}`}
        backLabel={isBeingEntered(details.status) ? t("back.ho") : t("back.case")}
        title={t("form.editTitle")}
        subtitle={
          <span className="flex items-center gap-3">
            {details.caseNumber ?? t("noNumber")}
            <StatusChip status={details.status} />
          </span>
        }
      />
      {notice && <FormNotice message={t("notices.savedHo")} />}
      <CaseForm
        key={details.version}
        caseId={details.id}
        version={details.version}
        initial={formValues(details)}
        office={office}
        documents={details.documents}
        returnReason={details.returnReason}
        mode={isBeingEntered(details.status) ? "entry" : "change"}
        replacements={replacementOptions(t, requests)}
        replacesCaseId={details.replaces?.id ?? null}
        actions={{
          save: saveCaseAction,
          upload: uploadDocumentAction,
          checkNic: checkNicAction,
          removeDocument: removeDocumentAction,
        }}
      />
      {canDeleteDraft(viewer.role, details.status) && <DeleteDraft caseId={details.id} action={deleteDraftAction} />}
    </div>
  );
}
