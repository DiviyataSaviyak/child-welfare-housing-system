"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { CaseStatus } from "@/generated/prisma/enums";
import { CATEGORIES, KINDS } from "@/lib/validation/case";
import type { DistrictOptions } from "@/server/lists/queries";
import type { FilterValues } from "./filters";

const selectClass = "h-11 rounded-lg border border-input bg-card px-3 text-base";

/**
 * FND-1: the case list's filters, sent in the address so a search can be bookmarked or shared.
 * Choosing a district narrows the DS offices at once.
 */
export function CaseFilters({
  values,
  districts,
  statuses,
}: {
  values: FilterValues;
  districts: DistrictOptions[];
  statuses: readonly CaseStatus[];
}) {
  const t = useTranslations("cases");
  const [districtId, setDistrictId] = useState(values.districtId);
  const offices = districts.find((d) => String(d.id) === districtId)?.offices ?? [];

  return (
    <form
      method="get"
      action="/ho/cases"
      aria-label={t("list.filtersLabel")}
      className="flex flex-wrap items-end gap-3 border-b px-5 py-4"
    >
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
      <Field id="dsOfficeId" label={t("list.office")}>
        <select
          // A new list of offices for each district; the choice starts again.
          key={districtId}
          id="dsOfficeId"
          name="dsOfficeId"
          defaultValue={districtId === values.districtId ? values.dsOfficeId : ""}
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
      <Field id="status" label={t("list.status")}>
        <select id="status" name="status" defaultValue={values.status} className={selectClass}>
          <option value="">{t("list.all")}</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </Field>
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
      <button type="submit" className="h-11 rounded-lg border border-primary px-5 font-semibold text-primary">
        {t("list.apply")}
      </button>
      <Link href="/ho/cases" className="flex h-11 items-center px-2 font-semibold text-primary underline">
        {t("list.clear")}
      </Link>
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
