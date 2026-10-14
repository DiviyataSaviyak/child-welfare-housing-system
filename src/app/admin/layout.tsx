import { AppShell } from "@/components/shell/app-shell";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { newPasswordRequestsNow } from "@/server/users/queries";

/**
 * The users entry shows how many officers wait for a new password (AUTH-7). As in Head Office's menu,
 * the actions that answer a request refresh the layout, and the menu reads the count again from
 * /admin/waiting after every move.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("ADMIN");
  const requests = await newPasswordRequestsNow(db);
  return (
    <AppShell
      area="admin"
      userName={context.name}
      nav={[
        {
          href: "/admin/users",
          labelKey: "adminUsers",
          count: { ...requests, source: "/admin/waiting" },
          countKey: "newPasswordRequests",
        },
        { href: "/admin/lists", labelKey: "adminLists" },
      ]}
    >
      {children}
    </AppShell>
  );
}
