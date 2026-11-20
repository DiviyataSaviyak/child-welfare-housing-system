import { getLocale, getTranslations } from "next-intl/server";
import { ProfileDialog } from "@/app/_profile/profile-dialog";
import { LanguagePicker } from "@/components/language-picker";
import { getContext } from "@/server/context";
import { db } from "@/server/db";
import { getProfile } from "@/server/users/queries";
import { Bell } from "./bell";
import { HeaderScene } from "./header-scene";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";
import type { Area, LiveCount, NavEntry } from "./types";

/** Header, menu and page area shared by every role's screens, as in the prototype (UI-7). */
export async function AppShell({
  area,
  userName,
  officeName,
  areaLabel: place,
  nav,
  bell,
  children,
}: {
  area: Area;
  userName: string;
  /** The DS office of a DS officer; shown in the header instead of the general area name. */
  officeName?: string | null;
  /** The place a view-only account sees (PRM-4), shown in the header instead of the general area name. */
  areaLabel?: string | null;
  nav: NavEntry[];
  /** NTF-1: the notifications page and how many are unread. */
  bell?: { href: string; unread: LiveCount };
  children: React.ReactNode;
}) {
  const [t, locale, context, en] = await Promise.all([
    getTranslations(),
    getLocale(),
    getContext(),
    getTranslations({ locale: "en", namespace: "app" }),
  ]);
  // As on the ministry's letterhead, its English name stands under the screen's own (marked with its `lang`).
  const englishMinistry = en("ministry");
  // The name in the header opens the signed-in user's profile in a pop-up.
  const profile = context ? await getProfile(db, context.userId, locale) : null;
  const areaLabel = place ?? (officeName ? t("areas.dsOffice", { office: officeName }) : t(`areas.${area}`));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 shrink-0 overflow-hidden bg-white bg-[linear-gradient(90deg,#ffffff_0%,#ffffff_30%,#f5faf6_55%,#f1f7f3_80%,#f8fbf9_100%)] text-foreground shadow-[0_4px_14px_-8px_rgb(10_70_57/0.25)]">
        <HeaderScene className="pointer-events-none absolute bottom-[3px] left-[31%] hidden h-[100px] w-[600px] xl:block" />
        <div className="relative flex h-[104px] items-center gap-6 px-8">
          <div className="flex min-w-0 shrink-0 items-center gap-5">
            {/* The emblem is decorative here: the names beside it say whose it is. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/emblem-of-sri-lanka.svg" alt="" width={600} height={851} className="h-[76px] w-auto shrink-0" />
            <span aria-hidden="true" className="h-[68px] w-px shrink-0 bg-black/15" />
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-3">
                <span className="text-[28px] leading-tight font-bold tracking-tight whitespace-nowrap text-header">
                  {t("app.name")}
                </span>
                <span className="truncate rounded-full bg-accent px-3 py-0.5 text-[13px] font-semibold whitespace-nowrap text-header ring-1 ring-header/15 ring-inset">
                  {areaLabel}
                </span>
              </span>
              <span className="text-[16px] leading-snug font-semibold whitespace-nowrap text-[#1c2420]">
                {t("app.ministry")}
              </span>
              {locale !== "en" && (
                <span lang="en" className="text-[15px] leading-snug font-medium whitespace-nowrap text-[#1c2420]">
                  {englishMinistry}
                </span>
              )}
            </span>
          </div>
          <div className="ms-auto flex min-w-0 items-center gap-3">
            <LanguagePicker tone="header" />
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
        {/* A green line along the bottom, with the logo's gold sweeping up at the right. */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-header" />
        <svg
          aria-hidden="true"
          viewBox="0 0 480 28"
          preserveAspectRatio="none"
          className="pointer-events-none absolute right-0 bottom-0 hidden h-[26px] w-[460px] lg:block"
        >
          <path d="M0 28 C200 27 360 20 480 2 V11 C370 24 200 28 0 28 Z" fill="var(--gold)" />
          <path d="M40 28 C240 28 380 22 480 11 V28 Z" fill="var(--header)" />
        </svg>
      </header>
      <NavLinks
        label={t("nav.label")}
        items={nav.map((entry) => ({
          href: entry.href,
          label: t(`nav.${entry.labelKey}`),
          exact: entry.exact,
          alsoActive: entry.alsoActive,
          count: entry.count,
          countWords: entry.countWords,
        }))}
      />
      <main className="flex-1 px-8 pt-7 pb-10">{children}</main>
    </div>
  );
}
