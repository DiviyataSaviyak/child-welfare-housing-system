import { CircleCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import type { CaseDetails } from "@/server/cases/queries";

/** A finished case says when it finished (CLS-1). */
export async function CompletedBanner({ details }: { details: CaseDetails }) {
  if (details.status !== "COMPLETED") return null;
  const t = await getTranslations("progress");
  return (
    <p className="flex items-center gap-3 rounded-xl border-2 border-primary bg-accent px-5 py-3.5 font-semibold text-primary">
      <CircleCheck aria-hidden="true" className="size-6 shrink-0" />
      {t("completed", { date: formatDate(details.completedAt ?? details.updatedAt) })}
    </p>
  );
}
