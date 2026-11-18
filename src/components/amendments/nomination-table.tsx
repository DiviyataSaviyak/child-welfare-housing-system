import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import type { NominationRow } from "@/server/amendments/queries";
import { caseName } from "../cases/page-header";

/**
 * AMD-12: the District's "to nominate" tab: the day the DS asked, the DS office, the existing beneficiary
 * (whose name opens the request) and the reason.
 */
export async function NominationTable({ rows }: { rows: NominationRow[] }) {
  const t = await getTranslations("cases");
  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-muted-foreground">{t("nominate.list.empty")}</p>;
  }
  return (
    <table className="w-full border-collapse text-left" data-testid="nomination-table">
      <thead className="bg-muted/60 text-[15px] text-muted-foreground">
        <tr>
          <th scope="col" className="px-5 py-2.5 font-semibold">
            {t("nominate.list.asked")}
          </th>
          <th scope="col" className="px-3 py-2.5 font-semibold">
            {t("list.columns.office")}
          </th>
          <th scope="col" className="px-3 py-2.5 font-semibold">
            {t("amend.existing")}
          </th>
          <th scope="col" className="px-5 py-2.5 font-semibold">
            {t("nominate.list.reason")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-t align-top hover:bg-accent/60">
            <td className="px-5 py-2.5 whitespace-nowrap tabular-nums">{formatDate(row.askedAt)}</td>
            <td className="px-3 py-2.5">
              <span className="flex flex-col">
                <span>{row.officeName}</span>
                <span className="text-sm text-muted-foreground">{row.districtName}</span>
              </span>
            </td>
            <td className="px-3 py-2.5">
              <Link
                href={`/oversight/nominations/${row.id}`}
                className="flex flex-col text-primary underline-offset-2 hover:underline"
              >
                <span className="text-[17px] font-semibold">
                  {caseName(t, row.existing.name, row.existing.childName)}
                </span>
                <span className="text-sm text-muted-foreground">{row.existing.applicationNumber}</span>
              </Link>
            </td>
            <td className="max-w-md px-5 py-2.5 text-[15px] whitespace-pre-line">{row.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
