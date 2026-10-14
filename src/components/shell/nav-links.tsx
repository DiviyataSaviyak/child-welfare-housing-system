"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useLiveCount } from "./live-count";
import type { LiveCount } from "./types";

export type NavLinkItem = {
  href: string;
  label: string;
  exact?: boolean;
  alsoActive?: string[];
  /** How many cases wait there, shown in a badge when more than 0. */
  count?: LiveCount;
};

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

export function NavLinks({ label, items }: { label: string; items: NavLinkItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="flex h-14 shrink-0 items-stretch gap-2 border-b border-border bg-card px-6">
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
              "flex items-center gap-2.5 border-b-[3px] px-4 text-[17px] transition-colors",
              active
                ? "border-primary font-bold text-primary"
                : "border-transparent font-medium text-muted-foreground hover:text-primary",
            )}
          >
            {item.label}
            {item.count && <WaitingBadge live={item.count} />}
          </Link>
        );
      })}
    </nav>
  );
}

/** A number in a badge, with the words a screen reader says for it. */
function WaitingBadge({ live }: { live: LiveCount }) {
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
      <span className="sr-only">({t("waiting", { count })})</span>
    </>
  );
}
