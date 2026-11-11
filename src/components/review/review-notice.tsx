import { getLocale, getTranslations } from "next-intl/server";
import { FormNotice } from "@/components/forms/form-field";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import type { DsReleaseSummary, LetterSummary } from "@/server/releases/queries";

/**
 * A letter correction leaves `?notice=corrected` on the case page (REL-4), and a District release's
 * correction `?notice=dsCorrected` (REL-8).
 */
export async function ReviewNotice({ notice }: { notice: unknown }) {
  if (notice !== "corrected" && notice !== "dsCorrected") return null;
  const t = await getTranslations("review");
  return <FormNotice message={t(notice === "corrected" ? "notices.corrected" : "notices.dsCorrected")} />;
}

/** Says which District release was just recorded, to which DS office and for how many cases (REL-7). */
export async function DsReleaseNotice({ release }: { release: DsReleaseSummary | null }) {
  if (!release) return null;
  const [t, locale] = await Promise.all([getTranslations("review"), getLocale()]);
  return (
    <FormNotice
      message={t("notices.dsReleased", {
        office: release.officeName,
        reference: release.referenceNumber,
        count: release.count,
        amount: formatRupees(release.count * RELEASE_AMOUNT, locale),
      })}
    />
  );
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
