"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { WaitingDistrict } from "@/server/releases/queries";
import { allocateHref } from "./href";

const selectClass = "h-11 w-full rounded-lg border border-input bg-card px-3 text-base";

/**
 * REL-1: the district and DS office drop-downs above the districts waiting. The districts are those with
 * cases waiting, each with its count; choosing one opens its letter form, as its card does. The DS offices
 * are the chosen district's, where the cases are built, with "all" first; choosing one leaves only its
 * cases on the form (REL-2). Both apply as soon as they are chosen and are kept in the address.
 */
export function AllocateFilters({
  districts,
  districtId,
  dsOfficeId,
}: {
  districts: Pick<WaitingDistrict, "id" | "name" | "count" | "offices">[];
  districtId: number;
  dsOfficeId: number | null;
}) {
  const t = useTranslations("review.letters");
  const router = useRouter();
  const offices = districts.find((d) => d.id === districtId)?.offices ?? [];
  const go = (district: number, office: number | null) =>
    router.push(allocateHref(district, office), { scroll: false });

  return (
    <div
      role="search"
      aria-label={t("filtersLabel")}
      className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border bg-card px-5 py-4"
    >
      <div className="flex w-72 max-w-full flex-col gap-1">
        <label htmlFor="allocate-district" className="text-[15px] font-semibold">
          {t("filterDistrict")}
        </label>
        <select
          id="allocate-district"
          value={districtId}
          onChange={(event) => go(Number(event.target.value), null)}
          className={selectClass}
        >
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {t("choice", { name: d.name, count: d.count })}
            </option>
          ))}
        </select>
      </div>
      <div className="flex w-80 max-w-full flex-col gap-1">
        <label htmlFor="allocate-office" className="text-[15px] font-semibold">
          {t("filterOffice")}
        </label>
        <select
          id="allocate-office"
          value={dsOfficeId ?? ""}
          onChange={(event) => go(districtId, event.target.value === "" ? null : Number(event.target.value))}
          className={selectClass}
        >
          <option value="">{t("allOffices")}</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {t("choice", { name: o.name, count: o.count })}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
