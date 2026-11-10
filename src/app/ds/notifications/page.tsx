import { getTranslations } from "next-intl/server";
import { caseName } from "@/components/cases/page-header";
import { formatDate } from "@/lib/dates";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { listNotifications } from "@/server/notifications/queries";
import { markAllReadAction, openNotificationAction } from "./actions";

/** NTF-1: what Head Office decided about the office's cases, newest first. Opening one marks it read. */
export default async function DsNotificationsPage() {
  const viewer = await requireRole("DS_OFFICER");
  const [t, tc, notifications] = await Promise.all([
    getTranslations("notifications"),
    getTranslations("cases"),
    listNotifications(db, viewer),
  ]);
  const unread = notifications.some((n) => !n.read);

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[28px] leading-snug font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("intro")}</p>
        </div>
        {unread && (
          <form action={markAllReadAction} className="shrink-0">
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
              <form action={openNotificationAction}>
                <input type="hidden" name="id" value={item.id} />
                <button
                  type="submit"
                  className={`flex w-full items-start justify-between gap-4 rounded-xl border-2 px-5 py-3.5 text-left ${
                    item.read ? "border-border bg-card" : "border-primary bg-accent"
                  }`}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className={`text-[17px] ${item.read ? "font-medium" : "font-bold"}`}>
                      {t(`type.${item.type}`, { name: caseName(tc, item.name, item.childName) })}
                    </span>
                    <span className="text-[15px] text-muted-foreground">
                      {t("detail", {
                        number: item.applicationNumber,
                        date: formatDate(item.createdAt),
                      })}
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
