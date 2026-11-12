import Link from "next/link";
import type { BuildSetting, CaseFormStart, CentreFormValues } from "@/components/forms/case-form";
import type { PartialDate } from "@/lib/validation/case";
import type { CaseDetails } from "@/server/cases/queries";
import type { DistrictOptions } from "@/server/lists/queries";

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

/**
 * The case form's starting values: a saved case's, or empty for a new one. A case entered before change
 * 0007 starts with its new details empty, and the form asks for them (CASE-9).
 */
export function formValues(details: CaseDetails | null): CaseFormStart {
  const text = (value: string | number | null | undefined) =>
    value === null || value === undefined ? "" : String(value);
  return {
    values: {
      category: text(details?.category),
      careGroup: text(details?.careGroup),
      kind: text(details?.kind),
      landGnDivision: text(details?.landGnDivision),
      applicationNumber: text(details?.applicationNumber),
      childName: text(details?.childName),
      name: text(details?.name),
      dateOfBirth: text(details?.dateOfBirth),
      relationship: text(details?.relationship),
      relationshipOther: text(details?.relationshipOther),
      maritalStatus: text(details?.maritalStatus),
      nic: text(details?.nic),
      address: text(details?.address),
      gnDivision: text(details?.gnDivision),
      mobile1: text(details?.mobile1),
      mobile2: text(details?.mobile2),
      remark: text(details?.remark),
      familyMembers: text(details?.familyMembers),
      disabledChildren: details?.disabledChildren == null ? "" : details.disabledChildren ? "yes" : "no",
      aid: (details?.aid ?? []).join(","),
      aidOther: text(details?.aidOther),
    },
    centres: (details?.centres ?? []).map((centre): CentreFormValues => {
      const date = (d: PartialDate | null) => ({ year: text(d?.year), month: text(d?.month), day: text(d?.day) });
      const from = date(centre.from);
      const until = date(centre.until);
      return {
        name: centre.name,
        provinceId: String(centre.provinceId),
        fromYear: from.year,
        fromMonth: from.month,
        fromDay: from.day,
        untilYear: until.year,
        untilMonth: until.month,
        untilDay: until.day,
      };
    }),
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

/**
 * CASE-13: the form's "where is it built?" for a saved case, or a new one (`details` null): asked while the
 * case awaits its allocation, fixed after.
 */
export function buildSetting(
  details: CaseDetails | null,
  canChange: boolean,
  districts: DistrictOptions[],
): BuildSetting {
  const elsewhere = details && details.buildDsOfficeId !== details.dsOfficeId ? details : null;
  if (canChange) {
    return {
      kind: "choose",
      districts,
      districtId: elsewhere?.buildDistrictId ?? null,
      dsOfficeId: elsewhere?.buildDsOfficeId ?? null,
    };
  }
  return {
    kind: "fixed",
    dsOfficeId: elsewhere?.buildDsOfficeId ?? null,
    districtName: elsewhere?.buildDistrictName ?? "",
    officeName: elsewhere?.buildOfficeName ?? "",
  };
}
