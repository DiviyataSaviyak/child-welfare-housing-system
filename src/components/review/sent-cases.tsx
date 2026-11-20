import { ChevronRight } from "lucide-react";
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
  const amount = formatRupees(cases.length * RELEASE_AMOUNT, locale);
  return (
    <section
      aria-label={t("sent.summary", { count: cases.length, amount })}
      className="flex max-w-3xl flex-col overflow-hidden rounded-xl border bg-card"
    >
      <div className="grid grid-cols-2 divide-x border-b bg-muted">
        <div className="flex flex-col gap-0.5 px-6 py-4">
          <span className="text-sm font-semibold text-muted-foreground">{t("sent.countLabel")}</span>
          <span className="text-[26px] leading-tight font-bold">{cases.length}</span>
        </div>
        <div className="flex flex-col gap-0.5 px-6 py-4">
          <span className="text-sm font-semibold text-muted-foreground">{t("sent.amountLabel")}</span>
          <span className="text-[26px] leading-tight font-bold">{amount}</span>
        </div>
      </div>
      <ol className="flex flex-col">
        {cases.map((c, index) => (
          <li key={c.id} className="border-t first:border-t-0">
            <Link
              href={href(c.id)}
              className="group flex items-center gap-4 px-6 py-3.5 hover:bg-accent focus-visible:bg-accent"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-primary group-hover:bg-card"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 text-[17px] font-semibold text-primary">
                {caseName(tc, c.name, c.childName)}
              </span>
              <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
