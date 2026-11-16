import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AmendmentStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/dates";
import type { AmendmentView as View } from "@/server/amendments/queries";
import { type Audience, type BeneficiaryFields, caseFieldRows, DocumentLinks } from "../cases/case-view";
import { caseName } from "../cases/page-header";

/** The amendment's own status colours, as the case statuses' (UI-6): waiting, approved, rejected. */
const STYLE: Record<AmendmentStatus, string> = {
  WAITING: "bg-[#FBEBD3] text-[#8A4A06]",
  APPROVED: "bg-primary text-primary-foreground",
  REJECTED: "bg-[#ECECEC] text-[#4A4A4A]",
};

export async function AmendmentStatusChip({ status }: { status: AmendmentStatus }) {
  const t = await getTranslations("cases");
  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-sm font-semibold whitespace-nowrap ${STYLE[status]}`}>
      {t(`amend.status.${status}`)}
    </span>
  );
}

/**
 * AMD-4: one amendment, shared by the Ministry's page, the DS's and the view-only area's: who submitted it and why, the decision, and the existing and the new beneficiary side by
 * side, each as the case page's details show a case. `actions` are the Ministry's approve and reject, and
 * `above` what goes over the two beneficiaries, such as the new NIC's matches (CASE-6).
 */
export async function AmendmentView({
  view,
  audience,
  actions,
  above,
}: {
  view: View;
  audience: Audience;
  actions?: React.ReactNode;
  above?: React.ReactNode;
}) {
  const t = await getTranslations("cases");
  const caseHref = (id: string) => `/${audience}/cases/${id}`;

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-labelledby="amendment-summary"
        className="flex max-w-4xl flex-col gap-1.5 rounded-xl border bg-card px-6 py-4.5"
      >
        <h2 id="amendment-summary" className="sr-only">
          {t("amend.view.title")}
        </h2>
        <p>{t("amend.view.submittedBy", { date: formatDate(view.submittedAt), name: view.submittedByName })}</p>
        <p className="whitespace-pre-line" data-testid="amendment-reason">
          {t("amend.reasonLine", { reason: view.reason })}
        </p>
        {view.status !== "WAITING" && view.decidedAt && (
          <p className="font-semibold">
            {t(view.status === "APPROVED" ? "amend.view.approvedBy" : "amend.view.rejectedBy", {
              date: formatDate(view.decidedAt),
              name: view.decidedByName ?? t("none"),
            })}
          </p>
        )}
        {view.rejectionReason && (
          <p className="whitespace-pre-line" data-testid="rejection-reason">
            {t("amend.rejectionReason", { reason: view.rejectionReason })}
          </p>
        )}
        {view.newCase && (
          <Link href={caseHref(view.newCase.id)} className="self-start font-semibold text-primary underline">
            {t("page.openOther", { number: view.newCase.applicationNumber })}
          </Link>
        )}
        {actions && <div className="mt-2 flex flex-wrap items-center gap-3">{actions}</div>}
      </section>
      {above}
      <div className="grid max-w-[1360px] items-start gap-6 lg:grid-cols-2">
        <Beneficiary
          id="existing"
          title={t("amend.existing")}
          subtitle={caseName(t, view.existing.name, view.existing.childName)}
          fields={view.existing}
          documents={view.existing.documents}
          open={{ href: caseHref(view.existing.id), number: view.existing.applicationNumber }}
        />
        <Beneficiary
          id="new"
          title={t("amend.newBeneficiary")}
          subtitle={view.proposed ? caseName(t, view.proposed.name, view.proposed.childName) : null}
          fields={view.proposed}
          documents={view.documents}
          open={null}
        />
      </div>
    </div>
  );
}

async function Beneficiary({
  id,
  title,
  subtitle,
  fields,
  documents,
  open,
}: {
  id: string;
  title: string;
  subtitle: string | null;
  fields: BeneficiaryFields | null;
  documents: { id: string; name: string }[];
  open: { href: string; number: string } | null;
}) {
  const t = await getTranslations("cases");
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={`${id}-beneficiary`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card px-5.5 py-5"
    >
      <div className="flex flex-col">
        <h2 id={`${id}-title`} className="text-[15px] font-semibold text-muted-foreground">
          {title}
        </h2>
        {subtitle && <p className="text-xl font-bold">{subtitle}</p>}
      </div>
      {fields ? (
        <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5">
          {caseFieldRows(t, fields).map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-[15px] text-muted-foreground">{row.label}</dt>
              <dd className="font-semibold break-words whitespace-pre-line">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground">{t("amend.view.unreadable")}</p>
      )}
      <h3 className="mt-2 border-t pt-3 text-base font-bold">{t("page.documents")}</h3>
      <DocumentLinks documents={documents} empty={t("page.noDocuments")} />
      {open && (
        <Link href={open.href} className="self-start font-semibold text-primary underline">
          {t("page.openOther", { number: open.number })}
        </Link>
      )}
    </section>
  );
}
