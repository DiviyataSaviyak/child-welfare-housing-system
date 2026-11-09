import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FormNotice } from "@/components/forms/form-field";
import { formatDate } from "@/lib/dates";
import { OFFICE_TYPES, type OfficeType } from "@/server/auth/designations";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { type AccountPlace, accountCounts, listAccounts } from "@/server/users/queries";
import { AccountActions } from "./account-actions";

const NOTICES = ["saved", "transferred"] as const;

const isOfficeType = (value: unknown): value is OfficeType =>
  typeof value === "string" && (OFFICE_TYPES as readonly string[]).includes(value);

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; officeType?: string | string[]; notice?: string | string[] }>;
}) {
  const admin = await requireRole("ADMIN");
  const locale = await getLocale();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const officeType = isOfficeType(params.officeType) ? params.officeType : undefined;
  const notice = NOTICES.find((n) => n === params.notice);

  const [t, rows, counts] = await Promise.all([
    getTranslations("users"),
    listAccounts(db, { q, officeType }, locale),
    accountCounts(db),
  ]);

  const placeLine = (place: AccountPlace) =>
    place.kind === "dsOffice"
      ? `${t("officeOf", { office: place.office })} · ${t("districtOf", { district: place.district })}`
      : place.kind === "district"
        ? t("districtOf", { district: place.district })
        : t("provinceOf", { province: place.province });

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

      <section aria-label={t("title")} className="overflow-hidden rounded-xl border bg-card">
        <form method="get" className="flex flex-wrap items-end gap-4 border-b px-5 py-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="q" className="text-[15px] font-semibold">
              {t("search")}
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t("searchPlaceholder")}
              className="h-11 w-96 rounded-lg border border-input bg-card px-3.5 text-base"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="officeType" className="text-[15px] font-semibold">
              {t("officeTypeFilter")}
            </label>
            <select
              id="officeType"
              name="officeType"
              defaultValue={officeType ?? ""}
              className="h-11 w-72 rounded-lg border border-input bg-card px-3 text-base"
            >
              <option value="">{t("allOfficeTypes")}</option>
              {OFFICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`officeTypes.${type}`)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="h-11 rounded-lg border border-primary px-5 text-base font-semibold text-primary"
          >
            {t("search")}
          </button>
        </form>

        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted-foreground">{t("empty")}</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="bg-muted/60 text-[15px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-semibold">
                  {t("columns.name")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t("columns.designation")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t("columns.office")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t("columns.lastSignIn")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t("columns.status")}
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                  {t("columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-5 py-2.5">
                    <span className="flex flex-col">
                      <span className={`font-semibold ${row.active ? "" : "text-muted-foreground"}`}>
                        {row.name} {row.id === admin.userId && t("you")}
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
                    {/* An account with no name goes by its username here until task 4's label (ADM-10). */}
                    <AccountActions
                      id={row.id}
                      name={row.name || row.username}
                      active={row.active}
                      isSelf={row.id === admin.userId}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
