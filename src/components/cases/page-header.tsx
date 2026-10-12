import Link from "next/link";
import { formatDate } from "@/lib/dates";
import type { CaseDetails } from "@/server/cases/queries";
import type { ReplacementRequest } from "@/server/cases/replacements";
import type { CaseFormValues, ReplacementOption } from "@/components/forms/case-form";

/** A case page's back link, title and one line under it, as in the prototype. */
export function PageHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  aside,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  subtitle?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div className="flex flex-col gap-1">
        <Link href={backHref} className="self-start text-base font-semibold text-primary">
          ← {backLabel}
        </Link>
        <h1 className="mt-1.5 text-[28px] leading-snug font-bold">{title}</h1>
        {subtitle && <div className="text-muted-foreground">{subtitle}</div>}
      </div>
      {aside}
    </div>
  );
}

/** The case form's starting values: a saved case's, or empty for a new one. */
export function formValues(details: CaseDetails | null): CaseFormValues {
  return {
    category: details?.category ?? "",
    kind: details?.kind ?? "",
    childName: details?.childName ?? "",
    name: details?.name ?? "",
    nic: details?.nic ?? "",
    address: details?.address ?? "",
    gnDivision: details?.gnDivision ?? "",
    mobile1: details?.mobile1 ?? "",
    mobile2: details?.mobile2 ?? "",
    remark: details?.remark ?? "",
  };
}

/** A case's name for lists and titles: the child's name too for a child at risk (HOME-1). */
export function caseName(
  t: (key: "noName" | "withChild", values?: Record<string, string>) => string,
  name: string | null,
  childName: string | null,
): string {
  const shown = name ?? t("noName");
  return childName ? t("withChild", { name: shown, child: childName }) : shown;
}

/** The cases the case form offers to replace (CASE-11), with their names and days written out. */
export function replacementOptions(
  t: (key: "noName" | "withChild" | "noNumber", values?: Record<string, string>) => string,
  requests: ReplacementRequest[],
): ReplacementOption[] {
  return requests.map((request) => ({
    id: request.id,
    dsOfficeId: request.dsOfficeId,
    number: request.caseNumber ?? t("noNumber"),
    name: caseName(t, request.name, request.childName),
    stopped: request.status === "STOPPED",
    date: request.decidedAt ? formatDate(request.decidedAt) : null,
    reason: request.reason,
  }));
}
