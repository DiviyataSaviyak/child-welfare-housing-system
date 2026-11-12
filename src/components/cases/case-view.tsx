import { ArrowRightLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { colomboDay, formatDate } from "@/lib/dates";
import { ageOn, formatPartialDate } from "@/lib/validation/case";
import type { CaseDetails, CentreDetails } from "@/server/cases/queries";
import { caseName } from "./page-header";

/**
 * Whose case page shows the case: the DS office, Head Office, or the view-only area (PRM-5), which reads
 * it as Head Office does and links to its own pages.
 */
export type Audience = "ds" | "ministry" | "oversight";

type CasesT = Awaited<ReturnType<typeof getTranslations<"cases">>>;

/** A centre as one line: "name, province (from – until)", each date as precise as it was entered (CASE-14). */
export function centreLine(t: CasesT, centre: CentreDetails): string {
  const from = centre.from ? formatPartialDate(centre.from) : "";
  const until = centre.until ? formatPartialDate(centre.until) : "";
  return from || until
    ? t("page.centreLine", { name: centre.name, province: centre.provinceName, dates: `${from} – ${until}`.trim() })
    : t("page.centreLineNoDates", { name: centre.name, province: centre.provinceName });
}

/**
 * Every field of a case as label and value, for the case page: the land under the kind of help (CASE-17),
 * then the beneficiary, the family and the aid (CASE-14 to CASE-16). A detail a case entered before change
 * 0007 doesn't have reads "none".
 */
export function caseFieldRows(
  t: CasesT,
  details: CaseDetails,
  today: string = colomboDay(new Date()),
): { label: string; value: string }[] {
  const atRisk = details.category === "CHILD_AT_RISK";
  const careLeaver = details.category === "CARE_LEAVER";
  const none = t("none");
  const typed = (label: string, text: string | null) => t("otherTyped", { label, text: text ?? "" });
  const relationship =
    details.relationship === "OTHER"
      ? typed(t("relationship.OTHER"), details.relationshipOther)
      : details.relationship && t(`relationship.${details.relationship}`);
  const aid = details.aid
    .map((a) => (a === "OTHER" ? typed(t("aid.OTHER"), details.aidOther) : t(`aid.${a}`)))
    .join(", ");
  const yesNo = details.disabledChildren === null ? none : t(details.disabledChildren ? "yes" : "no");
  return [
    { label: t("page.fields.number"), value: details.applicationNumber },
    { label: t("page.fields.category"), value: t(`category.${details.category}`) },
    ...(careLeaver
      ? [{ label: t("page.fields.careGroup"), value: details.careGroup ? t(`careGroup.${details.careGroup}`) : none }]
      : []),
    { label: t("page.fields.kind"), value: t(`kind.${details.kind}`) },
    {
      label: details.kind === "RENOVATION" ? t("page.fields.landHouse") : t("page.fields.land"),
      value: t("form.land.place", {
        province: details.buildProvinceName,
        district: details.buildDistrictName,
        office: details.buildOfficeName,
      }),
    },
    { label: t("page.fields.landGnDivision"), value: details.landGnDivision ?? none },
    ...(atRisk ? [{ label: t("page.fields.childName"), value: details.childName ?? none }] : []),
    {
      label: atRisk ? t("page.fields.childDateOfBirth") : t("page.fields.dateOfBirth"),
      value: details.dateOfBirth
        ? t("page.dateWithAge", { date: formatDate(details.dateOfBirth), years: ageOn(details.dateOfBirth, today) })
        : none,
    },
    { label: atRisk ? t("page.fields.guardianName") : t("page.fields.name"), value: details.name ?? none },
    ...(atRisk ? [{ label: t("page.fields.relationship"), value: relationship || none }] : []),
    { label: t("page.fields.nic"), value: details.nic ?? none },
    ...(careLeaver
      ? [
          {
            label: t("page.fields.maritalStatus"),
            value: details.maritalStatus ? t(`maritalStatus.${details.maritalStatus}`) : none,
          },
        ]
      : []),
    { label: t("page.fields.address"), value: details.address ?? none },
    { label: t("page.fields.gnDivision"), value: details.gnDivision ?? none },
    { label: t("page.fields.mobile1"), value: details.mobile1 ?? none },
    { label: t("page.fields.mobile2"), value: details.mobile2 ?? none },
    ...(careLeaver
      ? [
          {
            label: t("page.fields.centres"),
            value: details.centres.length > 0 ? details.centres.map((c) => centreLine(t, c)).join("\n") : none,
          },
        ]
      : []),
    {
      label: t("page.fields.familyMembers"),
      value: details.familyMembers === null ? none : String(details.familyMembers),
    },
    { label: t("page.fields.disabledChildren"), value: yesNo },
    // An empty list is "none received"; an older case that was never asked reads the same.
    { label: t("page.fields.aid"), value: aid || t("page.noAid") },
    { label: t("page.fields.remark"), value: details.remark ?? none },
    { label: t("page.fields.province"), value: details.provinceName },
    { label: t("page.fields.district"), value: details.districtName },
    { label: t("page.fields.office"), value: details.officeName },
    { label: t("page.fields.createdAt"), value: formatDate(details.createdAt) },
  ];
}

/**
 * The links version 1's CASE-11 made, as in the prototype: a case entered in place of another names it,
 * with the Ministry's decision on it; a replaced case names the case entered in its place. Each links to
 * the other case on the reader's own pages. Change 0006 removed CASE-11; change 0008's amendments take
 * its place.
 */
export async function ReplacementNotes({ details, audience }: { details: CaseDetails; audience: Audience }) {
  const { replaces, replacedBy } = details;
  if (!replaces && !replacedBy) return null;
  const t = await getTranslations("cases");
  const caseHref = (id: string) => `/${audience}/cases/${id}`;

  return (
    <div className="flex flex-col gap-3">
      {replaces && (
        <ReplacementBox
          id="replaces-title"
          title={t("page.replacesTitle", {
            number: replaces.applicationNumber,
            name: caseName(t, replaces.name, replaces.childName),
          })}
        >
          {replaces.decision && (
            <p>
              {t(replaces.decision.type === "STOP" ? "page.replacesStopped" : "page.replacesRejected", {
                date: formatDate(replaces.decision.at),
              })}
            </p>
          )}
          {replaces.decision?.reason && (
            <p className="whitespace-pre-line">{t("page.replacesReason", { reason: replaces.decision.reason })}</p>
          )}
          <Link href={caseHref(replaces.id)} className="self-start font-semibold text-primary underline">
            {t("page.openOther", { number: replaces.applicationNumber })}
          </Link>
        </ReplacementBox>
      )}
      {replacedBy && (
        <ReplacementBox
          id="replaced-title"
          title={t("page.replacedBy", {
            number: replacedBy.applicationNumber,
            name: caseName(t, replacedBy.name, replacedBy.childName),
          })}
        >
          <Link href={caseHref(replacedBy.id)} className="self-start font-semibold text-primary underline">
            {t("page.openOther", { number: replacedBy.applicationNumber })}
          </Link>
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
          {t("page.edit")}
        </Link>
      )}
    </section>
  );
}

/**
 * The line under a case page's title: the Application Number, the office (for all but the DS office;
 * for the DS office, the other office when it is built in another DS division), category and kind.
 */
export async function caseSubtitle(details: CaseDetails, audience: Audience): Promise<string> {
  const t = await getTranslations("cases");
  const elsewhere = details.buildDsOfficeId !== details.dsOfficeId;
  return [
    details.applicationNumber,
    ...(audience !== "ds" ? [details.officeName] : []),
    ...(elsewhere ? [t("home.builtIn", { office: details.buildOfficeName })] : []),
    t(`category.${details.category}`),
    t(`kind.${details.kind}`),
  ].join(" · ");
}

/** A case's documents, each opening in a new tab. */
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
