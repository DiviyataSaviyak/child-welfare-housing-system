import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import { isRole } from "@/server/auth/roles";
import type { HistoryEntry } from "@/server/users/queries";

const KNOWN_ACTIONS = [
  "account_created",
  "account_updated",
  "password_reset",
  "password_changed",
  "account_disabled",
  "account_enabled",
  "account_locked",
  "new_password_asked",
  "new_password_request_closed",
  "new_password_request_withdrawn",
] as const;
type KnownAction = (typeof KNOWN_ACTIONS)[number];

const FIELDS = ["name", "designation", "mobile", "contactEmail", "role", "dsOfficeId"] as const;
type Field = (typeof FIELDS)[number];

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** ADM-4: the account's history, newest first, as plain Sinhala sentences (HIS-2). */
export async function AccountHistory({
  entries,
  officeNames,
}: {
  entries: HistoryEntry[];
  officeNames: Record<number, string>;
}) {
  const t = await getTranslations("users");
  const office = (id: unknown) => (typeof id === "number" ? (officeNames[id] ?? String(id)) : t("history.noOffice"));
  const role = (value: unknown) => (isRole(value) ? t(`roles.${value}`) : t("history.noOffice"));

  const details = (entry: HistoryEntry): string[] => {
    if (entry.action !== "account_updated") return [];
    const before = asObject(entry.before);
    const after = asObject(entry.after);
    const changed = FIELDS.filter((field) => field in after);
    const lines: string[] = [];
    if (changed.includes("dsOfficeId")) {
      lines.push(t("history.officeMoved", { from: office(before.dsOfficeId), to: office(after.dsOfficeId) }));
    }
    if (changed.includes("role"))
      lines.push(t("history.roleChanged", { from: role(before.role), to: role(after.role) }));
    const others = changed.filter(
      (field): field is Exclude<Field, "dsOfficeId" | "role"> => field !== "dsOfficeId" && field !== "role",
    );
    if (others.length > 0) {
      lines.push(
        t("history.changedFields", { fields: others.map((field) => t(`history.fields.${field}`)).join(", ") }),
      );
    }
    return lines;
  };

  return (
    <section aria-labelledby="history-title" className="flex max-w-3xl flex-col gap-3 rounded-xl border bg-card p-6">
      <h2 id="history-title" className="text-xl font-bold">
        {t("history.title")}
      </h2>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">{t("history.empty")}</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => {
            const action: KnownAction | "other" = (KNOWN_ACTIONS as readonly string[]).includes(entry.action)
              ? (entry.action as KnownAction)
              : "other";
            return (
              <li key={index} className="grid grid-cols-[110px_1fr] gap-4 border-b py-2.5 last:border-0">
                <span className="text-[15px] text-muted-foreground tabular-nums">{formatDate(entry.at)}</span>
                <span className="flex flex-col">
                  <span className="text-base">{t(`history.actions.${action}`)}</span>
                  {details(entry).map((line) => (
                    <span key={line} className="text-[15px] text-muted-foreground">
                      {line}
                    </span>
                  ))}
                  <span className="text-sm text-muted-foreground">
                    {entry.actorName ??
                      (entry.action === "new_password_asked" ? t("history.signInPage") : t("history.system"))}
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
