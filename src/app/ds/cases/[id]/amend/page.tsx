import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { amendBuild } from "@/components/amendments/amend-build";
import { caseName, formValues, PageHeader } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { CaseForm } from "@/components/forms/case-form";
import { canAmend } from "@/server/amendments/rules";
import { getCase } from "@/server/cases/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices, provinceOptions } from "@/server/lists/queries";
import { checkNicAction, removeDocumentAction, uploadDocumentAction } from "../../actions";
import { submitAmendmentAction } from "./actions";

/**
 * AMD-1: a CRPO of the case's DS of residence proposes another beneficiary to the Ministry, on the case form
 * with a reason. The existing beneficiary is named above the form. Anyone else, or a case that can't have
 * an amendment now (AMD-2, AMD-3), goes back to the case page.
 */
export default async function AmendCasePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("DS_OFFICER");
  const locale = await getLocale();
  const { id } = await params;
  const details = await getCase(db, viewer, id, locale);
  if (!details) notFound();
  const allowed = canAmend(
    { role: viewer.role, residence: details.actsOn.amend },
    {
      status: details.status,
      paid: details.installments.some((i) => i.status === "RELEASED"),
      waiting: details.amendment?.status === "WAITING" || details.nomination?.status === "WAITING",
    },
  );
  if (!allowed) redirect(`/ds/cases/${id}`);

  const [t, districts, provinces] = await Promise.all([
    getTranslations("cases"),
    districtsWithOffices(db, locale),
    provinceOptions(db, locale),
  ]);
  const name = caseName(t, details.name, details.childName);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader backHref={`/ds/cases/${details.id}`} backLabel={t("back.case")} title={t("amend.title")} />
      <section
        aria-labelledby="existing-title"
        className="flex max-w-4xl flex-col gap-1.5 rounded-xl border bg-card px-6 py-4.5"
      >
        <h2 id="existing-title" className="text-[15px] font-semibold text-muted-foreground">
          {t("amend.existing")}
        </h2>
        <p className="flex flex-wrap items-center gap-3 text-lg">
          <strong data-testid="existing-beneficiary">{name}</strong>
          <span className="text-muted-foreground">{details.applicationNumber}</span>
          <StatusChip status={details.status} />
        </p>
        <p className="text-[15px] text-[#3F4843]">{t("amend.intro")}</p>
      </section>
      <CaseForm
        // The amendment's id is chosen now, so sending this form twice makes one amendment (ERR-8).
        caseId={randomUUID()}
        version={details.version}
        initial={formValues(null)}
        office={{
          kind: "own",
          dsOfficeId: details.dsOfficeId,
          provinceName: details.provinceName,
          districtName: details.districtName,
          officeName: details.officeName,
        }}
        build={amendBuild(details, districts)}
        provinces={provinces}
        documents={[]}
        mode="amend"
        amend={{ caseId: details.id, existingName: name, existingNumber: details.applicationNumber }}
        actions={{
          save: submitAmendmentAction,
          upload: uploadDocumentAction,
          checkNic: checkNicAction,
          removeDocument: removeDocumentAction,
        }}
      />
    </div>
  );
}
