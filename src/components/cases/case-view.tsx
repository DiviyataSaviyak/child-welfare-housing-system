import { ArrowRightLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import type { CaseDetails } from "@/server/cases/queries";
import { caseName } from "./page-header";

type CasesT = Awaited<ReturnType<typeof getTranslations<"cases">>>;

/** Every field of a case as label and value, for the case page and Head Office's check view (CHK-2). */
export function caseFieldRows(t: CasesT, details: CaseDetails): { label: string; value: string }[] {
  const atRisk = details.category === "CHILD_AT_RISK";
  const none = t("none");
  return [
    { label: t("page.fields.number"), value: details.caseNumber ?? t("noNumber") },
    { label: t("page.fields.category"), value: details.category ? t(`category.${details.category}`) : none },
    { label: t("page.fields.kind"), value: details.kind ? t(`kind.${details.kind}`) : none },
    ...(atRisk ? [{ label: t("page.fields.childName"), value: details.childName ?? none }] : []),
    { label: atRisk ? t("page.fields.guardianName") : t("page.fields.name"), value: details.name ?? none },
    { label: t("page.fields.nic"), value: details.nic ?? none },
    { label: t("page.fields.address"), value: details.address ?? none },
    { label: t("page.fields.gnDivision"), value: details.gnDivision ?? none },
    { label: t("page.fields.mobile1"), value: details.mobile1 ?? none },
    { label: t("page.fields.mobile2"), value: details.mobile2 ?? none },
    { label: t("page.fields.remark"), value: details.remark ?? none },
    { label: t("page.fields.office"), value: details.officeName },
    { label: t("page.fields.district"), value: details.districtName },
    ...(details.submittedAt ? [{ label: t("page.fields.submittedAt"), value: formatDate(details.submittedAt) }] : []),
    ...(details.verifiedAt ? [{ label: t("page.fields.verifiedAt"), value: formatDate(details.verifiedAt) }] : []),
  ];
}

/** A Head Office reason the DS office must read: why the case came back, or why it was rejected. */
function ReasonBox({ id, title, reason, tone }: { id: string; title: string; reason: string; tone: "warn" | "stop" }) {
  return (
    <section
      aria-labelledby={id}
      className={`flex flex-col gap-1.5 rounded-xl border-2 px-6 py-4 ${
        tone === "warn"
          ? "border-[#E8B45A] bg-[#FFF4E0] text-[#6B3A04]"
          : "border-[#E4A39B] bg-[#FDF0EE] text-[#8F1B12]"
      }`}
    >
      <h2 id={id} className="text-lg font-bold">
        {title}
      </h2>
      <p className="text-[17px] font-semibold whitespace-pre-line">{reason}</p>
    </section>
  );
}

/**
 * What the reader must see first, above the case's columns: Head Office's reason when the case was sent
 * back or rejected, and the DS office's note while Head Office has the case.
 */
export async function CaseNotes({ details, audience }: { details: CaseDetails; audience: "ds" | "ho" }) {
  const t = await getTranslations("cases");
  const waiting = audience === "ds" && (details.status === "SUBMITTED" || details.status === "VERIFIED");
  if (details.returnReason === null && details.rejectReason === null && !waiting) return null;
  return (
    <div className="flex flex-col gap-3">
      {details.returnReason !== null && (
        <ReasonBox id="returned-title" title={t("form.returned.title")} reason={details.returnReason} tone="warn" />
      )}
      {details.rejectReason !== null && (
        <ReasonBox id="rejected-title" title={t("page.rejectedTitle")} reason={details.rejectReason} tone="stop" />
      )}
      {waiting && (
        <p className="rounded-lg bg-[#E4EDF8] px-4 py-3 text-[15px] text-[#1E4E8C]">
          {details.status === "SUBMITTED" ? t("page.waiting") : t("page.verifiedDs")}
        </p>
      )}
    </div>
  );
}

/**
 * CASE-11, as in the prototype: a case entered in place of another names it, with Head Office's
 * decision on it; a case Head Office asked to replace says so, and names its replacement once there is
 * one. Each links to the other case on the reader's own pages.
 */
export async function ReplacementNotes({ details, audience }: { details: CaseDetails; audience: "ds" | "ho" }) {
  if (!details.replaces && !details.anotherNameRequested) return null;
  const t = await getTranslations("cases");
  const caseHref = (id: string) => `/${audience}/cases/${id}`;
  const number = (caseNumber: string | null) => caseNumber ?? t("noNumber");
  const { replaces, replacedBy } = details;

  return (
    <div className="flex flex-col gap-3">
      {replaces && (
        <ReplacementBox
          id="replaces-title"
          title={t("page.replacesTitle", {
            number: number(replaces.caseNumber),
            name: caseName(t, replaces.name, replaces.childName),
          })}
        >
          {replaces.decidedAt && (
            <p>
              {t(replaces.status === "STOPPED" ? "page.replacesStopped" : "page.replacesRejected", {
                date: formatDate(replaces.decidedAt),
              })}
            </p>
          )}
          {replaces.reason && (
            <p className="whitespace-pre-line">{t("page.replacesReason", { reason: replaces.reason })}</p>
          )}
          <Link href={caseHref(replaces.id)} className="self-start font-semibold text-primary underline">
            {t("page.openOther", { number: number(replaces.caseNumber) })}
          </Link>
        </ReplacementBox>
      )}
      {details.anotherNameRequested && (
        <ReplacementBox id="asked-title" title={t("page.askedTitle")}>
          {replacedBy ? (
            <>
              <p>
                {t("page.askedDone", {
                  number: number(replacedBy.caseNumber),
                  name: caseName(t, replacedBy.name, replacedBy.childName),
                })}
              </p>
              <Link href={caseHref(replacedBy.id)} className="self-start font-semibold text-primary underline">
                {t("page.openOther", { number: number(replacedBy.caseNumber) })}
              </Link>
            </>
          ) : (
            <>
              <p>{t("page.askedWaiting")}</p>
              {audience === "ds" && (
                <Link
                  href="/ds/cases/new"
                  className="flex h-11.5 items-center self-start rounded-lg bg-primary px-4.5 font-bold text-primary-foreground"
                >
                  {t("page.askedEnter")}
                </Link>
              )}
            </>
          )}
        </ReplacementBox>
      )}
    </div>
  );
}

function ReplacementBox({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex items-start gap-3 rounded-xl border border-[#A9CBBF] bg-accent px-5 py-4 text-accent-foreground"
    >
      <ArrowRightLeft aria-hidden="true" className="mt-0.5 size-5.5 shrink-0" />
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-[17px] font-bold">
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

/**
 * The case page's two columns, as in the prototype: money, decisions and history on the left; stages
 * and the beneficiary's details on the right. On a narrower screen the right column goes below (UI-2).
 */
export function CaseColumns({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="grid max-w-[1360px] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="flex min-w-0 flex-col gap-6">{main}</div>
      <div className="flex min-w-0 flex-col gap-6">{side}</div>
    </div>
  );
}

/** "ප්‍රතිලාභියාගේ විස්තර": every field and the documents, read-only, with the edit button when allowed. */
export async function CaseDetailsSection({ details, editHref }: { details: CaseDetails; editHref: string | null }) {
  const t = await getTranslations("cases");
  const rows = caseFieldRows(t, details);

  return (
    <section aria-labelledby="details-title" className="flex flex-col gap-3 rounded-xl border bg-card px-5.5 py-5">
      <h2 id="details-title" className="text-xl font-bold">
        {t("page.details")}
      </h2>
      <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-[15px] text-muted-foreground">{row.label}</dt>
            <dd className="font-semibold break-words whitespace-pre-line">{row.value}</dd>
          </div>
        ))}
      </dl>
      <h3 id="documents-title" className="mt-2 border-t pt-3 text-base font-bold">
        {t("page.documents")}
      </h3>
      <DocumentLinks documents={details.documents} empty={t("page.noDocuments")} />
      {editHref && (
        <Link
          href={editHref}
          className="mt-1 flex h-12 items-center self-start rounded-lg bg-primary px-6 text-[17px] font-semibold text-primary-foreground"
        >
          {details.status === "RETURNED" ? t("page.fix") : t("page.edit")}
        </Link>
      )}
    </section>
  );
}

/** The line under a case page's title: number, office (for Head Office), category and kind. */
export async function caseSubtitle(details: CaseDetails, audience: "ds" | "ho"): Promise<string> {
  const t = await getTranslations("cases");
  return [
    details.caseNumber ?? t("noNumber"),
    ...(audience === "ho" ? [details.officeName] : []),
    ...(details.category ? [t(`category.${details.category}`)] : []),
    ...(details.kind ? [t(`kind.${details.kind}`)] : []),
  ].join(" · ");
}

/** A case's documents, each opening in a new tab (CHK-2). */
export function DocumentLinks({ documents, empty }: { documents: CaseDetails["documents"]; empty: string }) {
  if (documents.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {documents.map((doc) => (
        <li key={doc.id}>
          <a href={`/files/${doc.id}`} target="_blank" rel="noopener" className="font-semibold text-primary underline">
            {doc.name}
          </a>
        </li>
      ))}
    </ul>
  );
}
