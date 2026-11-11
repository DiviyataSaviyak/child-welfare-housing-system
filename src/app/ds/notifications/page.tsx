import { getTranslations } from "next-intl/server";
import { NotificationList } from "@/components/notifications/notification-list";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { listNotifications } from "@/server/notifications/queries";
import { markAllReadAction, openNotificationAction } from "./actions";

/** NTF-1: what happened to the office's cases, newest first. Opening one marks it read. */
export default async function DsNotificationsPage() {
  const viewer = await requireRole("DS_OFFICER");
  const [t, notifications] = await Promise.all([getTranslations("notifications"), listNotifications(db, viewer)]);
  return (
    <NotificationList
      intro={t("intro")}
      notifications={notifications}
      open={openNotificationAction}
      markAll={markAllReadAction}
    />
  );
}
