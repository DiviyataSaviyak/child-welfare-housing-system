import { getTranslations } from "next-intl/server";
import { LOCALES } from "@/i18n/locales";
import { cn } from "@/lib/utils";

const NAME_SIZE = {
  si: "text-[15px] font-bold text-[#0b3d2e] dark:text-[#d0e2d9] sm:text-[19px] lg:text-[23px] short:text-[17px] short:lg:text-[19px]",
  ta: "text-[12px] font-semibold sm:text-[15px] lg:text-[17px] short:text-[13px] short:lg:text-[14px]",
  en: "text-[13px] font-semibold sm:text-[17px] lg:text-[19px] short:text-[15px] short:lg:text-[16px]",
} as const;

/**
 * The ministry's letterhead, as on its own website: the national emblem, then its name in Sinhala,
 * Tamil and English, always in that order. Each name is marked with its own `lang`, like the
 * language picker, so the one-language checks (UI-1) read only the screen's own. On a wide screen the
 * ministry's motto stands at the right, in the screen's language, over a green and gold sweep.
 */
export async function MinistryBar() {
  const t = await getTranslations("app");
  const names = await Promise.all(
    LOCALES.map(async (locale) => {
      const t = await getTranslations({ locale, namespace: "app" });
      return { locale, name: t("ministry") };
    }),
  );

  return (
    <header className="relative z-10 shrink-0 overflow-hidden border-b border-black/[0.07] bg-white shadow-[0_1px_3px_rgb(28_36_32/0.06)] dark:border-white/[0.08] dark:bg-[#121a16]">
      <svg
        aria-hidden="true"
        viewBox="0 0 560 64"
        preserveAspectRatio="none"
        className="absolute right-0 bottom-0 hidden h-16 w-[560px] lg:block short:h-12"
      >
        <path d="M0 64 C210 62 420 48 560 4 V30 C420 58 230 66 0 64 Z" fill="var(--header)" />
        <path d="M90 64 C270 66 440 56 560 30 V42 C450 62 280 68 90 64 Z" fill="var(--gold)" />
      </svg>
      <div className="relative flex items-center gap-3.5 px-4 py-3 sm:gap-5 sm:px-8 sm:py-4 lg:px-16 short:py-2.5">
        {/* The emblem is decorative here: the names beside it say whose it is. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/emblem-of-sri-lanka.svg"
          alt=""
          width={600}
          height={851}
          className="h-[56px] w-auto shrink-0 sm:h-[76px] lg:h-[92px] short:h-[56px] short:lg:h-[62px]"
        />
        <span
          aria-hidden="true"
          className="hidden w-px self-stretch bg-black/15 dark:bg-white/20 sm:mx-3 sm:block lg:mx-5"
        />
        <div className="flex min-w-0 flex-col gap-0.5 text-[#1c2420] lg:shrink-0 dark:text-[#e4eae6]">
          {names.map(({ locale, name }) => (
            <p key={locale} lang={locale} className={cn("leading-snug text-balance", NAME_SIZE[locale])}>
              {name}
            </p>
          ))}
        </div>
        <p className="relative ml-auto hidden max-w-[34rem] min-w-0 -translate-y-2 pr-[3%] pl-6 text-right text-[17px] font-semibold text-balance text-[#0b4c3f] italic dark:text-[#8fd8bd] xl:block 2xl:text-[19px]">
          “{t("tagline")}”
        </p>
      </div>
    </header>
  );
}
