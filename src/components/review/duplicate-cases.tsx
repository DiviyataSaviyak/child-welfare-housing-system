import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { DuplicateCase } from "@/server/cases/duplicates";

/** CHK-2: every other case with the same NIC, in full, each linked to its page. Never blocks anything. */
export async function DuplicateCases({ matches }: { matches: DuplicateCase[] }) {
  if (matches.length === 0) return null;
  const t = await getTranslations();
  // A namespaced translator: the whole file's keys are too many for TypeScript to check a built one.
  const statusLabel = await getTranslations("cases.status");
  const name = (match: DuplicateCase) =>
    match.childName
      ? t("cases.withChild", { name: match.name ?? t("cases.noName"), child: match.childName })
      : (match.name ?? t("cases.noName"));

  return (
    <section
      aria-labelledby="duplicates-title"
      className="flex items-start gap-3 rounded-lg border border-[#E8B45A] bg-[#FFF4E0] px-4 py-3.5 text-[#6B3A04]"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex flex-col gap-1.5">
        <h3 id="duplicates-title" className="font-semibold">
          {t("review.duplicates.title")}
        </h3>
        <ul className="flex flex-col gap-1">
          {matches.map((match) => (
            <li key={match.id}>
              <Link href={`/ministry/cases/${match.id}`} className="font-semibold underline underline-offset-2">
                {match.applicationNumber === null
                  ? t("review.duplicates.draft", { name: name(match), office: match.officeName })
                  : t("review.duplicates.item", {
                      number: match.applicationNumber,
                      name: name(match),
                      office: match.officeName,
                      status: statusLabel(match.status),
                    })}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
