import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AmendmentStatus } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/dates";
import type { AmendmentRow } from "@/server/amendments/queries";
import { amendmentHref, type Audience } from "../cases/case-view";
import { caseName } from "../cases/page-header";

/**
 * AMD-9: one tab of an amendments list: the day it was submitted, the DS office, the existing and the new
 * beneficiary, and for a decided one the day and, when rejected, the reason. The new beneficiary's name
 * opens the amendment on the reader's own pages.
 */
export async function AmendmentTable({
  rows,
  status,
  audience,
}: {
  rows: AmendmentRow[];
  status: AmendmentStatus;
  audience: Audience;
}) {
  const t = await getTranslations("cases");
  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-muted-foreground">{t(`amend.list.empty.${status}`)}</p>;
  }
  const decided = status !== "WAITING";
  const person = (name: string, number: string) => (
    <>
      <span className="text-[17px] font-semibold">{name}</span>
      <span className="text-sm text-muted-foreground">{number}</span>
    </>
  );

  return (
    <table className="w-full border-collapse text-left" data-testid="amendment-table">
      <thead className="bg-muted/60 text-[15px] text-muted-foreground">
        <tr>
          <th scope="col" className="px-5 py-2.5 font-semibold">
            {t("amend.list.columns.submitted")}
          </th>
          <th scope="col" className="px-3 py-2.5 font-semibold">
            {t("list.columns.office")}
          </th>
          <th scope="col" className="px-3 py-2.5 font-semibold">
            {t("amend.existing")}
          </th>
          <th scope="col" className="px-3 py-2.5 font-semibold">
            {t("amend.newBeneficiary")}
          </th>
          {decided && (
            <th scope="col" className="px-3 py-2.5 font-semibold">
              {t("amend.list.columns.decided")}
            </th>
          )}
          {status === "REJECTED" && (
            <th scope="col" className="px-5 py-2.5 font-semibold">
              {t("amend.list.columns.reason")}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t align-top hover:bg-accent/60">
            <td className="px-5 py-2.5 whitespace-nowrap tabular-nums">{formatDate(row.submittedAt)}</td>
            <td className="px-3 py-2.5">
              <span className="flex flex-col">
                <span>{row.officeName}</span>
                <span className="text-sm text-muted-foreground">{row.districtName}</span>
              </span>
            </td>
            <td className="px-3 py-2.5">
              <span className="flex flex-col">
                {person(caseName(t, row.existing.name, row.existing.childName), row.existing.applicationNumber)}
              </span>
            </td>
            <td className="px-3 py-2.5">
              <Link
                href={amendmentHref(audience, row.id)}
                className="flex flex-col text-primary underline-offset-2 hover:underline"
              >
                {person(caseName(t, row.proposed.name, row.proposed.childName), row.proposed.applicationNumber)}
              </Link>
            </td>
            {decided && (
              <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                {row.decidedAt ? formatDate(row.decidedAt) : t("none")}
              </td>
            )}
            {status === "REJECTED" && (
              <td className="max-w-md px-5 py-2.5 text-[15px] whitespace-pre-line">
                {row.rejectionReason ?? t("none")}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
