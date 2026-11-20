import { FilePen, FileX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { type Audience, amendmentHref } from "@/components/cases/case-view";
import { caseName } from "@/components/cases/page-header";
import { formatDate } from "@/lib/dates";
import type { CaseDetails } from "@/server/cases/queries";

/**
 * AMD-3, AMD-6: a case page's box for the case's amendment, on every account's case page (PRM-4): the one
 * waiting for the Ministry, with the new beneficiary it proposes and its reason, and what it holds until
 * then; or else the last one, if the Ministry rejected it, with the Ministry's reason. `ownOffice` adds the
 * line for the DS of residence that another amendment may be submitted. It links to the amendment's page
 * on the reader's own pages (`amendmentHref`).
 */
export async function AmendmentNotes({
  details,
  ownOffice,
  audience,
}: {
  details: CaseDetails;
  ownOffice: boolean;
  audience: Audience;
}) {
  const amendment = details.amendment;
  if (!amendment) return null;
  const t = await getTranslations("cases");
  const open = (
    <Link
      href={amendmentHref(audience, amendment.id)}
      className="self-start font-semibold underline underline-offset-2"
    >
      {t("amend.openAmendment")}
    </Link>
  );
  const person = {
    name: caseName(t, amendment.name, amendment.childName),
    number: amendment.applicationNumber,
  };

  if (amendment.status === "WAITING") {
    return (
      <section
        aria-labelledby="amendment-title"
        data-testid="amendment-waiting"
        className="flex max-w-4xl items-start gap-3 rounded-xl border border-warning-border bg-warning px-5 py-4 text-warning-foreground"
      >
        <FilePen aria-hidden="true" className="mt-0.5 size-5.5 shrink-0" />
        <div className="flex flex-col gap-1">
          <h2 id="amendment-title" className="text-[17px] font-bold">
            {t("amend.waitingTitle")}
          </h2>
          <p>{t("amend.waitingText", { date: formatDate(amendment.submittedAt), ...person })}</p>
          <p className="whitespace-pre-line">{t("amend.reasonLine", { reason: amendment.reason })}</p>
          <p className="text-[15px]">{t("amend.waitingHold")}</p>
          {open}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="amendment-title"
      data-testid="amendment-rejected"
      className="flex max-w-4xl items-start gap-3 rounded-xl border bg-muted px-5 py-4"
    >
      <FileX aria-hidden="true" className="mt-0.5 size-5.5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h2 id="amendment-title" className="text-[17px] font-bold">
          {t("amend.rejectedTitle", { date: amendment.decidedAt ? formatDate(amendment.decidedAt) : "" })}
        </h2>
        <p>{t("amend.rejectedText", person)}</p>
        <p className="whitespace-pre-line">{t("amend.rejectionReason", { reason: amendment.rejectionReason ?? "" })}</p>
        {ownOffice && <p className="text-[15px] text-soft-foreground">{t("amend.again")}</p>}
        {open}
      </div>
    </section>
  );
}
