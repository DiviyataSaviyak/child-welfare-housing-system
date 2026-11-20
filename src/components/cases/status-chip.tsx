import { useTranslations } from "next-intl";
import type { CaseStatus } from "@/generated/prisma/enums";

/** Status colours from the prototype; each pair meets WCAG AA contrast (UI-6). */
const STYLE: Record<CaseStatus, string> = {
  AWAITING_ALLOCATION: "bg-info text-info-foreground",
  ALLOCATED_TO_DISTRICT: "bg-amber text-amber-foreground",
  ALLOCATION_RECEIVED: "bg-success text-success-foreground",
  IN_PROGRESS: "bg-violet text-violet-foreground",
  COMPLETED: "bg-primary text-primary-foreground",
  // Change 0008: final, and no longer the beneficiary's case (AMD-5), so it reads as set aside.
  REPLACED: "bg-grey text-grey-foreground",
};

export function StatusChip({ status }: { status: CaseStatus }) {
  const t = useTranslations("cases.status");
  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-sm font-semibold whitespace-nowrap ${STYLE[status]}`}>
      {t(status)}
    </span>
  );
}
