"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useLiveCount } from "./live-count";
import type { CountWords, LiveCount } from "./types";

export type NavLinkItem = {
  href: string;
  label: string;
  exact?: boolean;
  alsoActive?: string[];
  /** How many cases wait there, shown in a badge when more than 0. */
  count?: LiveCount;
  /** What the number counts, for a screen reader. */
  countWords?: CountWords;
};

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

export function NavLinks({ label, items }: { label: string; items: NavLinkItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className="flex h-14 shrink-0 items-stretch gap-1 border-b border-border bg-card px-6 shadow-[0_1px_2px_rgb(28_36_32/0.04)]"
    >
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : within(pathname, item.href) || (item.alsoActive ?? []).some((path) => within(pathname, path));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative my-2 flex items-center gap-2.5 rounded-lg px-4 text-[17px] transition-colors",
              active
                ? "font-bold text-primary"
                : "font-medium text-muted-foreground hover:bg-accent hover:text-primary",
            )}
          >
            {active && (
              <span aria-hidden="true" className="absolute inset-x-3 -bottom-2 h-[3px] rounded-t-full bg-primary" />
            )}
            {item.label}
            {item.count && <WaitingBadge live={item.count} words={item.countWords ?? "waiting"} />}
          </Link>
        );
      })}
    </nav>
  );
}

/** A number in a badge, with the words a screen reader says for it. */
function WaitingBadge({ live, words }: { live: LiveCount; words: CountWords }) {
  const t = useTranslations("nav");
  const count = useLiveCount(live);
  if (count === 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="flex h-6.5 min-w-6.5 items-center justify-center rounded-full bg-destructive px-2 text-sm font-bold text-white"
      >
        {count}
      </span>
      <span className="sr-only">({t(words, { count })})</span>
    </>
  );
}
