import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import type { CaseRow } from "@/server/cases/queries";
import { caseName } from "./page-header";
import { StatusChip } from "./status-chip";

/**
 * FND-1: a page of cases with their office and district, as Head Office and the view-only area show
 * them. `href` gives each case's link on the reader's own pages.
 */
export async function CaseTable({ rows, href }: { rows: CaseRow[]; href: (row: CaseRow) => string }) {
  const t = await getTranslations("cases");
  if (rows.length === 0) return <p className="px-5 py-8 text-center text-muted-foreground">{t("list.empty")}</p>;
  return (
    <table className="w-full border-collapse text-left">
      <thead className="bg-muted/60 text-[15px] text-muted-foreground">
        <tr>
          <th scope="col" className="px-5 py-2.5 font-semibold">
            {t("list.columns.beneficiary")}
          </th>
          <th scope="col" className="px-3 py-2.5 font-semibold">
            {t("list.columns.office")}
          </th>
          <th scope="col" className="px-3 py-2.5 font-semibold">
            {t("list.columns.kind")}
          </th>
          <th scope="col" className="px-3 py-2.5 font-semibold">
            {t("list.columns.status")}
          </th>
          <th scope="col" className="px-5 py-2.5 font-semibold">
            {t("list.columns.updated")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t hover:bg-accent/60">
            <td className="px-5 py-2.5">
              <Link href={href(row)} className="flex flex-col">
                <span className="text-[17px] font-semibold text-primary underline-offset-2 hover:underline">
                  {caseName(t, row.name, row.childName)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {row.applicationNumber ?? t("noNumber")}
                  {row.category && ` · ${t(`category.${row.category}`)}`}
                </span>
              </Link>
            </td>
            <td className="px-3 py-2.5">
              <span className="flex flex-col">
                <span>{row.officeName}</span>
                <span className="text-sm text-muted-foreground">{row.districtName}</span>
              </span>
            </td>
            <td className="px-3 py-2.5">{row.kind ? t(`kindShort.${row.kind}`) : t("none")}</td>
            <td className="px-3 py-2.5">
              <StatusChip status={row.status} />
            </td>
            <td className="px-5 py-2.5 tabular-nums">{formatDate(row.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
