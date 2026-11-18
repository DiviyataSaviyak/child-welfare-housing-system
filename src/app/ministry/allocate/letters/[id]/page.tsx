import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/cases/page-header";
import { SentCases } from "@/components/review/sent-cases";
import { formatDate } from "@/lib/dates";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { letterWithCases } from "@/server/releases/queries";

/**
 * REL-10: one allocation letter, opened from the allocation screen's "letters recorded last": the
 * beneficiaries it sent money for, their number and the amount. Any other id is "not found".
 */
export default async function MinistryLetterPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const { id } = await params;
  const locale = await getLocale();
  const letter = id.length <= 64 ? await letterWithCases(db, viewer, id, locale) : null;
  if (!letter) notFound();
  const t = await getTranslations("review");

  return (
    <div className="flex flex-col gap-4.5">
      <PageHeader
        backHref="/ministry/allocate"
        backLabel={t("sent.backToLetters")}
        title={t("sent.letterTitle", { district: letter.districtName, number: letter.letterNumber })}
        subtitle={t("sent.letterSubtitle", { date: formatDate(letter.letterDate) })}
      />
      <SentCases cases={letter.cases} href={(caseId) => `/ministry/cases/${caseId}`} />
    </div>
  );
}
