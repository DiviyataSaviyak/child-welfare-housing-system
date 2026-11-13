import { FileText } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { InstallmentStatus, Kind } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/dates";
import { formatRupees, paidOut } from "@/lib/money";
import { isHouseKind } from "@/lib/validation/case";
import type { InstallmentDetails, ReleaseDetails } from "@/server/cases/queries";
import { isUpcoming, landBalance, schedule, type Upcoming } from "@/server/installments/rules";
import type { Audience } from "./case-view";

/** Installment status colours from the prototype; each pair meets WCAG AA contrast (UI-6). */
const DOT: Record<InstallmentStatus, string> = {
  NOT_STARTED: "border-[#B9B4A8] bg-card text-[#4F5752]",
  PROCESSING: "border-[#C07A12] bg-[#FFF4E0] text-[#8A4A06]",
  RELEASED: "border-primary bg-primary text-primary-foreground",
};
const STATUS_TEXT: Record<InstallmentStatus, string> = {
  NOT_STARTED: "text-[#4F5752]",
  PROCESSING: "text-[#8A4A06]",
  RELEASED: "text-primary",
};

/** A scanned letter's link, opening in a new tab. */
async function ScanLink({ id }: { id: string }) {
  const t = await getTranslations("cases");
  return (
    <a href={`/files/${id}`} target="_blank" rel="noopener" className="shrink-0 font-semibold text-primary underline">
      {t("money.letterScan")} <span className="font-normal">{t("money.opensInNewTab")}</span>
    </a>
  );
}

/**
 * "මූල්‍ය ප්‍රගතිය" as in the prototype: the Rs. 2,000,000 the Ministry allocated to the district by an
 * allocation letter and the District released to the DS office, what has been paid to the beneficiary, what
 * the office still holds, the Ministry's letter and the District's release under it, and the four
 * installments (REL-3, REL-7, INS-1). A land kind's installments are the ones started, each with its own
 * amount, then the next one to start while some of the Rs. 2,000,000 is left, or a line saying the whole
 * allocation is paid or being paid (INS-7). While the Ministry's allocation waits for the District's release
 * (`ALLOCATED_TO_DISTRICT`, no installments yet), it shows only the letter and says so (change 0006). The
 * Ministry and the view-only area read the money as released to the District Secretary, the DS office as
 * received from the District Secretariat. `correction` is the Ministry's button to correct the letter
 * (REL-4), `dsCorrection` the District officer's to correct its release (REL-8). `actions` gives each
 * installment's button, if any: the DS office's next step (INS-3, INS-4) or the Ministry's undo (INS-6).
 */
export async function MoneySection({
  audience,
  kind,
  release,
  installments,
  correction,
  dsCorrection,
  actions,
}: {
  audience: Audience;
  kind: Kind;
  release: ReleaseDetails;
  installments: InstallmentDetails[];
  correction?: React.ReactNode;
  dsCorrection?: React.ReactNode;
  actions?: (item: InstallmentDetails | Upcoming) => React.ReactNode;
}) {
  const [t, tp, locale] = await Promise.all([getTranslations("cases"), getTranslations("progress"), getLocale()]);
  const paid = installments.filter((i) => i.status === "RELEASED");
  const paidAmount = paidOut(installments);
  const { letter, dsRelease } = release;
  // A land case has no installment until the DS starts one (INS-7), so the District's release decides.
  const waiting = !dsRelease;
  const house = isHouseKind(kind);
  const rows = schedule(kind, installments);
  const allStarted = !house && landBalance(installments) <= 0;
  const tiles = [
    audience !== "ds"
      ? {
          label: t("money.released"),
          amount: release.amount,
          detail: t("money.releasedDetail", { date: formatDate(letter.letterDate), district: letter.districtName }),
        }
      : {
          label: t("money.received"),
          amount: release.amount,
          detail: dsRelease
            ? t("money.receivedDetail", {
                date: formatDate(dsRelease.releasedOn),
                reference: dsRelease.referenceNumber,
              })
            : "",
        },
    { label: t("money.paid"), amount: paidAmount, detail: t("money.count", { count: paid.length }) },
    {
      label: t("money.left"),
      amount: release.amount - paidAmount,
      detail: house ? t("money.count", { count: installments.length - paid.length }) : "",
    },
  ];

  return (
    <section aria-labelledby="money-title" className="flex flex-col gap-4 rounded-xl border bg-card px-6 py-5">
      <h2 id="money-title" className="text-xl font-bold">
        {t("money.title")}
      </h2>
      {waiting ? (
        <p className="rounded-lg bg-background px-4 py-3 text-[#3F4843]">
          {t(audience === "ds" ? "money.allocatedDs" : "money.allocated", {
            amount: formatRupees(release.amount, locale),
            district: letter.districtName,
          })}
        </p>
      ) : (
        <dl className="grid grid-cols-3 gap-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="flex flex-col gap-0.5 rounded-lg bg-background px-4 py-3">
              <dt className="text-[15px] text-muted-foreground">{tile.label}</dt>
              <dd className="text-[22px] font-bold">{formatRupees(tile.amount, locale)}</dd>
              <dd className="text-sm text-[#3F4843]">{tile.detail}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-[15px] text-[#3F4843]">
        <FileText aria-hidden="true" className="size-5.5 shrink-0 text-muted-foreground" />
        <p className="flex-1">
          <strong className="text-foreground">{t("money.letterName", { number: letter.letterNumber })}</strong>{" "}
          {audience !== "ds"
            ? t("money.letterHo", {
                date: formatDate(letter.letterDate),
                district: letter.districtName,
                count: letter.cases,
                total: formatRupees(letter.cases * release.amount, locale),
                until: formatDate(letter.validUntil),
              })
            : t("money.letterDs", {
                date: formatDate(letter.letterDate),
                district: letter.districtName,
                until: formatDate(letter.validUntil),
              })}
        </p>
        {letter.scanId && <ScanLink id={letter.scanId} />}
      </div>

      {dsRelease && (
        <div className="flex flex-col gap-1.5 rounded-lg border px-3.5 py-2.5 text-[15px] text-[#3F4843]">
          <div className="flex items-center gap-3">
            <FileText aria-hidden="true" className="size-5.5 shrink-0 text-muted-foreground" />
            <p className="flex-1">
              <strong className="text-foreground">
                {t("money.dsReleaseName", { reference: dsRelease.referenceNumber })}
              </strong>{" "}
              {t("money.dsReleaseText", {
                date: formatDate(dsRelease.releasedOn),
                district: dsRelease.districtName,
                office: dsRelease.officeName,
                count: dsRelease.cases,
              })}
            </p>
            {dsRelease.scanId && <ScanLink id={dsRelease.scanId} />}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pl-8.5">
            <div className="flex flex-col gap-0.5">
              {dsRelease.note && <p className="whitespace-pre-line">{t("money.note", { note: dsRelease.note })}</p>}
              <p>{t("money.recordedBy", { name: dsRelease.byName, date: formatDate(dsRelease.at) })}</p>
            </div>
            {dsCorrection}
          </div>
        </div>
      )}

      {!waiting && (
        <table className="w-full border-collapse text-left">
          <thead className="text-[15px] text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t("money.installment")}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                {t("money.status")}
              </th>
              {actions && (
                <th scope="col" className="py-2 pl-3 text-right font-semibold">
                  <span className="sr-only">{tp("installments.actions")}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.number} className="border-b last:border-b-0">
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 font-bold ${DOT[item.status]}`}
                    >
                      {item.number}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-semibold">{t(`installment.name.${item.number as 1 | 2 | 3 | 4}`)}</span>
                      <span className="text-sm text-muted-foreground">
                        {isUpcoming(item)
                          ? t("money.balanceToPay", { amount: formatRupees(item.amount, locale) })
                          : item.purpose
                            ? t("money.amountPurpose", {
                                amount: formatRupees(item.amount, locale),
                                purpose: item.purpose,
                              })
                            : formatRupees(item.amount, locale)}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`flex flex-col ${STATUS_TEXT[item.status]}`}>
                    <span className="font-semibold">{t(`installment.status.${item.status}`)}</span>
                    {item.releasedOn ? (
                      <span className="text-sm">{t("money.paidOn", { date: formatDate(item.releasedOn) })}</span>
                    ) : (
                      !isUpcoming(item) &&
                      item.expectedOn && (
                        <span className="text-sm">{t("money.expectedOn", { date: formatDate(item.expectedOn) })}</span>
                      )
                    )}
                  </span>
                </td>
                {actions && <td className="py-2.5 pl-3 text-right">{actions(item)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!waiting && allStarted && (
        <p className="rounded-lg bg-background px-4 py-3 font-semibold text-primary">{t("money.allStarted")}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-[15px] text-[#3F4843]">
        <div className="flex flex-col gap-0.5">
          {letter.note && <p className="whitespace-pre-line">{t("money.note", { note: letter.note })}</p>}
          <p>{t("money.recordedBy", { name: release.byName, date: formatDate(release.at) })}</p>
        </div>
        {correction}
      </div>
    </section>
  );
}
