import { getLocale, getTranslations } from "next-intl/server";
import { caseName } from "@/components/cases/page-header";
import { FormNotice } from "@/components/forms/form-field";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import type { CaseDetails } from "@/server/cases/queries";
import type { LetterSummary } from "@/server/releases/queries";

/** What a check action or a letter correction leaves on the next page, by its key under "review.notices". */
const NOTICES = ["verified", "sentBack", "rejected", "rejectedAskName", "corrected"] as const;
type ReviewNoticeKey = (typeof NOTICES)[number];

export const isReviewNotice = (value: unknown): value is ReviewNoticeKey =>
  typeof value === "string" && (NOTICES as readonly string[]).includes(value);

/** Says what was just done to the case, by its name and number. The URL holds only the case's id (SEC-8). */
export async function ReviewNotice({ notice, details }: { notice: unknown; details: CaseDetails | null }) {
  if (!isReviewNotice(notice) || !details) return null;
  const [t, tc] = await Promise.all([getTranslations("review"), getTranslations("cases")]);
  return (
    <FormNotice
      message={t(`notices.${notice}`, {
        name: caseName(tc, details.name, details.childName),
        number: details.caseNumber ?? tc("noNumber"),
        office: details.officeName,
        district: details.districtName,
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
