import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import { isDesignation } from "@/server/auth/designations";
import { isRole } from "@/server/auth/roles";
import type { HistoryEntry, PlaceNames } from "@/server/users/queries";

const KNOWN_ACTIONS = [
  "account_created",
  "account_updated",
  "password_reset",
  "password_changed",
  "account_disabled",
  "account_enabled",
  "account_locked",
  "reset_code_sent",
  "password_reset_by_code",
] as const;
type KnownAction = (typeof KNOWN_ACTIONS)[number];

const FIELDS = [
  "name",
  "designation",
  "mobile",
  "contactEmail",
  "role",
  "dsOfficeId",
  "districtId",
  "provinceId",
] as const;
/** The fields that get a line of their own; the others are listed by name. */
const OWN_LINE = ["designation", "role", "dsOfficeId", "districtId", "provinceId"] as const;
type ListedField = Exclude<(typeof FIELDS)[number], (typeof OWN_LINE)[number]>;

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** ADM-4: the account's history, newest first, as plain sentences in the screen's language (HIS-2). */
export async function AccountHistory({ entries, placeNames }: { entries: HistoryEntry[]; placeNames: PlaceNames }) {
  const t = await getTranslations("users");
  const none = t("history.noOffice");
  const named = (names: Record<number, string>) => (id: unknown) =>
    typeof id === "number" ? (names[id] ?? String(id)) : none;
  const office = named(placeNames.offices);
  const district = named(placeNames.districts);
  const province = named(placeNames.provinces);
  const role = (value: unknown) => (isRole(value) ? t(`roles.${value}`) : none);
  // Rows from before change 0005 hold free text: a known code shows its label, anything else as written.
  const designation = (value: unknown) =>
    isDesignation(value) ? t(`designations.${value}`) : typeof value === "string" && value ? value : none;

  const details = (entry: HistoryEntry): string[] => {
    if (entry.action !== "account_updated") return [];
    const before = asObject(entry.before);
    const after = asObject(entry.after);
    const changed = FIELDS.filter((field) => field in after);
    const lines: string[] = [];
    const line = (
      field: (typeof OWN_LINE)[number],
      key: `history.${"designationChanged" | "roleChanged" | "officeMoved" | "districtMoved" | "provinceMoved"}`,
      show: (value: unknown) => string,
    ) => {
      if (changed.includes(field)) lines.push(t(key, { from: show(before[field]), to: show(after[field]) }));
    };
    line("designation", "history.designationChanged", designation);
    line("role", "history.roleChanged", role);
    line("dsOfficeId", "history.officeMoved", office);
    line("districtId", "history.districtMoved", district);
    line("provinceId", "history.provinceMoved", province);
    const others = changed.filter((field): field is ListedField => !(OWN_LINE as readonly string[]).includes(field));
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
                    {/* A code is sent when someone asks on the sign-in page (AUTH-7), so no one is signed in. */}
                    {entry.actorName ??
                      (entry.action === "reset_code_sent" ? t("history.signInPage") : t("history.system"))}
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
