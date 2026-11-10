import { useTranslations } from "next-intl";
import type { CaseStatus } from "@/generated/prisma/enums";

/** Status colours from the prototype; each pair meets WCAG AA contrast (UI-6). */
const STYLE: Record<CaseStatus, string> = {
  AWAITING_ALLOCATION: "bg-[#E4EDF8] text-[#1E4E8C]",
  ALLOCATED_TO_DISTRICT: "bg-[#FBEBD3] text-[#8A4A06]",
  ALLOCATION_RECEIVED: "bg-[#E3EFEB] text-[#0E5A4B]",
  IN_PROGRESS: "bg-[#EDE7F6] text-[#4B3A7A]",
  COMPLETED: "bg-primary text-primary-foreground",
};

export function StatusChip({ status }: { status: CaseStatus }) {
  const t = useTranslations("cases.status");
  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-sm font-semibold whitespace-nowrap ${STYLE[status]}`}>
      {t(status)}
    </span>
  );
}
