import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { buildSetting, formValues, PageHeader } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { CaseForm } from "@/components/forms/case-form";
import { getCase } from "@/server/cases/queries";
import { canChangeBuildOffice, canEditDetails } from "@/server/cases/rules";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices } from "@/server/lists/queries";
import { checkNicAction, removeDocumentAction, saveCaseAction, uploadDocumentAction } from "../../actions";

/** CASE-9: the DS of residence corrects a case while it awaits its allocation, every detail included. */
export default async function EditCasePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("DS_OFFICER");
  const locale = await getLocale();
  const { id } = await params;
  const details = await getCase(db, viewer, id, locale);
  if (!details) notFound();
  // Only the DS of residence changes it, not the DS where it is built (CASE-13), and only until the
  // Ministry's allocation (CASE-9).
  if (!details.actsOn.edit || !canEditDetails(viewer.role, details.status)) redirect(`/ds/cases/${id}`);

  const [t, districts] = await Promise.all([getTranslations("cases"), districtsWithOffices(db, locale)]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref={`/ds/cases/${details.id}`}
        backLabel={t("back.case")}
        title={t("form.editTitle")}
        subtitle={
          <span className="flex items-center gap-3">
            {details.applicationNumber ?? t("noNumber")}
            <StatusChip status={details.status} />
          </span>
        }
      />
      <CaseForm
        // A new version after each save starts the form again from what was saved.
        key={details.version}
        caseId={details.id}
        version={details.version}
        initial={formValues(details)}
        office={{
          kind: "own",
          dsOfficeId: details.dsOfficeId,
          districtName: details.districtName,
          officeName: details.officeName,
        }}
        build={buildSetting(details, canChangeBuildOffice(details.status), districts)}
        documents={details.documents}
        mode="edit"
        actions={{
          save: saveCaseAction,
          upload: uploadDocumentAction,
          checkNic: checkNicAction,
          removeDocument: removeDocumentAction,
        }}
      />
    </div>
  );
}
