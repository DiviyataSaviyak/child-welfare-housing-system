import { AppShell } from "@/components/shell/app-shell";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { unreadNow } from "@/server/notifications/queries";

/** NTF-1: the bell's count is read again from /ds/notifications/unread after every client-side move. */
export default async function DsLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("DS_OFFICER");
  const unread = await unreadNow(db, context);
  return (
    <AppShell
      area="ds"
      userName={context.label}
      officeName={context.dsOfficeName}
      nav={[
        { href: "/ds", labelKey: "dsHome", exact: true },
        { href: "/ds/cases/new", labelKey: "dsNewCase" },
      ]}
      bell={{ href: "/ds/notifications", unread: { ...unread, source: "/ds/notifications/unread" } }}
    >
      {children}
    </AppShell>
  );
}
