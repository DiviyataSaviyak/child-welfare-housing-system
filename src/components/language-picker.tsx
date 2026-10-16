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
          ? "rounded-full bg-black/20 ring-1 ring-white/10 ring-inset"
          : "rounded-full bg-muted p-1 ring-1 ring-border/70 ring-inset",
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
                  ? "rounded-full bg-white px-3.5 font-semibold text-header shadow-sm"
                  : "rounded-full px-3 text-header-muted hover:bg-white/10 hover:text-header-foreground"
                : on
                  ? "rounded-full bg-card px-3.5 font-semibold text-primary shadow-[0_1px_3px_rgb(28_36_32/0.14)] ring-1 ring-primary/20"
                  : "rounded-full px-3 text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            {t(`names.${locale}`)}
          </button>
        );
      })}
    </div>
  );
}
