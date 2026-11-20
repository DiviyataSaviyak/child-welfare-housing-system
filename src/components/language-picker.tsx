"use client";

import { Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { chooseLanguage } from "@/i18n/actions";
import { LOCALES } from "@/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * UI-9: සිංහල · தமிழ் · English, each written in its own language and marked with its own `lang`,
 * so a reader of any of the three can find theirs. The choice is kept in this browser.
 */
export function LanguagePicker({ tone }: { tone: "header" | "page" }) {
  const t = useTranslations("language");
  const current = useLocale();
  const [pending, start] = useTransition();

  return (
    <div
      role="group"
      aria-label={t("label")}
      aria-busy={pending}
      className={cn(
        "flex shrink-0 items-center p-0.5",
        tone === "header"
          ? "h-[45px] rounded-full bg-[#f8f9f6] p-1 shadow-[0_2px_8px_rgb(20_60_40/0.10)] ring-1 ring-black/[0.04] ring-inset dark:bg-white/[0.06] dark:shadow-none dark:ring-white/10"
          : "rounded-full bg-[#f0eee8] p-1 ring-1 ring-[#e2e0d8] ring-inset dark:bg-white/[0.06] dark:ring-white/10",
      )}
    >
      {LOCALES.map((locale) => {
        const on = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={on}
            disabled={pending}
            onClick={() => {
              if (!on) start(() => chooseLanguage(locale));
            }}
            className={cn(
              "h-8 px-2.5 text-[15px] transition-colors disabled:opacity-70",
              tone === "header"
                ? on
                  ? "flex h-[37px] items-center gap-2 rounded-full bg-[#0b5c4f] ps-[14px] pe-[18px] text-[16px] font-semibold text-white shadow-[0_1px_3px_rgb(6_79_56/0.35)]"
                  : "h-[37px] rounded-full px-[18px] text-[16px] font-medium text-[#1f2e3a] hover:bg-white hover:text-[#107846] dark:text-[#d3dbd6] dark:hover:bg-white/10 dark:hover:text-white"
                : on
                  ? "h-9 rounded-full bg-white px-5 text-[16px] font-bold text-[#0f5c4a] shadow-[0_1px_3px_rgb(28_36_32/0.12)] ring-1 ring-[#c2cbc3] ring-inset dark:bg-[#2b3731] dark:text-[#8fd8bd] dark:shadow-none dark:ring-white/15"
                  : "h-9 rounded-full px-4 text-[16px] text-[#3f423f] hover:bg-white/70 hover:text-[#0f5c4a] dark:text-[#c5ccc8] dark:hover:bg-white/10 dark:hover:text-[#8fd8bd]",
            )}
          >
            {tone === "header" && on && <Globe aria-hidden="true" className="size-[19px] shrink-0" strokeWidth={2} />}
            {t(`names.${locale}`)}
          </button>
        );
      })}
    </div>
  );
}
