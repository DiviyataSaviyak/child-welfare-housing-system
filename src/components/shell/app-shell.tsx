import { getLocale, getTranslations } from "next-intl/server";
import { ProfileDialog } from "@/app/_profile/profile-dialog";
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
      {/* Sizes and colours follow the header mockup (1672 px wide, 122 px tall), whose picture it uses. */}
      <header className="sticky top-0 z-30 shrink-0 overflow-hidden bg-white bg-[linear-gradient(90deg,#ffffff_0%,#ffffff_28%,#f6faf3_42%,#e9f3e5_62%,#edf6e9_78%,#f3f8ee_100%)] pb-[3px] text-[#1f2e3a]">
        <div className="relative flex h-[119px] items-center ps-[59px] pe-[11px]">
          <div className="flex min-w-0 shrink-0 items-center">
            {/* The emblem is decorative here: the names beside it say whose it is. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/emblem-of-sri-lanka.svg" alt="" width={600} height={851} className="h-[90px] w-auto shrink-0" />
            <span aria-hidden="true" className="ms-[29px] h-[80px] w-[1.5px] shrink-0 bg-[#114b3a]" />
            <span className="ms-[27px] flex min-w-0 flex-col">
              <span className="text-[30px] leading-[42px] font-bold whitespace-nowrap text-[#0b6138]">
                {t("app.name")}
              </span>
              <span className="text-[16px] leading-[25px] font-semibold whitespace-nowrap text-[#123f30]">
                {t("app.ministry")}
              </span>
              {locale !== "en" && (
                <span
                  lang="en"
                  className="text-[16px] leading-[23px] font-semibold whitespace-nowrap text-[#1b2733] [font-family:var(--font-latin),sans-serif]"
                >
                  {englishMinistry}
                </span>
              )}
            </span>
          </div>
          {/* The children and the house, from the mockup, between the names and the buttons. Where the
              space is short only the children show (centred on them: the picture is 592 px, they stand
              at 225 px), and where it is shorter still, nothing. */}
          <div aria-hidden="true" className="@container hidden min-w-0 flex-1 self-stretch lg:block">
            <div className="mx-auto hidden h-full max-w-[592px] bg-[url(/header-scene.webp)] bg-[length:auto_100%] bg-[position:calc(50%+71px)_bottom] bg-no-repeat [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_88%,transparent)] @min-[170px]:block @min-[540px]:bg-bottom" />
          </div>
          <div className="ms-auto flex shrink-0 items-center">
            <LanguagePicker tone="header" />
            {bell && (
              <span className="ms-5">
                <Bell href={bell.href} unread={bell.unread} />
              </span>
            )}
            <span aria-hidden="true" className="ms-[7px] h-[26px] w-px bg-black/10" />
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
        {/* The green and gold sweep at the right, over the green line along the bottom. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 360 35"
          preserveAspectRatio="none"
          className="pointer-events-none absolute right-0 bottom-[3px] hidden h-[35px] w-[360px] lg:block"
        >
          <defs>
            <linearGradient id="header-gold" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#f7c62c" />
              <stop offset="0.55" stopColor="#fecd34" />
              <stop offset="1" stopColor="#c99c2c" />
            </linearGradient>
          </defs>
          <path d="M0 33 C150 31 270 20 360 0 V17 C270 28 150 33 0 34 Z" fill="#0a6b44" />
          <path d="M0 34 C150 33 270 28 360 17 V35 H0 Z" fill="url(#header-gold)" />
        </svg>
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-[#0a6b44]" />
      </header>
      <NavLinks
        label={t("nav.label")}
        place={areaLabel}
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
