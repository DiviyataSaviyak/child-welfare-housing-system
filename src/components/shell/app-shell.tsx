import { getLocale, getTranslations } from "next-intl/server";
import { ProfileDialog } from "@/app/_profile/profile-dialog";
import { Mark } from "@/components/brand/lockup";
import { LanguagePicker } from "@/components/language-picker";
import { getContext } from "@/server/context";
import { db } from "@/server/db";
import { getProfile } from "@/server/users/queries";
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
  const [t, locale, context] = await Promise.all([getTranslations(), getLocale(), getContext()]);
  // The name in the header opens the signed-in user's profile in a pop-up.
  const profile = context ? await getProfile(db, context.userId, locale) : null;
  const areaLabel = officeName ? t("areas.dsOffice", { office: officeName }) : t(`areas.${area}`);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 shrink-0 bg-header bg-[linear-gradient(105deg,#0f6553_0%,var(--header)_45%,#0a4639_100%)] text-header-foreground shadow-[0_1px_0_rgb(0_0_0/0.08),0_6px_18px_-8px_rgb(10_70_57/0.55)]">
        {/* The logo's gold base, as a thin line along the top. */}
        <div aria-hidden="true" className="h-1 bg-gold" />
        <div className="flex h-[88px] items-center gap-6 px-8">
          <div className="flex min-w-0 shrink-0 items-center gap-3.5">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-white shadow-[0_2px_6px_rgb(0_0_0/0.18)] ring-1 ring-white/40">
              <Mark className="h-[40px] w-auto" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[22px] leading-tight font-bold tracking-tight whitespace-nowrap">
                {t("app.name")}
              </span>
              <span className="text-[15px] leading-snug whitespace-nowrap text-header-muted">{areaLabel}</span>
            </span>
          </div>
          <div className="ms-auto flex min-w-0 items-center gap-3">
            <LanguagePicker tone="header" />
            <span aria-hidden="true" className="mx-1 h-7 w-px shrink-0 bg-white/20" />
            {bell && <Bell href={bell.href} unread={bell.unread} />}
            {profile ? (
              <ProfileDialog userName={userName} profile={profile} />
            ) : (
              <span
                className="shrink-0 text-base whitespace-nowrap"
                aria-label={`${t("shell.signedInAs")} ${userName}`}
              >
                {userName}
              </span>
            )}
            <SignOutButton />
          </div>
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
