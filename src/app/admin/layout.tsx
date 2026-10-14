import { AppShell } from "@/components/shell/app-shell";
import { requireRole } from "@/server/context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("ADMIN");
  return (
    <AppShell
      area="admin"
      userName={context.name}
      nav={[
        { href: "/admin/users", labelKey: "adminUsers" },
        { href: "/admin/lists", labelKey: "adminLists" },
      ]}
    >
      {children}
    </AppShell>
  );
}
