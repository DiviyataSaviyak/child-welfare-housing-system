import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { caseName } from "@/components/cases/page-header";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import type { SentCase } from "@/server/releases/queries";

/**
 * REL-10, REL-11: how many beneficiaries a letter or a District release sent money for, and the amount,
 * then their names, each opening the case on the reader's own pages (`href`).
 */
export async function SentCases({ cases, href }: { cases: SentCase[]; href: (id: string) => string }) {
  const [t, tc, locale] = await Promise.all([getTranslations("review"), getTranslations("cases"), getLocale()]);
  return (
    <section aria-labelledby="sent-title" className="flex max-w-3xl flex-col gap-2 rounded-xl border bg-card px-6 py-5">
      <h2 id="sent-title" className="text-[17px] font-bold">
        {t("sent.summary", { count: cases.length, amount: formatRupees(cases.length * RELEASE_AMOUNT, locale) })}
      </h2>
      <ol className="flex list-decimal flex-col gap-1 pl-6">
        {cases.map((c) => (
          <li key={c.id}>
            <Link href={href(c.id)} className="text-[17px] text-primary underline-offset-2 hover:underline">
              {caseName(tc, c.name, c.childName)}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
