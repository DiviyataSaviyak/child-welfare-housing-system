"use client";

import { useTranslations } from "next-intl";
import type { NicMatch } from "@/server/cases/duplicates";

/**
 * CASE-6: other cases with the same NIC. It only warns; saving and submitting stay possible. What
 * each match shows was already limited on the server to what the viewer may see.
 */
export function NicMatches({ matches }: { matches: NicMatch[] }) {
  const t = useTranslations("cases.form.duplicate");

  const describe = (match: NicMatch) => {
    const name = match.name ?? "";
    if (!match.applicationNumber) return t("draft", { name });
    if (match.name && match.officeName)
      return t("numberNameOffice", { number: match.applicationNumber, name, office: match.officeName });
    if (match.name) return t("numberName", { number: match.applicationNumber, name });
    return t("numberOffice", { number: match.applicationNumber, office: match.officeName ?? "" });
  };

  return (
    <div
      role="status"
      data-testid="nic-matches"
      className="flex flex-col gap-1.5 rounded-lg border border-[#E8B45A] bg-[#FFF4E0] px-4 py-3.5 text-[15px] text-[#6B3A04]"
    >
      <p className="font-semibold">{t("title")}</p>
      <ul className="list-disc ps-5">
        {matches.map((match, index) => (
          <li key={`${match.applicationNumber ?? "draft"}-${index}`}>{describe(match)}</li>
        ))}
      </ul>
      <p>{t("advice")}</p>
    </div>
  );
}
