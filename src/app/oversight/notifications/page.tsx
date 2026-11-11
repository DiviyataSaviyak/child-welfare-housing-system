import { getTranslations } from "next-intl/server";
import { NotificationList } from "@/components/notifications/notification-list";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { listNotifications } from "@/server/notifications/queries";
import { markAllReadAction, openNotificationAction } from "./actions";

/** NTF-1: the District officer's notices of the Ministry's letters to the district, newest first. */
export default async function DistrictNotificationsPage() {
  const viewer = await requireRole("DISTRICT_OFFICER");
  const [t, notifications] = await Promise.all([getTranslations("notifications"), listNotifications(db, viewer)]);
  return (
    <NotificationList
      intro={t("introDistrict")}
      notifications={notifications}
      open={openNotificationAction}
      markAll={markAllReadAction}
    />
  );
}
