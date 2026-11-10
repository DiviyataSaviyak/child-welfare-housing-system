import { getLocale, getTranslations } from "next-intl/server";
import { FormNotice } from "@/components/forms/form-field";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import type { LetterSummary } from "@/server/releases/queries";

/** A letter correction leaves `?notice=corrected` on the case page (REL-4). */
export async function ReviewNotice({ notice }: { notice: unknown }) {
  if (notice !== "corrected") return null;
  const t = await getTranslations("review");
  return <FormNotice message={t("notices.corrected")} />;
}

/** Says which letter was just recorded, for how many cases and which DS offices (REL-3). The URL holds its id. */
export async function LetterNotice({ letter }: { letter: LetterSummary | null }) {
  if (!letter) return null;
  const [t, locale] = await Promise.all([getTranslations("review"), getLocale()]);
  return (
    <FormNotice
      message={t("notices.letterRecorded", {
        district: letter.districtName,
        number: letter.letterNumber,
        count: letter.count,
        amount: formatRupees(letter.count * RELEASE_AMOUNT, locale),
        offices: letter.offices.join(", "),
      })}
    />
  );
}
