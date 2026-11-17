"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ACCOUNT_STATUSES } from "@/lib/account-filters";
import type { AccountList, PlaceFilterChoices } from "@/server/users/queries";
import { type UsersAddress, usersHref } from "./list";

const selectClass = "h-11 rounded-lg border border-input bg-card px-3 text-base disabled:opacity-60";

/** How long the search waits after the last key before it asks again. */
const TYPING_PAUSE_MS = 350;

/**
 * ADM-12: the users screen's search, places and status. Each applies as soon as it is chosen, and the search
 * as it is typed, with no Search button; the address keeps them all. The district list offers only the chosen
 * province's districts, choosing a district chooses its province too, and the DS office list waits for a
 * district. Each choice shows how many accounts it would leave.
 */
export function UserFilters({
  address,
  choices,
  counts,
}: {
  address: UsersAddress;
  choices: PlaceFilterChoices;
  counts: Pick<AccountList["counts"], "provinces" | "districts" | "dsOffices">;
}) {
  const t = useTranslations("users.filters");
  const router = useRouter();
  const [q, setQ] = useState(address.q);
  const [shown, setShown] = useState(address.q);
  const typed = useRef(address.q);

  // The address changed some other way (a chip, "remove all", back): the box shows its search.
  if (shown !== address.q) {
    setShown(address.q);
    setQ(address.q);
  }

  useEffect(() => {
    typed.current = address.q;
  }, [address.q]);

  useEffect(() => {
    if (q.trim() === typed.current.trim()) return;
    const wait = setTimeout(() => {
      typed.current = q;
      router.replace(usersHref(address, { q: q.trim() }), { scroll: false });
    }, TYPING_PAUSE_MS);
    return () => clearTimeout(wait);
  }, [q, address, router]);

  const go = (change: Partial<UsersAddress>) => router.push(usersHref(address, change), { scroll: false });

  const districts = address.provinceId
    ? choices.districts.filter((d) => String(d.provinceId) === address.provinceId)
    : choices.districts;
  const withCount = (name: string, count: number | undefined) => t("choice", { name, count: count ?? 0 });

  return (
    <div role="search" aria-label={t("label")} className="flex flex-wrap items-end gap-3 border-b px-5 py-4">
      <Field id="q" label={t("search")}>
        <input
          id="q"
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-11 w-80 rounded-lg border border-input bg-card px-3.5 text-base"
        />
      </Field>
      <Field id="provinceId" label={t("province")}>
        <select
          id="provinceId"
          value={address.provinceId}
          onChange={(event) => {
            const provinceId = event.target.value;
            const keeps = choices.districts.some(
              (d) => String(d.id) === address.districtId && String(d.provinceId) === provinceId,
            );
            go(keeps ? { provinceId } : { provinceId, districtId: "", dsOfficeId: "" });
          }}
          className={selectClass}
        >
          <option value="">{t("all")}</option>
          {choices.provinces.map((p) => (
            <option key={p.id} value={p.id}>
              {withCount(p.name, counts.provinces[p.id])}
            </option>
          ))}
        </select>
      </Field>
      <Field id="districtId" label={t("district")}>
        <select
          id="districtId"
          value={address.districtId}
          onChange={(event) => {
            const district = choices.districts.find((d) => String(d.id) === event.target.value);
            go(
              district
                ? { provinceId: String(district.provinceId), districtId: String(district.id), dsOfficeId: "" }
                : { districtId: "", dsOfficeId: "" },
            );
          }}
          className={selectClass}
        >
          <option value="">{t("all")}</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {withCount(d.name, counts.districts[d.id])}
            </option>
          ))}
        </select>
      </Field>
      <Field id="dsOfficeId" label={t("dsOffice")}>
        <select
          id="dsOfficeId"
          value={address.districtId ? address.dsOfficeId : ""}
          onChange={(event) => go({ dsOfficeId: event.target.value })}
          disabled={!address.districtId}
          aria-describedby={address.districtId ? undefined : "dsOfficeId-hint"}
          className={selectClass}
        >
          <option value="">{address.districtId ? t("all") : t("districtFirst")}</option>
          {choices.dsOffices.map((o) => (
            <option key={o.id} value={o.id}>
              {withCount(o.active ? o.name : t("inactive", { office: o.name }), counts.dsOffices[o.id])}
            </option>
          ))}
        </select>
      </Field>
      <Field id="status" label={t("status")}>
        <select
          id="status"
          value={address.status}
          onChange={(event) => go({ status: event.target.value })}
          className={selectClass}
        >
          <option value="">{t("all")}</option>
          {ACCOUNT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </select>
      </Field>
      {!address.districtId && (
        <p id="dsOfficeId-hint" className="sr-only">
          {t("districtFirst")}
        </p>
      )}
    </div>
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
