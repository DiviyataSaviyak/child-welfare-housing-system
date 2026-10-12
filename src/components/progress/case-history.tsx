import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import type { HistoryEntry } from "@/server/history/queries";

const ACTIONS = [
  "case_created",
  "case_updated",
  "document_removed",
  "case_submitted",
  "case_verified",
  "case_sent_back",
  "case_rejected",
  "case_released",
  "release_corrected",
  "installment_started",
  "installment_paid",
  "installment_payment_undone",
  "case_completed",
  "case_stopped",
  "case_reopened",
] as const;
type Action = (typeof ACTIONS)[number];
const isAction = (value: string): value is Action => (ACTIONS as readonly string[]).includes(value);

const FIELDS = [
  "dsOfficeId",
  "category",
  "kind",
  "childName",
  "name",
  "nic",
  "address",
  "gnDivision",
  "mobile1",
  "mobile2",
  "remark",
  "releasedOn",
  "referenceNumber",
  "letterNumber",
  "letterDate",
  "validUntil",
  "note",
] as const;
type Field = (typeof FIELDS)[number];

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
const installmentNumber = (value: unknown): 1 | 2 | 3 | 4 | null =>
  value === 1 || value === 2 || value === 3 || value === 4 ? value : null;

/**
 * HIS-2: the case's history, newest first, as plain sentences in the screen's language as in the prototype: the day,
 * what happened, and who did it. Reasons, notes and changed fields go on a line under the sentence.
 * A changed detail is named; its old and new values stay in the audit record (CASE-9, HIS-1).
 */
export async function CaseHistory({ entries }: { entries: HistoryEntry[] }) {
  const [t, tc] = await Promise.all([getTranslations("history"), getTranslations("cases")]);

  const installment = (value: unknown) => {
    const number = installmentNumber(value);
    return number ? tc(`installment.name.${number}`) : tc("none");
  };
  const day = (value: unknown) => {
    const shown = text(value);
    return shown ? formatDate(shown) : tc("none");
  };

  function describe(entry: HistoryEntry): { sentence: string; lines: string[] } {
    const { after, before } = entry;
    const lines: string[] = [];
    const reason = text(after.reason);
    if (reason) lines.push(t("reason", { reason }));
    // CASE-11: a rejection or stop that asked for another name, and a reopening that withdrew it.
    if (after.anotherNameRequested === true) lines.push(t("anotherNameRequested"));
    if (after.anotherNameWithdrawn === true) lines.push(t("anotherNameWithdrawn"));

    switch (entry.action) {
      case "case_created":
      case "case_updated": {
        const changed = FIELDS.filter((field: Field) => field in after);
        if (entry.action === "case_updated" && changed.length > 0) {
          lines.push(t("changedFields", { fields: changed.map((field) => t(`fields.${field}`)).join(", ") }));
        }
        if ("replacesCaseId" in after) lines.push(t(text(after.replacesCaseId) ? "replacesSet" : "replacesCleared"));
        const added = count(after.documentsAdded);
        if (added > 0) lines.push(t("documentsAdded", { count: added }));
        return { sentence: t(`actions.${entry.action}`), lines };
      }
      case "case_submitted": {
        const number = text(after.caseNumber);
        return {
          sentence: number ? t("actions.case_submittedNumber", { number }) : t("actions.case_submitted"),
          lines,
        };
      }
      case "case_released": {
        // Since 6 Oct 2026 a release comes with its district's allocation letter (REL-2); older
        // records name only the release's reference number.
        const letter = text(after.letterNumber);
        return {
          sentence: letter
            ? t("actions.case_releasedLetter", { district: text(after.district) ?? tc("none"), number: letter })
            : t("actions.case_released", { reference: text(after.referenceNumber) ?? tc("none") }),
          lines,
        };
      }
      case "release_corrected": {
        for (const field of ["releasedOn", "letterDate", "validUntil"] as const) {
          if (field in after) {
            lines.push(t("change", { field: t(`fields.${field}`), from: day(before[field]), to: day(after[field]) }));
          }
        }
        for (const field of ["referenceNumber", "letterNumber"] as const) {
          if (field in after) {
            const from = text(before[field]) ?? tc("none");
            const to = text(after[field]) ?? tc("none");
            lines.push(t("change", { field: t(`fields.${field}`), from, to }));
          }
        }
        if ("note" in after) lines.push(t("changedFields", { fields: t("fields.note") }));
        return { sentence: t("actions.release_corrected"), lines };
      }
      case "installment_started":
        if (text(after.purpose)) lines.push(text(after.purpose) as string);
        if (text(after.note)) lines.push(t("note", { note: text(after.note) as string }));
        return {
          sentence: t("actions.installment_started", {
            installment: installment(after.number),
            date: day(after.expectedOn),
          }),
          lines,
        };
      case "installment_paid":
        if (text(after.note)) lines.push(t("note", { note: text(after.note) as string }));
        return {
          sentence: t("actions.installment_paid", {
            installment: installment(after.number),
            date: day(after.releasedOn),
          }),
          lines,
        };
      case "installment_payment_undone":
        return { sentence: t("actions.installment_payment_undone", { installment: installment(after.number) }), lines };
      case "stage_updated": {
        const stages = Array.isArray(after.stages)
          ? after.stages.filter((s): s is string => typeof s === "string")
          : [];
        const photos = count(after.photos);
        if (photos > 0) lines.push(t("photos", { count: photos }));
        if (text(after.note)) lines.push(t("note", { note: text(after.note) as string }));
        return {
          sentence:
            stages.length > 0
              ? t("actions.stage_reached", { stages: stages.join(", "), date: day(after.visitedOn) })
              : t("actions.stage_visit", { date: day(after.visitedOn) }),
          lines,
        };
      }
      default:
        return { sentence: isAction(entry.action) ? t(`actions.${entry.action}`) : t("actions.other"), lines };
    }
  }

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-1.5 rounded-xl border bg-card px-5.5 py-5">
      <h2 id="history-title" className="text-xl font-bold">
        {t("title")}
      </h2>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry) => {
            const { sentence, lines } = describe(entry);
            return (
              <li key={entry.id} className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 border-b py-2 last:border-b-0">
                <span className="text-[15px] text-muted-foreground tabular-nums">{formatDate(entry.at)}</span>
                <span className="flex flex-col">
                  <span className="text-base">{sentence}</span>
                  {lines.map((line, index) => (
                    <span key={index} className="text-[15px] break-words whitespace-pre-line text-[#3F4843]">
                      {line}
                    </span>
                  ))}
                  <span className="text-sm text-muted-foreground">
                    {entry.actor
                      ? entry.actor.role
                        ? t("who", { name: entry.actor.name, role: t(`roles.${entry.actor.role}`) })
                        : entry.actor.name
                      : t("system")}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
