import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CaseFilters } from "@/components/cases/case-filters";
import { CaseTable } from "@/components/cases/case-table";
import { ExportLink } from "@/components/cases/export-link";
import { FILTERS, filterQuery, positive, readFilters, STATUSES } from "@/components/cases/list-filters";
import { Pager } from "@/components/cases/pager";
import { FormNotice } from "@/components/forms/form-field";
import { listCases, PAGE_SIZE } from "@/server/cases/queries";
import { isBeingEntered } from "@/server/cases/rules";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { districtsWithOffices } from "@/server/lists/queries";

/** FND-1: every case, filterable by name, NIC, number, district, DS, status, category and kind. */
export default async function HoCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const locale = await getLocale();
  const params = await searchParams;
  const read = (key: string) => (typeof params[key] === "string" ? params[key] : "");
  const { values, filter } = readFilters(read);
  const page = positive(read("page")) ?? 1;

  const [t, districts, list] = await Promise.all([
    getTranslations("cases"),
    districtsWithOffices(db, locale),
    listCases(db, viewer, { ...filter, page }, locale),
  ]);

  const withQuery = (path: string, query: URLSearchParams) => (query.size > 0 ? `${path}?${query}` : path);
  const pageHref = (p: number) => {
    const query = filterQuery(values);
    if (p > 1) query.set("page", String(p));
    return withQuery("/ministry/cases", query);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[28px] leading-snug font-bold">{t("list.title")}</h1>
          <p className="text-muted-foreground">{t("list.summary", { total: list.total })}</p>
        </div>
        <div className="flex items-center gap-3">
          {list.total > 0 && (
            <ExportLink
              href={withQuery("/ministry/cases/export", filterQuery(values))}
              label={t("export.button")}
              hint={t("export.hint")}
            />
          )}
          <Link
            href="/ministry/cases/new"
            className="flex h-13 items-center rounded-lg bg-primary px-6 text-[17px] font-semibold text-primary-foreground"
          >
            + {t("list.add")}
          </Link>
        </div>
      </div>

      {read("notice") === "deleted" && <FormNotice message={t("notices.deleted")} />}

      <section aria-labelledby="cases-title" className="overflow-hidden rounded-xl border bg-card">
        <h2 id="cases-title" className="sr-only">
          {t("list.title")}
        </h2>
        <CaseFilters
          // "Clear" changes the address without leaving the page; a new form shows the new choices.
          key={FILTERS.map((key) => values[key]).join("|")}
          action="/ministry/cases"
          values={values}
          districts={districts}
          statuses={STATUSES}
        />
        <CaseTable
          rows={list.rows}
          href={(row) => (isBeingEntered(row.status) ? `/ministry/cases/${row.id}/edit` : `/ministry/cases/${row.id}`)}
        />
        <Pager page={page} pageSize={PAGE_SIZE} total={list.total} href={pageHref} />
      </section>
    </div>
  );
}
