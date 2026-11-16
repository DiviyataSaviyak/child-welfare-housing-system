"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { CaseStatus } from "@/generated/prisma/enums";
import { CATEGORIES, KINDS } from "@/lib/validation/case";
import type { DistrictOptions } from "@/server/lists/queries";
import { type FilterValues, filterQuery, NOT_ALLOCATED, PERIODS, type Period, periodDays } from "./list-filters";

const selectClass = "h-11 rounded-lg border border-input bg-card px-3 text-base";

/**
 * Which place filters a list offers: a district and its DS offices; only the DS offices of the one
 * district in the viewer's area; or none, for an area of one DS office (PRM-4).
 */
export type PlaceFilters = "district" | "office" | "none";

/**
 * FND-1, EXP-4: the case list's filters, sent in the address so a search can be bookmarked or shared,
 * and the list's Excel file follows them. Choosing a district narrows the DS offices at once. `districts`
 * holds only the places the viewer may see. The DS's list has no status or kind filter (`statuses` and
 * `kinds` left out): its tabs, kept in `hidden`, take the status's place (HOME-2).
 */
export function CaseFilters({
  action,
  values,
  districts = [],
  places = "district",
  statuses,
  kinds = true,
  hidden = {},
  today,
}: {
  /** The list's own address. */
  action: string;
  values: FilterValues;
  districts?: DistrictOptions[];
  places?: PlaceFilters;
  statuses?: readonly CaseStatus[];
  kinds?: boolean;
  /** Address values the form keeps as they are, such as the DS's tab. */
  hidden?: Record<string, string>;
  /** Colombo's day ("YYYY-MM-DD", ARC-6), read once by the page, which the period's shortcuts end on. */
  today: string;
}) {
  const t = useTranslations("cases");
  const [chosen, setDistrictId] = useState(values.districtId);
  const [from, setFrom] = useState(values.from);
  const withHidden = (query: URLSearchParams) => {
    for (const [key, value] of Object.entries(hidden)) query.set(key, value);
    return query.size > 0 ? `${action}?${query}` : action;
  };
  // EXP-4: each shortcut keeps the filters in use and fills the period, ending today.
  const shortcut = (period: Period) => {
    const days = periodDays(period, today);
    const query = filterQuery({ ...values, ...days });
    return { href: withHidden(query), current: values.from === days.from && values.until === days.until };
  };
  // With no district to choose, the offices are those of the area's one district.
  const districtId = places === "district" ? chosen : String(districts[0]?.id ?? "");
  const offices = districts.find((d) => String(d.id) === districtId)?.offices ?? [];

  return (
    <form
      method="get"
      action={action}
      aria-label={t("list.filtersLabel")}
      className="flex flex-wrap items-end gap-3 border-b px-5 py-4"
    >
      {Object.entries(hidden).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <Field id="q" label={t("list.search")}>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={values.q}
          placeholder={t("list.searchPlaceholder")}
          className="h-11 w-80 rounded-lg border border-input bg-card px-3.5 text-base"
        />
      </Field>
      {places === "district" && (
        <Field id="districtId" label={t("list.district")}>
          <select
            id="districtId"
            name="districtId"
            value={districtId}
            onChange={(event) => setDistrictId(event.target.value)}
            className={selectClass}
          >
            <option value="">{t("list.all")}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {places !== "none" && (
        <Field id="dsOfficeId" label={t("list.office")}>
          <select
            // A new list of offices for each district; the choice starts again.
            key={districtId}
            id="dsOfficeId"
            name="dsOfficeId"
            defaultValue={places !== "district" || districtId === values.districtId ? values.dsOfficeId : ""}
            disabled={offices.length === 0}
            className={selectClass}
          >
            <option value="">{t("list.all")}</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.active ? o.name : t("list.inactive", { office: o.name })}
              </option>
            ))}
          </select>
        </Field>
      )}
      {statuses && (
        <Field id="status" label={t("list.status")}>
          <select id="status" name="status" defaultValue={values.status} className={selectClass}>
            <option value="">{t("list.all")}</option>
            {/* FND-1: the first two statuses together, the cases whose money hasn't reached the DS. */}
            <option value={NOT_ALLOCATED}>{t("list.notAllocated")}</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field id="category" label={t("list.category")}>
        <select id="category" name="category" defaultValue={values.category} className={selectClass}>
          <option value="">{t("list.all")}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </select>
      </Field>
      {kinds && (
        <Field id="kind" label={t("list.kind")}>
          <select id="kind" name="kind" defaultValue={values.kind} className={selectClass}>
            <option value="">{t("list.all")}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kindShort.${k}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {/* EXP-4: the days the cases were entered, either alone; "until" can't be before "from". */}
      <Field id="from" label={t("list.from")}>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={values.from}
          max={today}
          onChange={(event) => setFrom(event.target.value)}
          className={selectClass}
        />
      </Field>
      <Field id="until" label={t("list.until")}>
        <input
          id="until"
          name="until"
          type="date"
          defaultValue={values.until}
          min={from || undefined}
          className={selectClass}
        />
      </Field>
      <button type="submit" className="h-11 rounded-lg border border-primary px-5 font-semibold text-primary">
        {t("list.apply")}
      </button>
      <Link
        href={withHidden(new URLSearchParams())}
        className="flex h-11 items-center px-2 font-semibold text-primary underline"
      >
        {t("list.clear")}
      </Link>
      <nav aria-label={t("list.period")} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
        <span className="font-semibold">{t("list.period")}:</span>
        {(Object.keys(PERIODS) as Period[]).map((period) => {
          const { href, current } = shortcut(period);
          return (
            <Link
              key={period}
              href={href}
              aria-current={current ? "true" : undefined}
              className={`font-semibold text-primary underline-offset-2 ${current ? "underline" : "hover:underline"}`}
            >
              {t(`list.periods.${period}`)}
            </Link>
          );
        })}
      </nav>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[15px] font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}
