"use client";

import { Banknote, FilePen, FileText, House, ListChecks, type LucideIcon, MapPin, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useLiveCount } from "./live-count";
import { Fragment } from "react";
import type { CountWords, LiveCount, NavKey } from "./types";

/** Each menu entry's icon, as in the header mockup. */
const ICONS: Record<NavKey, LucideIcon> = {
  dsHome: House,
  dsNewCase: UserPlus,
  ministryDashboard: House,
  oversightDashboard: House,
  adminUsers: Users,
  adminLists: ListChecks,
  ministryCases: FileText,
  oversightCases: FileText,
  ministryAllocate: Banknote,
  districtRelease: Banknote,
  ministryAmendments: FilePen,
  oversightAmendments: FilePen,
};

export type NavLinkItem = {
  href: string;
  label: string;
  icon: NavKey;
  exact?: boolean;
  alsoActive?: string[];
  /** How many cases wait there, shown in a badge when more than 0. */
  count?: LiveCount;
  /** What the number counts, for a screen reader. */
  countWords?: CountWords;
};

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

/** The menu, with the place the signed-in account works for (its office or area) at the right. */
export function NavLinks({ label, items, place }: { label: string; items: NavLinkItem[]; place: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className="flex h-[61px] shrink-0 items-stretch bg-[#01433d] bg-[linear-gradient(180deg,#00332e_0%,#01433d_5%,#01433d_95%,#00382f_100%)] ps-[26px] pe-6 text-white dark:bg-[#0d3631] dark:bg-none"
    >
      {items.map((item, index) => {
        const active = item.exact
          ? pathname === item.href
          : within(pathname, item.href) || (item.alsoActive ?? []).some((path) => within(pathname, path));
        const Icon = ICONS[item.icon];
        return (
          <Fragment key={item.href}>
            {index > 0 && <span aria-hidden="true" className="mx-[11px] h-[26px] w-px self-center bg-white/25" />}
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "my-[7px] flex items-center gap-3 rounded-[14px] px-6 text-[17px] font-semibold whitespace-nowrap transition-colors",
                active
                  ? "bg-[#108e66] bg-[linear-gradient(180deg,#14996e,#0e8760)] text-white shadow-[0_2px_6px_rgb(0_0_0/0.18)]"
                  : "text-white/95 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon aria-hidden="true" className="size-[22px] shrink-0" strokeWidth={2} />
              {item.label}
              {item.count && <WaitingBadge live={item.count} words={item.countWords ?? "waiting"} />}
            </Link>
          </Fragment>
        );
      })}
      <span
        data-testid="area-label"
        className="ms-auto flex min-w-0 items-center gap-2 self-center ps-4 text-[15px] font-semibold text-white"
      >
        <MapPin aria-hidden="true" className="size-[18px] shrink-0 text-[#7fd6ad]" />
        <span className="truncate">{place}</span>
      </span>
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
        className="flex h-6.5 min-w-6.5 items-center justify-center rounded-full bg-destructive px-2 text-sm font-bold text-destructive-foreground"
      >
        {count}
      </span>
      <span className="sr-only">({t(words, { count })})</span>
    </>
  );
}
