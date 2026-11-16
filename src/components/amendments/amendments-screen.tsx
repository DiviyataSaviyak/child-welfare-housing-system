import { getLocale, getTranslations } from "next-intl/server";
import { AMENDMENT_STATUSES, countAmendments, listAmendments } from "@/server/amendments/queries";
import { PAGE_SIZE } from "@/server/cases/queries";
import { db } from "@/server/db";
import type { Viewer } from "@/server/permissions";
import { ListTabs } from "../cases/list-tabs";
import { positive } from "../cases/list-filters";
import { Pager } from "../cases/pager";
import { AmendmentTable } from "./amendment-table";
import { amendmentsHref, readAmendmentTab } from "./tabs";

/**
 * AMD-9: the Ministry's and the view-only accounts' screen of the amendments in their area (PRM-4), in three
 * tabs with their counts: submitted for approval (the queue, oldest first), approved and rejected.
 */
export async function AmendmentsScreen({
  audience,
  viewer,
  params,
}: {
  audience: "ministry" | "oversight";
  viewer: Viewer;
  params: Record<string, string | string[] | undefined>;
}) {
  const locale = await getLocale();
  const status = readAmendmentTab(params.tab);
  const page = (typeof params.page === "string" && positive(params.page)) || 1;
  const [t, counts, list] = await Promise.all([
    getTranslations("cases"),
    countAmendments(db, viewer),
    listAmendments(db, viewer, { status, page }, locale),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[28px] leading-snug font-bold">{t("amend.list.title")}</h1>
        <p className="text-muted-foreground">{t("amend.list.subtitle")}</p>
      </div>
      <section aria-labelledby="amendments-title" className="overflow-hidden rounded-xl border bg-card">
        <h2 id="amendments-title" className="sr-only">
          {t("amend.list.title")}
        </h2>
        <div className="border-b px-5 py-3.5">
          <ListTabs
            label={t("amend.list.tabsLabel")}
            tabs={AMENDMENT_STATUSES.map((key) => ({
              key,
              label: t(`amend.list.tabs.${key}`, { count: counts[key] }),
              href: amendmentsHref(audience, key),
              current: key === status,
            }))}
          />
        </div>
        <AmendmentTable rows={list.rows} status={status} audience={audience} />
        <Pager page={page} pageSize={PAGE_SIZE} total={list.total} href={(p) => amendmentsHref(audience, status, p)} />
      </section>
    </div>
  );
}
