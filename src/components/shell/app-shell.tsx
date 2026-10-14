import { getTranslations } from "next-intl/server";
import { Mark } from "@/components/brand/lockup";
import { LanguagePicker } from "@/components/language-picker";
import { Bell } from "./bell";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";
import type { Area, LiveCount, NavEntry } from "./types";

/** Header, menu and page area shared by every role's screens, as in the prototype (UI-7). */
export async function AppShell({
  area,
  userName,
  officeName,
  nav,
  bell,
  children,
}: {
  area: Area;
  userName: string;
  /** The DS office of a DS officer; shown in the header instead of the general area name. */
  officeName?: string | null;
  nav: NavEntry[];
  /** NTF-1: the notifications page and how many are unread. */
  bell?: { href: string; unread: LiveCount };
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const areaLabel = officeName ? t("areas.dsOffice", { office: officeName }) : t(`areas.${area}`);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-5 bg-header px-8 text-header-foreground">
        <span className="flex shrink-0 items-center gap-3">
          <span className="flex h-11 w-12 shrink-0 items-center justify-center rounded-lg bg-[#fbf5ea]">
            <Mark className="h-8 w-[35px]" />
          </span>
          <span className="text-[22px] font-bold whitespace-nowrap">{t("app.name")}</span>
        </span>
        <span className="shrink-0 text-base whitespace-nowrap text-header-muted">{areaLabel}</span>
        <div className="ms-auto flex min-w-0 items-center gap-4">
          <LanguagePicker tone="header" />
          {bell && <Bell href={bell.href} unread={bell.unread} />}
          <span className="shrink-0 text-base whitespace-nowrap" aria-label={`${t("shell.signedInAs")} ${userName}`}>
            {userName}
          </span>
          <SignOutButton />
        </div>
      </header>
      <NavLinks
        label={t("nav.label")}
        items={nav.map((entry) => ({
          href: entry.href,
          label: t(`nav.${entry.labelKey}`),
          exact: entry.exact,
          alsoActive: entry.alsoActive,
          count: entry.count,
        }))}
      />
      <main className="flex-1 px-8 pt-7 pb-10">{children}</main>
    </div>
  );
}
