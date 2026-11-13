import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { buildSetting, formValues, PageHeader } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { CaseForm, type OfficeSetting } from "@/components/forms/case-form";
import { getCase } from "@/server/cases/queries";
import { canChangeBuildOffice, canChangeOffice, canEditDetails, kindsOffered } from "@/server/cases/rules";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices, provinceOptions } from "@/server/lists/queries";
import { checkNicAction, removeDocumentAction, saveCaseAction, uploadDocumentAction } from "../../actions";

/**
 * CASE-9: the Ministry changes a case of any office until it is completed, with every changed field
 * logged. Its DS office (CASE-3) and where it is built (CASE-13) change only while it awaits its
 * allocation.
 */
export default async function MinistryEditCasePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const locale = await getLocale();
  const { id } = await params;
  const details = await getCase(db, viewer, id, locale);
  if (!details) notFound();
  if (!canEditDetails(viewer.role, details.status)) redirect(`/ministry/cases/${id}`);

  const [t, districts, provinces] = await Promise.all([
    getTranslations("cases"),
    districtsWithOffices(db, locale),
    provinceOptions(db, locale),
  ]);
  const office: OfficeSetting = canChangeOffice(viewer.role, details.status)
    ? { kind: "choose", districts, districtId: details.districtId, dsOfficeId: details.dsOfficeId }
    : {
        kind: "fixed",
        dsOfficeId: details.dsOfficeId,
        provinceName: details.provinceName,
        districtName: details.districtName,
        officeName: details.officeName,
      };
  const awaiting = canChangeBuildOffice(details.status);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref={`/ministry/cases/${details.id}`}
        backLabel={t("back.case")}
        title={t("form.editTitle")}
        subtitle={
          <span className="flex items-center gap-3">
            {details.applicationNumber}
            <StatusChip status={details.status} />
          </span>
        }
      />
      <CaseForm
        key={details.version}
        caseId={details.id}
        version={details.version}
        initial={formValues(details)}
        office={office}
        build={buildSetting(details, awaiting, districts)}
        provinces={provinces}
        documents={details.documents}
        mode="edit"
        intro={!awaiting}
        kinds={kindsOffered(details.status, details.kind)}
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
