"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { THEME_KEY } from "./theme-script";

const DARK_SCREEN = "(prefers-color-scheme: dark)";

function setDark(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

function storedChoice(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

/** Follows the `dark` class on <html>, which the head script set before the page was drawn. */
function subscribe(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/**
 * The sun and moon button: dark mode on or off for this browser. Until the officer presses it, the page
 * follows the computer's light or dark setting, also when that changes while the page is open.
 */
export function ThemeToggle({ tone }: { tone: "header" | "page" }) {
  const t = useTranslations("theme");
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );

  useEffect(() => {
    const screen = matchMedia(DARK_SCREEN);
    const follow = () => {
      if (!storedChoice()) setDark(screen.matches);
    };
    screen.addEventListener("change", follow);
    return () => screen.removeEventListener("change", follow);
  }, []);

  return (
    <button
      type="button"
      aria-pressed={dark}
      aria-label={t("dark")}
      title={t("dark")}
      onClick={() => {
        setDark(!dark);
        try {
          localStorage.setItem(THEME_KEY, dark ? "light" : "dark");
        } catch {
          // A browser that keeps nothing still switches for this page.
        }
      }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full transition-colors",
        tone === "header"
          ? "size-10 text-[#0a6b44] hover:bg-white/70 dark:text-[#6fd0a4] dark:hover:bg-white/10"
          : "size-11 bg-[#f0eee8] text-[#0f5c4a] ring-1 ring-[#e2e0d8] ring-inset hover:bg-white dark:bg-white/[0.06] dark:text-[#8fd8bd] dark:ring-white/10 dark:hover:bg-white/10",
      )}
    >
      {/* The moon in light mode, the sun in dark mode: drawn from the class, so the first paint is already right. */}
      <Moon aria-hidden="true" className="size-[22px] dark:hidden" strokeWidth={2.25} />
      <Sun aria-hidden="true" className="hidden size-[22px] dark:block" strokeWidth={2.25} />
    </button>
  );
}
