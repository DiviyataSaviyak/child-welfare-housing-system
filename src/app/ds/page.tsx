import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ExportLink } from "@/components/cases/export-link";
import { caseName } from "@/components/cases/page-header";
import { Pager } from "@/components/cases/pager";
import { StatusChip } from "@/components/cases/status-chip";
import { FormNotice } from "@/components/forms/form-field";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatRupees, INSTALLMENT_COUNT } from "@/lib/money";
import { canEditDetails } from "@/server/cases/rules";
import {
  type CaseRow,
  countCases,
  listCases,
  officeMoney,
  officeSummary,
  PAGE_SIZE,
  STALE_DAYS,
  type TodoItem,
  todoItems,
} from "@/server/cases/queries";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { readHomeList, type Tab, TABS, tabFilter } from "./list";

/** The colour of each kind of to-do item, as in the prototype. */
const TODO_COLOUR: Record<TodoItem["type"], string> = {
  replace: "bg-[#F8E1DE]",
  returned: "bg-[#FBEBD3]",
  due: "bg-[#E4EDF8]",
  stale: "bg-muted",
  draft: "bg-muted",
};

/** HOME-1 to HOME-4: the DS officer's own cases, with what needs doing next and the office's money beside them. */
export default async function DsHomePage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[];
    q?: string | string[];
    page?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const viewer = await requireRole("DS_OFFICER");
  const locale = await getLocale();
  const office = viewer.dsOfficeId ? await officeSummary(db, viewer.dsOfficeId, locale) : null;
  if (!office) notFound();

  const params = await searchParams;
  const { tab, q, filter } = readHomeList(params);
  const page = Math.max(1, Number(params.page) || 1);

  const [t, list, counts, todo, money] = await Promise.all([
    getTranslations("cases"),
    listCases(db, viewer, { ...filter, page }, locale),
    Promise.all(TABS.map((key) => countCases(db, viewer, tabFilter(key)))),
    todoItems(db, viewer),
    officeMoney(db, viewer),
  ]);
  const now = new Date();
  const href = (changes: { tab?: Tab; page?: number }, path = "/ds") => {
    const query = new URLSearchParams();
    const nextTab = changes.tab ?? tab;
    if (nextTab !== "all") query.set("tab", nextTab);
    if (q) query.set("q", q);
    if (changes.page && changes.page > 1) query.set("page", String(changes.page));
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  };

  /** What comes next for the case, in the progress column: for a running case, the stage reached (HOME-1). */
  const progress = (row: CaseRow) => {
    switch (row.status) {
      case "SUBMITTED": {
        const days = row.submittedAt ? daysBetween(row.submittedAt, now) : 0;
        return days === 0 ? t("home.progress.submittedToday") : t("home.progress.SUBMITTED", { days });
      }
      case "IN_PROGRESS":
        return row.stageName ?? t("home.progress.IN_PROGRESS");
      case "DRAFT":
      case "RETURNED":
      case "VERIFIED":
      case "COMPLETED":
      case "STOPPED":
        return t(`home.progress.${row.status}`);
      default:
        return t("none");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[28px] leading-snug font-bold">{t("home.title")}</h1>
          <p className="text-muted-foreground">
            {t("home.subtitle", { office: office.name, district: office.districtName })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {list.total > 0 && (
            <ExportLink href={href({}, "/ds/export")} label={t("export.button")} hint={t("export.hint")} />
          )}
          {office.active && (
            <Link
              href="/ds/cases/new"
              className="flex h-13 items-center rounded-lg bg-primary px-6 text-[17px] font-semibold text-primary-foreground"
            >
              + {t("home.add")}
            </Link>
          )}
        </div>
      </div>

      {params.notice === "deleted" && <FormNotice message={t("notices.deleted")} />}

      <div className="flex items-start gap-6">
        <section aria-labelledby="list-title" className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
          <h2 id="list-title" className="sr-only">
            {t("home.title")}
          </h2>
          <div className="flex flex-wrap items-center gap-4 border-b px-5 py-3.5">
            <nav aria-label={t("home.tabsLabel")} className="flex gap-1 rounded-lg bg-muted p-1">
              {TABS.map((key, index) => (
                <Link
                  key={key}
                  href={href({ tab: key, page: 1 })}
                  aria-current={tab === key ? "page" : undefined}
                  className={`flex h-10.5 items-center rounded-md px-4.5 font-semibold ${
                    tab === key ? "bg-card text-primary shadow-sm" : "text-[#3F4843]"
                  }`}
                >
                  {t(`home.tabs.${key}`, { count: counts[index] ?? 0 })}
                </Link>
              ))}
            </nav>
            <form method="get" action="/ds" className="ms-auto flex items-center gap-2">
              {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
              <label htmlFor="q" className="sr-only">
                {t("home.search")}
              </label>
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder={t("home.searchPlaceholder")}
                className="h-11.5 w-80 rounded-lg border border-input bg-card px-3.5 text-base"
              />
              <button type="submit" className="h-11.5 rounded-lg border border-primary px-4 font-semibold text-primary">
                {t("home.search")}
              </button>
            </form>
          </div>

          {list.rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-muted-foreground">
              {counts[0] === 0 ? t("home.emptyStart") : t("home.empty")}
            </p>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="bg-muted/60 text-[15px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-semibold">
                    {t("home.columns.beneficiary")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    {t("home.columns.kind")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    {t("home.columns.status")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    {t("home.columns.paid")}
                  </th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">
                    {t("home.columns.progress")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => (
                  <tr key={row.id} className="border-t hover:bg-accent/60">
                    <td className="px-5 py-2.5">
                      <Link
                        href={
                          canEditDetails(viewer.role, row.status) ? `/ds/cases/${row.id}/edit` : `/ds/cases/${row.id}`
                        }
                        className="flex flex-col"
                      >
                        <span className="text-[17px] font-semibold text-primary underline-offset-2 hover:underline">
                          {caseName(t, row.name, row.childName)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {row.caseNumber ?? t("noNumber")}
                          {row.category && ` · ${t(`category.${row.category}`)}`}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.kind ? t(`kindShort.${row.kind}`) : t("none")}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusChip status={row.status} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.paid === null ? t("none") : t("home.paid", { paid: row.paid, total: INSTALLMENT_COUNT })}
                    </td>
                    <td className="px-5 py-2.5 text-[15px]">
                      <span className="flex flex-col">
                        <span>{progress(row)}</span>
                        {row.status === "IN_PROGRESS" && daysBetween(row.updatedAt, now) >= STALE_DAYS && (
                          <span className="text-sm font-semibold text-[#8A4A06]">
                            {t("home.progress.stale", { days: daysBetween(row.updatedAt, now) })}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={list.total} href={(p) => href({ page: p })} />
        </section>

        <div className="flex w-80 shrink-0 flex-col gap-5">
          <aside aria-labelledby="todo-title" className="flex flex-col gap-3 rounded-xl border bg-card p-4.5">
            <h2 id="todo-title" className="text-[19px] font-bold">
              {t("home.todo.title")}
            </h2>
            {todo.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">{t("home.todo.none")}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {todo.map((item) => (
                  <li key={`${item.type}-${item.id}`}>
                    <TodoLink item={item} t={t} />
                  </li>
                ))}
              </ul>
            )}
          </aside>
          {money && (
            <section aria-labelledby="money-title" className="flex flex-col rounded-xl border bg-card p-4.5">
              <h2 id="money-title" className="mb-1.5 text-[19px] font-bold">
                {t("home.money.title")}
              </h2>
              <dl className="flex flex-col">
                {(
                  [
                    ["received", money.received],
                    ["paidOut", money.paidOut],
                    ["balance", money.balance],
                  ] as const
                ).map(([key, amount]) => (
                  <div key={key} className="flex justify-between gap-3 border-b py-2 last:border-b-0">
                    <dt className="text-[15px] text-[#3F4843]">{t(`home.money.${key}`)}</dt>
                    <dd className="font-bold whitespace-nowrap">{formatRupees(amount, locale)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

type HomeT = Awaited<ReturnType<typeof getTranslations<"cases">>>;

/** One to-do item (HOME-3): what needs doing, why, and a link to where it is done. */
function TodoLink({ item, t }: { item: TodoItem; t: HomeT }) {
  const name = caseName(t, item.name, item.childName);
  const content = (() => {
    switch (item.type) {
      case "replace":
        // CASE-11: Head Office asked for another name; the new-case form asks whether it is this one.
        return {
          href: "/ds/cases/new",
          title: t("home.todo.replace", { name }),
          text: t(item.status === "STOPPED" ? "home.todo.replaceStopped" : "home.todo.replaceRejected", {
            number: item.caseNumber ?? t("noNumber"),
            reason: item.reason ?? t("home.todo.noReason"),
          }),
          action: t("home.todo.replaceAction"),
        };
      case "returned":
        return {
          href: `/ds/cases/${item.id}/edit`,
          title: t("home.todo.returned", { name }),
          text: item.reason ?? t("home.todo.noReason"),
          action: t("home.todo.returnedAction"),
        };
      case "due":
        return {
          href: `/ds/cases/${item.id}`,
          title: t("home.todo.due", { name, installment: t(`installment.name.${item.number as 1 | 2 | 3 | 4}`) }),
          text: t(item.overdue ? "home.todo.overdueText" : "home.todo.dueText", { date: formatDate(item.expectedOn) }),
          action: t("home.todo.open"),
        };
      case "stale":
        return {
          href: `/ds/cases/${item.id}`,
          title: t("home.todo.stale", { name }),
          text: t("home.todo.staleText", { days: item.days }),
          action: t("home.todo.open"),
        };
      case "draft":
        return {
          href: `/ds/cases/${item.id}/edit`,
          title: t("home.todo.draft", { name }),
          text: t("home.todo.draftText", { date: formatDate(item.updatedAt) }),
          action: t("home.todo.draftAction"),
        };
    }
  })();
  return (
    <Link href={content.href} className={`flex flex-col gap-1 rounded-lg px-3.5 py-3 ${TODO_COLOUR[item.type]}`}>
      <span className="font-bold">{content.title}</span>
      <span className="text-[15px] text-[#3F4843]">{content.text}</span>
      <span className="text-[15px] font-semibold text-primary">{content.action} →</span>
    </Link>
  );
}
