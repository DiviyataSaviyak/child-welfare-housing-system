import { getLocale, getTranslations } from "next-intl/server";
import { CaseFilters } from "@/components/cases/case-filters";
import { CaseTable } from "@/components/cases/case-table";
import { ExportLink } from "@/components/cases/export-link";
import { FILTERS, filterQuery, positive, readFilters, STATUSES } from "@/components/cases/list-filters";
import { Pager } from "@/components/cases/pager";
import { listCases, PAGE_SIZE } from "@/server/cases/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { oversightArea } from "../area";

/**
 * FND-1 for a view-only account: every case of its area (PRM-4), with Head Office's filters, but the
 * district and DS filters offer only the area's places. Nothing on it adds or changes a case (PRM-5).
 */
export default async function OversightCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireRole("VIEWER", "DISTRICT_OFFICER");
  const locale = await getLocale();
  const params = await searchParams;
  const read = (key: string) => (typeof params[key] === "string" ? params[key] : "");
  const { values, filter } = readFilters(read);
  const page = positive(read("page")) ?? 1;

  // listCases keeps the viewer's area whatever the address asks for.
  const [t, area, list] = await Promise.all([
    getTranslations("cases"),
    oversightArea(viewer),
    listCases(db, viewer, { ...filter, page }, locale),
  ]);

  const withQuery = (path: string, query: URLSearchParams) => (query.size > 0 ? `${path}?${query}` : path);
  const pageHref = (p: number) => {
    const query = filterQuery(values);
    if (p > 1) query.set("page", String(p));
    return withQuery("/oversight/cases", query);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[28px] leading-snug font-bold">{t("list.title")}</h1>
          <p className="text-muted-foreground">{t("list.summary", { total: list.total })}</p>
        </div>
        {list.total > 0 && (
          <ExportLink
            href={withQuery("/oversight/cases/export", filterQuery(values))}
            label={t("export.button")}
            hint={t("export.hint")}
          />
        )}
      </div>

      <section aria-labelledby="cases-title" className="overflow-hidden rounded-xl border bg-card">
        <h2 id="cases-title" className="sr-only">
          {t("list.title")}
        </h2>
        <CaseFilters
          // "Clear" changes the address without leaving the page; a new form shows the new choices.
          key={FILTERS.map((key) => values[key]).join("|")}
          action="/oversight/cases"
          values={values}
          districts={area.districts}
          places={area.places}
          statuses={STATUSES}
        />
        <CaseTable rows={list.rows} href={(row) => `/oversight/cases/${row.id}`} />
        <Pager page={page} pageSize={PAGE_SIZE} total={list.total} href={pageHref} />
      </section>
    </div>
  );
}
