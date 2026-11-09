"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

/** One choice: the queue's address for that place, and its name with how many cases wait there. */
export type PlaceOption = { href: string; label: string };

const selectClass = "h-11 w-full rounded-lg border border-input bg-card px-3 text-base disabled:opacity-60";

/**
 * CHK-4: narrow the queue to a district, then to one DS office in it. Each option is the queue's own
 * address for that place, so choosing one opens it at once; the page sends a new picker (`key`)
 * when the place changes.
 */
export function PlacePicker({
  districts,
  offices,
  district,
  office,
  clear,
}: {
  districts: PlaceOption[];
  /** Empty until a district is chosen. */
  offices: PlaceOption[];
  /** The chosen options' addresses. */
  district: string;
  office: string;
  /** The queue for every place, shown while one is chosen. */
  clear: string | null;
}) {
  const t = useTranslations("review.place");
  const router = useRouter();
  // The choice shows at once, while the queue for it loads.
  const [chosen, setChosen] = useState({ district, office });

  return (
    <div role="group" aria-label={t("label")} className="flex flex-wrap items-end gap-3">
      <div className="flex w-72 flex-col gap-1">
        <label htmlFor="place-district" className="text-[15px] font-semibold">
          {t("district")}
        </label>
        <select
          id="place-district"
          value={chosen.district}
          onChange={(event) => {
            setChosen({ district: event.target.value, office: "" });
            router.push(event.target.value);
          }}
          className={selectClass}
        >
          {districts.map((option) => (
            <option key={option.href} value={option.href}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex w-80 flex-col gap-1">
        <label htmlFor="place-office" className="text-[15px] font-semibold">
          {t("office")}
        </label>
        <select
          id="place-office"
          value={offices.length > 0 ? chosen.office : ""}
          onChange={(event) => {
            setChosen({ ...chosen, office: event.target.value });
            router.push(event.target.value);
          }}
          disabled={offices.length === 0}
          className={selectClass}
        >
          {offices.length === 0 ? (
            <option value="">{t("districtFirst")}</option>
          ) : (
            offices.map((option) => (
              <option key={option.href} value={option.href}>
                {option.label}
              </option>
            ))
          )}
        </select>
      </div>
      {clear && (
        <Link href={clear} className="flex h-11 items-center px-2 font-semibold text-primary underline">
          {t("clear")}
        </Link>
      )}
    </div>
  );
}
