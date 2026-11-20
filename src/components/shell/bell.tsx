"use client";

import { Bell as BellIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useLiveCount } from "./live-count";
import type { LiveCount } from "./types";

/** NTF-1: the header's bell, with how many notifications are unread; it leads to the list of them. */
export function Bell({ href, unread }: { href: string; unread: LiveCount }) {
  const t = useTranslations("notifications");
  const count = useLiveCount(unread);
  return (
    <Link
      href={href}
      aria-label={count > 0 ? t("bellUnread", { count }) : t("bell")}
      className="relative flex size-10 shrink-0 items-center justify-center rounded-full text-[#0a6b44] transition-colors hover:bg-white/70 dark:text-[#6fd0a4] dark:hover:bg-white/10"
    >
      <BellIcon aria-hidden="true" className="size-[26px]" strokeWidth={2.25} />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e5202a] px-1 text-[12px] font-bold text-white ring-2 ring-white dark:ring-[#141c18]"
        >
          {count}
        </span>
      )}
    </Link>
  );
}
