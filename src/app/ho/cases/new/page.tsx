import { randomUUID } from "node:crypto";
import { getLocale, getTranslations } from "next-intl/server";
import { formValues, PageHeader, replacementOptions } from "@/components/cases/page-header";
import { CaseForm } from "@/components/forms/case-form";
import { openRequests } from "@/server/cases/replacements";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices } from "@/server/lists/queries";
import { checkNicAction, removeDocumentAction, saveCaseAction, uploadDocumentAction } from "../actions";

/** Head Office enters a case for any DS office, choosing the district, then the office (CASE-3). */
export default async function HoNewCasePage() {
  const viewer = await requireRole("HO_OFFICER");
  const locale = await getLocale();
  const [t, districts, requests] = await Promise.all([
    getTranslations("cases"),
    districtsWithOffices(db, locale),
    openRequests(db, viewer),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader backHref="/ho/cases" backLabel={t("back.ho")} title={t("form.newTitle")} />
      <CaseForm
        // The id is chosen now, so sending this form twice can only ever make one case (ERR-8).
        caseId={randomUUID()}
        version={null}
        initial={formValues(null)}
        office={{ kind: "choose", districts, districtId: null, dsOfficeId: null }}
        documents={[]}
        returnReason={null}
        replacements={replacementOptions(t, requests)}
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
