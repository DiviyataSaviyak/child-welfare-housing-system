"use client";

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
          ? "h-[45px] rounded-full bg-[#f8f9f6] p-1 shadow-[0_2px_8px_rgb(20_60_40/0.10)] ring-1 ring-black/[0.04] ring-inset"
          : "rounded-full bg-[#f1f1f0] p-1 ring-1 ring-black/[0.08] ring-inset",
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
                  ? "h-[37px] rounded-full bg-[#107846] px-[18px] text-[16px] font-semibold text-white shadow-[0_1px_3px_rgb(6_79_56/0.35)]"
                  : "h-[37px] rounded-full px-[18px] text-[16px] font-medium text-[#1f2e3a] hover:bg-white hover:text-[#107846]"
                : on
                  ? "h-9 rounded-full bg-[#064f38] px-5 text-[16px] font-semibold text-white shadow-[0_1px_3px_rgb(6_79_56/0.35)]"
                  : "h-9 rounded-full px-4 text-[16px] text-[#2b2f2d] hover:bg-card",
            )}
          >
            {t(`names.${locale}`)}
          </button>
        );
      })}
    </div>
  );
}
