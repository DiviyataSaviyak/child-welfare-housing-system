"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";
import { signOut } from "@/app/(auth)/actions";

/** The header's sign-out button; shows a spinner while the session is being closed. */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <Submit />
    </form>
  );
}

function Submit() {
  const t = useTranslations("shell");
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="flex h-[44px] shrink-0 items-center gap-2 rounded-[14px] bg-white/90 px-3.5 text-[13px] font-semibold whitespace-nowrap text-[#1f2e3a] shadow-[0_2px_8px_rgb(20_60_40/0.10)] ring-1 ring-black/[0.06] transition-colors ring-inset hover:bg-white disabled:opacity-70"
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-[#0a6b44]" />
      ) : (
        <LogOut aria-hidden="true" className="size-5 text-[#0a6b44]" />
      )}
      {pending ? t("signingOut") : t("signOut")}
    </button>
  );
}
