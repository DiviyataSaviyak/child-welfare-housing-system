import { getLocale, getTranslations } from "next-intl/server";
import { ProfileDialog } from "@/app/_profile/profile-dialog";
import { LanguagePicker } from "@/components/language-picker";
import { ThemeToggle } from "@/components/theme/theme-toggle";
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
      {/* Sizes and colours follow the header mockup (1672 px wide, 130 px tall), whose picture it uses. */}
      <header className="sticky top-0 z-30 shrink-0 overflow-hidden bg-[#f7f9fc] text-[#1f2e3a] dark:bg-[#121a16] dark:bg-[linear-gradient(90deg,#121a16_0%,#121a16_28%,#14201a_42%,#17271f_62%,#16251d_78%,#14211a_100%)] dark:text-foreground">
        <div className="relative flex h-[130px] items-center ps-[47px] pe-[11px]">
          <div className="relative z-10 flex min-w-0 shrink-0 items-center">
            {/* The emblem is decorative here: the names beside it say whose it is. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/emblem-of-sri-lanka.svg"
              alt=""
              width={600}
              height={851}
              className="h-[90px] w-auto shrink-0 2xl:h-[98px]"
            />
            <span
              aria-hidden="true"
              className="ms-[29px] h-[80px] w-[1.5px] shrink-0 2xl:ms-[40px] 2xl:h-[90px] bg-[#114b3a] dark:bg-[#3f7d67]"
            />
            <span className="ms-[27px] flex min-w-0 flex-col 2xl:ms-[31px]">
              <span className="text-[30px] leading-[42px] font-bold 2xl:text-[34px] 2xl:leading-[46px] whitespace-nowrap text-[#0b6138] dark:text-[#7ad6ad]">
                {t("app.name")}
              </span>
              <span className="text-[16px] leading-[25px] font-semibold 2xl:text-[18px] 2xl:leading-[28px] whitespace-nowrap text-[#123f30] dark:text-[#d0e2d9]">
                {t("app.ministry")}
              </span>
              {locale !== "en" && (
                <span
                  lang="en"
                  className="text-[16px] leading-[23px] font-medium 2xl:text-[17px] 2xl:leading-[25px] whitespace-nowrap text-[#1b2733] dark:text-[#b4c0ba] [font-family:var(--font-latin),sans-serif]"
                >
                  {englishMinistry}
                </span>
              )}
            </span>
          </div>
          {/* The mother, the children and the house, cut from the mockup at its own size (585 × 130 px).
              The names take the mockup's larger sizes only on wide screens, where they leave room for it.
              It ends just before the panel's curve and fades in just after the names; where the space is
              short its left part goes, and where it is shorter still, all of it. */}
          <div aria-hidden="true" className="@container relative hidden min-w-0 flex-1 self-stretch lg:block">
            <div className="absolute inset-y-0 end-[30px] hidden w-[585px] max-w-[calc(100%-30px)] bg-[url(/header-scene.webp)] bg-[length:auto_100%] bg-right-bottom bg-no-repeat [mask-image:linear-gradient(90deg,transparent,#000_16%,#000_96%,transparent)] dark:opacity-55 dark:[filter:brightness(0.8)_saturate(0.8)] @min-[150px]:block" />
          </div>
          <div className="relative ms-auto flex shrink-0 items-center self-stretch">
            {/* The light panel behind the buttons: the mockup's curved edge over the picture, and the
                green hill at its bottom right. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-[-84px] end-[-11px] flex">
              <svg viewBox="0 0 100 130" preserveAspectRatio="none" className="h-full w-[100px] shrink-0">
                <defs>
                  <linearGradient id="header-panel" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" className="[stop-color:#eef5fb] dark:[stop-color:#141d18]" stopOpacity="0.94" />
                    <stop offset="1" className="[stop-color:#f2f7f5] dark:[stop-color:#141d18]" stopOpacity="0.94" />
                  </linearGradient>
                </defs>
                <path d="M0 0 C40 30 45 105 100 130 V0 Z" fill="url(#header-panel)" />
                <path
                  d="M0 0 C40 30 45 105 100 130"
                  fill="none"
                  className="stroke-white dark:stroke-white/10"
                  strokeWidth="2"
                />
              </svg>
              <span className="relative -ms-px flex-1 bg-[linear-gradient(180deg,#eef5fbf0,#f2f7f5f0)] dark:bg-none dark:bg-[#141d18]/95">
                <svg
                  viewBox="0 0 260 40"
                  preserveAspectRatio="none"
                  className="absolute end-0 bottom-0 h-[40px] w-[260px] dark:opacity-25"
                >
                  <path d="M0 40 C90 39 170 30 260 6 V40 Z" fill="#cdeae1" />
                  <path d="M60 40 C140 38 205 28 260 14 V40 Z" fill="#b2ddd0" />
                </svg>
              </span>
            </div>
            <div className="relative flex items-center">
              <LanguagePicker tone="header" />
              <span aria-hidden="true" className="ms-[18px] h-[30px] w-[1.5px] bg-[#1f3a33]/70 dark:bg-white/20" />
              <span className="ms-3">
                <ThemeToggle tone="header" />
              </span>
              {bell && (
                <span className="ms-1">
                  <Bell href={bell.href} unread={bell.unread} />
                </span>
              )}
              <span className="ms-[10px]">
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
              </span>
              <span className="ms-3">
                <SignOutButton />
              </span>
            </div>
          </div>
        </div>
      </header>
      <NavLinks
        label={t("nav.label")}
        place={areaLabel}
        items={nav.map((entry) => ({
          href: entry.href,
          label: t(`nav.${entry.labelKey}`),
          icon: entry.labelKey,
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
