import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Pager } from "@/components/cases/pager";
import { ListTabs } from "@/components/cases/list-tabs";
import { FormNotice } from "@/components/forms/form-field";
import { ACCOUNTS_PER_PAGE, type AccountSort } from "@/lib/account-filters";
import { formatDate } from "@/lib/dates";
import { OFFICE_TYPES } from "@/server/auth/designations";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { type AccountPlace, accountCounts, listAccounts, placeFilterChoices } from "@/server/users/queries";
import { AccountActions } from "./account-actions";
import { readUsersAddress, sortChange, type UserFilterKey, usersHref, withoutFilter } from "./list";
import { UserFilters } from "./user-filters";

const NOTICES = ["saved", "transferred"] as const;

/** The filters a chip shows: the office type has its tabs instead, and the search its box. */
const CHIPS = ["provinceId", "districtId", "dsOfficeId", "status"] as const satisfies UserFilterKey[];

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireRole("ADMIN");
  const locale = await getLocale();
  const params = await searchParams;
  const read = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : "";
  };
  const { address, filter } = readUsersAddress(read);
  const notice = NOTICES.find((n) => n === params.notice);

  const [t, list, counts, choices] = await Promise.all([
    getTranslations("users"),
    listAccounts(db, filter, locale),
    accountCounts(db),
    placeFilterChoices(db, locale, filter.districtId),
  ]);

  const placeLine = (place: AccountPlace) =>
    place.kind === "dsOffice"
      ? `${t("officeOf", { office: place.office })} · ${t("districtOf", { district: place.district })}`
      : place.kind === "district"
        ? t("districtOf", { district: place.district })
        : t("provinceOf", { province: place.province });

  const tabs = [
    { key: "", label: t("filters.allOfficeTypes"), count: list.counts.officeTypes.all },
    ...OFFICE_TYPES.map((type) => ({
      key: type,
      label: t(`officeTypes.${type}`),
      count: list.counts.officeTypes[type],
    })),
  ].map(({ key, label, count }) => ({
    key: key || "all",
    label: t("filters.tab", { label, count }),
    href: usersHref(address, { officeType: key }),
    current: (filter.officeType ?? "") === key,
  }));

  // What each chip says: the place's name or the status.
  const chipValue = (key: (typeof CHIPS)[number]): string | null => {
    const id = Number(address[key]);
    switch (key) {
      case "provinceId":
        return filter.provinceId ? (choices.provinces.find((p) => p.id === id)?.name ?? null) : null;
      case "districtId":
        return filter.districtId ? (choices.districts.find((d) => d.id === id)?.name ?? null) : null;
      case "dsOfficeId":
        return filter.dsOfficeId
          ? (() => {
              const office = choices.dsOffices.find((o) => o.id === id);
              return office ? t("officeOf", { office: office.name }) : null;
            })()
          : null;
      case "status":
        return filter.status ? t(`filters.statuses.${filter.status}`) : null;
    }
  };
  const chips = CHIPS.flatMap((key) => {
    const value = chipValue(key);
    return value ? [{ key, value, href: usersHref(address, withoutFilter(key)) }] : [];
  });
  // "Remove all" removes what the chips show; the search and the tab stay.
  const removeAll = usersHref(address, Object.fromEntries(CHIPS.map((key) => [key, ""])));

  const sortHeading = (column: AccountSort, label: string, className: string) => {
    const sorted = filter.sort === column;
    return (
      <th
        scope="col"
        aria-sort={sorted ? (filter.reversed !== (column === "lastSignIn") ? "descending" : "ascending") : undefined}
        className={`${className} font-semibold`}
      >
        <Link
          href={usersHref(address, sortChange(address, column))}
          scroll={false}
          className={`inline-flex items-center gap-1 underline-offset-2 hover:underline ${sorted ? "text-foreground" : ""}`}
        >
          {label}
          <span aria-hidden="true">{sorted ? (filter.reversed ? "↑" : "↓") : "↕"}</span>
        </Link>
      </th>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[28px] leading-snug font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("summary", counts)}</p>
        </div>
        <Link
          href="/admin/users/new"
          className="flex h-13 items-center rounded-lg bg-primary px-6 text-[17px] font-semibold text-primary-foreground"
        >
          {t("add")}
        </Link>
      </div>

      {notice && <FormNotice message={t(`notices.${notice}`)} />}

      <ListTabs label={t("filters.officeTypes")} tabs={tabs} />

      <section aria-label={t("title")} className="overflow-hidden rounded-xl border bg-card">
        <UserFilters address={address} choices={choices} counts={list.counts} />

        {chips.length > 0 && (
          <ul aria-label={t("filters.inUse")} className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
            {chips.map((chip) => (
              <li key={chip.key}>
                <Link
                  href={chip.href}
                  scroll={false}
                  aria-label={t("filters.remove", { filter: chip.value })}
                  className="flex h-9 items-center gap-2 rounded-full bg-accent px-3.5 text-[15px] font-semibold text-accent-foreground"
                >
                  {chip.value}
                  <span aria-hidden="true">×</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href={removeAll} scroll={false} className="px-2 text-[15px] font-semibold text-primary underline">
                {t("filters.removeAll")}
              </Link>
            </li>
          </ul>
        )}

        {list.total === 0 ? (
          <p className="px-5 py-8 text-center text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            {list.total <= ACCOUNTS_PER_PAGE && (
              <p className="px-5 pt-3 text-[15px] text-muted-foreground tabular-nums">
                {t("filters.found", { total: list.total })}
              </p>
            )}
            <table className="w-full border-collapse text-left">
              <thead className="bg-muted/60 text-[15px] text-muted-foreground">
                <tr>
                  {sortHeading("name", t("columns.name"), "px-5 py-2.5")}
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    {t("columns.designation")}
                  </th>
                  {sortHeading("office", t("columns.office"), "px-3 py-2.5")}
                  {sortHeading("lastSignIn", t("columns.lastSignIn"), "px-3 py-2.5")}
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    {t("columns.status")}
                  </th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    {t("columns.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-5 py-2.5">
                      <span className="flex flex-col">
                        <span className={`font-semibold ${row.active ? "" : "text-muted-foreground"}`}>
                          {row.label} {row.id === admin.userId && t("you")}
                        </span>
                        <span className="font-mono text-sm text-muted-foreground">{row.username}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-col">
                        <span className="text-[15px]">
                          {row.designation ? t(`designations.${row.designation}`) : t("officeTypes.ADMINISTRATOR")}
                        </span>
                        <span className="text-sm text-muted-foreground">{t(`roles.${row.role}`)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-col">
                        <span className="text-[15px]">{t(`officeTypes.${row.officeType}`)}</span>
                        {row.place && <span className="text-sm text-muted-foreground">{placeLine(row.place)}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[15px] tabular-nums">
                      {row.lastSignInAt ? formatDate(row.lastSignInAt) : t("never")}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-block rounded-full px-3 py-0.5 text-sm font-semibold ${row.active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        {row.active ? t("active") : t("disabled")}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      <AccountActions
                        id={row.id}
                        name={row.label}
                        active={row.active}
                        isSelf={row.id === admin.userId}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager
              page={list.page}
              pageSize={ACCOUNTS_PER_PAGE}
              total={list.total}
              href={(page) => usersHref(address, { page: String(page) })}
            />
          </>
        )}
      </section>
    </div>
  );
}
