import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { buildSetting, formValues, PageHeader } from "@/components/cases/page-header";
import { CaseForm } from "@/components/forms/case-form";
import { officeSummary } from "@/server/cases/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices } from "@/server/lists/queries";
import { checkNicAction, removeDocumentAction, saveCaseAction, uploadDocumentAction } from "../actions";

/** CASE-1: a new case, in the officer's own office (CASE-3), built there or in another DS division (CASE-13). */
export default async function NewCasePage() {
  const viewer = await requireRole("DS_OFFICER");
  const locale = await getLocale();
  const office = viewer.dsOfficeId ? await officeSummary(db, viewer.dsOfficeId, locale) : null;
  if (!viewer.dsOfficeId || !office) notFound();
  const [t, districts] = await Promise.all([getTranslations("cases"), districtsWithOffices(db, locale)]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader backHref="/ds" backLabel={t("back.ds")} title={t("form.newTitle")} />
      {office.active ? (
        <CaseForm
          // The id is chosen now, so sending this form twice can only ever make one case (ERR-8).
          caseId={randomUUID()}
          version={null}
          initial={formValues(null)}
          office={{
            kind: "own",
            dsOfficeId: viewer.dsOfficeId,
            districtName: office.districtName,
            officeName: office.name,
          }}
          build={buildSetting(null, true, districts)}
          documents={[]}
          mode="new"
          actions={{
            save: saveCaseAction,
            upload: uploadDocumentAction,
            checkNic: checkNicAction,
            removeDocument: removeDocumentAction,
          }}
        />
      ) : (
        <p className="rounded-lg bg-notice px-4 py-3 text-notice-foreground">{t("officeClosed")}</p>
      )}
    </div>
  );
}
