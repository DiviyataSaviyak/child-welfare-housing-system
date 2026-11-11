import { getTranslations } from "next-intl/server";
import { caseName } from "@/components/cases/page-header";
import { formatDate } from "@/lib/dates";
import type { NotificationRow } from "@/server/notifications/queries";

/**
 * NTF-1: an officer's notifications, newest first, as in the prototype. Opening one marks it read and goes
 * to what it is about (`open`). Used by the DS officer's and the District officer's pages, which differ only
 * in their intro and actions.
 */
export async function NotificationList({
  intro,
  notifications,
  open,
  markAll,
}: {
  intro: string;
  notifications: NotificationRow[];
  open: (form: FormData) => Promise<void>;
  markAll: () => Promise<void>;
}) {
  const [t, tc] = await Promise.all([getTranslations("notifications"), getTranslations("cases")]);
  const unread = notifications.some((n) => !n.read);
  const headline = (item: NotificationRow) => {
    // A District officer's notice names the Ministry's letter; it always has one, as the letter made it.
    if (item.type === "DISTRICT_LETTER") {
      return t("type.DISTRICT_LETTER", { number: item.letter?.number ?? "", count: item.letter?.count ?? 0 });
    }
    return t(`type.${item.type as Exclude<NotificationRow["type"], "DISTRICT_LETTER">}`, {
      name: caseName(tc, item.name, item.childName),
    });
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[28px] leading-snug font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{intro}</p>
        </div>
        {unread && (
          <form action={markAll} className="shrink-0">
            <button
              type="submit"
              className="h-11 rounded-lg border border-primary bg-card px-4.5 font-semibold whitespace-nowrap text-primary"
            >
              {t("markAll")}
            </button>
          </form>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {notifications.map((item) => (
            <li key={item.id}>
              <form action={open}>
                <input type="hidden" name="id" value={item.id} />
                <button
                  type="submit"
                  className={`flex w-full items-start justify-between gap-4 rounded-xl border-2 px-5 py-3.5 text-left ${
                    item.read ? "border-border bg-card" : "border-primary bg-accent"
                  }`}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className={`text-[17px] ${item.read ? "font-medium" : "font-bold"}`}>{headline(item)}</span>
                    <span className="text-[15px] text-muted-foreground">
                      {item.type === "DISTRICT_LETTER"
                        ? formatDate(item.createdAt)
                        : t("detail", { number: item.applicationNumber, date: formatDate(item.createdAt) })}
                    </span>
                  </span>
                  {!item.read && (
                    <span className="shrink-0 rounded-full bg-primary px-3 py-0.5 text-sm font-semibold text-primary-foreground">
                      {t("unread")}
                    </span>
                  )}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
