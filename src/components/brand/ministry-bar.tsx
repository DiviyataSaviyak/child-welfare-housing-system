import { getTranslations } from "next-intl/server";
import { LOCALES } from "@/i18n/locales";
import { cn } from "@/lib/utils";

const NAME_SIZE = {
  si: "text-[15px] font-bold sm:text-[19px] short:text-[17px]",
  ta: "text-[12px] font-semibold sm:text-[15px] short:text-[13px]",
  en: "text-[13px] font-semibold sm:text-[17px] short:text-[15px]",
} as const;

/**
 * The ministry's letterhead, as on its own website: the national emblem, then its name in Sinhala,
 * Tamil and English, always in that order. Each name is marked with its own `lang`, like the
 * language picker, so the one-language checks (UI-1) read only the screen's own.
 */
export async function MinistryBar() {
  const names = await Promise.all(
    LOCALES.map(async (locale) => {
      const t = await getTranslations({ locale, namespace: "app" });
      return { locale, name: t("ministry") };
    }),
  );

  return (
    <header className="relative z-10 shrink-0 border-b border-black/[0.07] bg-white shadow-[0_1px_3px_rgb(28_36_32/0.06)]">
      <div className="flex items-center gap-3.5 px-4 py-3 sm:gap-5 sm:px-8 sm:py-4 lg:px-12 xl:px-16 short:py-2.5">
        {/* The emblem is decorative here: the names beside it say whose it is. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/emblem-of-sri-lanka.svg"
          alt=""
          width={600}
          height={851}
          className="h-[56px] w-auto shrink-0 sm:h-[76px] short:h-[56px]"
        />
        <div className="flex min-w-0 flex-col gap-0.5 text-[#1c2420]">
          {names.map(({ locale, name }) => (
            <p key={locale} lang={locale} className={cn("leading-snug text-balance", NAME_SIZE[locale])}>
              {name}
            </p>
          ))}
        </div>
      </div>
    </header>
  );
}
