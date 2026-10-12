import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DeleteDraft } from "@/components/cases/delete-draft";
import { formValues, PageHeader, replacementOptions } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { CaseForm } from "@/components/forms/case-form";
import { FormNotice } from "@/components/forms/form-field";
import { getCase } from "@/server/cases/queries";
import { openRequests } from "@/server/cases/replacements";
import { canDeleteDraft, canEditDetails } from "@/server/cases/rules";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import {
  checkNicAction,
  deleteDraftAction,
  removeDocumentAction,
  saveCaseAction,
  uploadDocumentAction,
} from "../../actions";

/** A draft or a returned case, with Head Office's reason at the top (CASE-4, CASE-7). */
export default async function EditCasePage({
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
  // Nobody changes a case while Head Office checks it, or after (STS-3, CASE-9).
  if (!canEditDetails(viewer.role, details.status)) redirect(`/ds/cases/${id}`);

  const [t, requests] = await Promise.all([
    getTranslations("cases"),
    openRequests(db, viewer, { forCaseId: details.id }),
  ]);
  const notice = (await searchParams).notice === "saved";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref="/ds"
        backLabel={t("back.ds")}
        title={t("form.editTitle")}
        subtitle={
          <span className="flex items-center gap-3">
            {details.caseNumber ?? t("noNumber")}
            <StatusChip status={details.status} />
          </span>
        }
      />
      {notice && <FormNotice message={t("notices.saved")} />}
      <CaseForm
        // A new version after each save starts the form again from what was saved.
        key={details.version}
        caseId={details.id}
        version={details.version}
        initial={formValues(details)}
        office={{ kind: "own", districtName: details.districtName, officeName: details.officeName }}
        documents={details.documents}
        returnReason={details.returnReason}
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
