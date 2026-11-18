import { UserSearch, Undo2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import type { CaseDetails } from "@/server/cases/queries";

/**
 * AMD-12, AMD-13: a case page's box for its DS's request that the District nominate a new beneficiary, on
 * every account's case page (PRM-4): while it waits, with its reason and what it holds; once sent back, with
 * the District's reason, until the DS asks again or submits an amendment. `nominateHref` is the District
 * officer's link to the request, where they nominate or send it back; `ownOffice` adds the line for the DS
 * of residence that it may ask again.
 */
export async function NominationNotes({
  details,
  ownOffice,
  nominateHref,
}: {
  details: CaseDetails;
  ownOffice: boolean;
  nominateHref: string | null;
}) {
  const nomination = details.nomination;
  if (!nomination) return null;
  const t = await getTranslations("cases");

  if (nomination.status === "WAITING") {
    return (
      <section
        aria-labelledby="nomination-title"
        data-testid="nomination-waiting"
        className="flex max-w-4xl items-start gap-3 rounded-xl border border-[#E8B45A] bg-[#FFF4E0] px-5 py-4 text-[#6B3A04]"
      >
        <UserSearch aria-hidden="true" className="mt-0.5 size-5.5 shrink-0" />
        <div className="flex flex-col gap-1">
          <h2 id="nomination-title" className="text-[17px] font-bold">
            {t("nominate.waitingTitle")}
          </h2>
          <p>
            {t("nominate.waitingText", {
              date: formatDate(nomination.askedAt),
              who: nomination.askedByName,
              district: nomination.districtName,
            })}
          </p>
          <p className="whitespace-pre-line">{t("amend.reasonLine", { reason: nomination.reason })}</p>
          <p className="text-[15px]">{t("nominate.waitingHold")}</p>
          {nominateHref && (
            <Link href={nominateHref} className="self-start font-semibold underline underline-offset-2">
              {t("nominate.open")}
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="nomination-title"
      data-testid="nomination-sent-back"
      className="flex max-w-4xl items-start gap-3 rounded-xl border bg-muted px-5 py-4"
    >
      <Undo2 aria-hidden="true" className="mt-0.5 size-5.5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h2 id="nomination-title" className="text-[17px] font-bold">
          {t("nominate.sentBackTitle", {
            date: nomination.sentBackAt ? formatDate(nomination.sentBackAt) : "",
            district: nomination.districtName,
          })}
        </h2>
        <p className="whitespace-pre-line">{t("amend.reasonLine", { reason: nomination.sentBackReason ?? "" })}</p>
        {ownOffice && <p className="text-[15px] text-[#3F4843]">{t("nominate.again")}</p>}
      </div>
    </section>
  );
}
