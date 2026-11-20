import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { amendBuild } from "@/components/amendments/amend-build";
import { caseName, formValues, PageHeader } from "@/components/cases/page-header";
import { StatusChip } from "@/components/cases/status-chip";
import { CaseForm } from "@/components/forms/case-form";
import { ReasonAction } from "@/components/progress/reason-action";
import { formatDate } from "@/lib/dates";
import { amendmentHref } from "@/components/cases/case-view";
import { getNomination } from "@/server/amendments/queries";
import { nominateRefusal } from "@/server/amendments/rules";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices, provinceOptions } from "@/server/lists/queries";
import {
  checkNominationNicAction,
  nominateAction,
  removeNominationDocumentAction,
  sendBackNominationAction,
  uploadNominationDocumentAction,
} from "./actions";

/**
 * AMD-13: a DS's request that the District nominate a new beneficiary. A District officer of the district
 * where the case is built enters the new beneficiary on the amendment form, choosing their DS of residence
 * among the district's other DS offices, or sends the request back with a reason. Every other account that
 * sees the case reads the request only (PRM-4); a request already nominated links to its amendment.
 */
export default async function NominationPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const [locale, { id }] = await Promise.all([getLocale(), params]);
  const view = await getNomination(db, viewer, id, locale);
  if (!view) notFound();
  const { existing } = view;
  const t = await getTranslations("cases");
  const tp = await getTranslations("progress");
  const name = caseName(t, existing.name, existing.childName);
  const acts =
    nominateRefusal({ role: viewer.role, district: existing.actsOn.nominate }, { status: view.status }) === null;

  const [districts, provinces] = acts
    ? await Promise.all([districtsWithOffices(db, locale), provinceOptions(db, locale)])
    : [[], []];
  // AMD-13: the new beneficiary lives in another active DS office of the district; the land follows AMD-8.
  const residenceChoices = districts
    .filter((d) => d.id === existing.buildDistrictId)
    .map((d) => ({ ...d, offices: d.offices.filter((o) => o.active && o.id !== existing.dsOfficeId) }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        backHref={`/oversight/cases/${existing.id}`}
        backLabel={t("back.case")}
        title={t("nominate.title")}
        subtitle={[existing.applicationNumber, name, existing.officeName].join(" · ")}
      />
      <section
        aria-labelledby="request-title"
        data-testid="nomination-request"
        className="flex max-w-4xl flex-col gap-1.5 rounded-xl border bg-card px-6 py-4.5"
      >
        <h2 id="request-title" className="text-[15px] font-semibold text-muted-foreground">
          {t("nominate.request")}
        </h2>
        <p className="flex flex-wrap items-center gap-3 text-lg">
          <strong data-testid="existing-beneficiary">{name}</strong>
          <span className="text-muted-foreground">{existing.applicationNumber}</span>
          <StatusChip status={existing.status} />
        </p>
        <p>{t("nominate.askedBy", { date: formatDate(view.askedAt), who: view.askedByName })}</p>
        <p className="whitespace-pre-line">{t("amend.reasonLine", { reason: view.reason })}</p>
        {view.status === "SENT_BACK" && (
          <p className="font-semibold whitespace-pre-line">
            {t("nominate.sentBackBy", {
              date: view.sentBackAt ? formatDate(view.sentBackAt) : "",
              who: view.sentBackByName ?? t("none"),
              reason: view.sentBackReason ?? "",
            })}
          </p>
        )}
        {view.amendmentId && (
          <Link
            href={amendmentHref("oversight", view.amendmentId)}
            className="self-start font-semibold text-primary underline"
          >
            {t("amend.openAmendment")}
          </Link>
        )}
        {acts && (
          <>
            <p className="text-[15px] text-soft-foreground">{t("nominate.intro", { office: existing.officeName })}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <ReasonAction
                key={`send-back-${view.version}`}
                id="send-back"
                look="danger"
                hidden={{ nominationId: view.id, version: String(view.version), caseId: existing.id }}
                action={sendBackNominationAction}
                texts={{
                  button: t("nominate.sendBack.button"),
                  title: t("nominate.sendBack.title"),
                  text: t("nominate.sendBack.text", { office: existing.officeName }),
                  reason: t("nominate.sendBack.reason"),
                  reasonHelp: tp("reasonPopup.reasonHelp"),
                  confirm: t("nominate.sendBack.confirm"),
                  cancel: tp("reasonPopup.cancel"),
                  working: tp("reasonPopup.working"),
                }}
              />
            </div>
          </>
        )}
      </section>
      {acts && (
        <CaseForm
          // The amendment's id is chosen now, so sending this form twice makes one amendment (ERR-8).
          caseId={randomUUID()}
          version={existing.version}
          initial={formValues(null)}
          office={{
            kind: "choose",
            districts: residenceChoices,
            districtId: existing.buildDistrictId,
            dsOfficeId: null,
          }}
          build={amendBuild(existing, districts)}
          provinces={provinces}
          documents={[]}
          mode="amend"
          amend={{
            caseId: existing.id,
            existingName: name,
            existingNumber: existing.applicationNumber,
            nomination: { id: view.id, version: view.version },
          }}
          actions={{
            save: nominateAction,
            upload: uploadNominationDocumentAction,
            checkNic: checkNominationNicAction,
            removeDocument: removeNominationDocumentAction,
          }}
        />
      )}
    </div>
  );
}
