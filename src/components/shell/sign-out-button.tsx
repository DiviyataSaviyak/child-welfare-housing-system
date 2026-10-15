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
      className="flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[15px] font-semibold whitespace-nowrap ring-1 ring-white/30 transition-colors ring-inset hover:bg-white hover:text-header disabled:opacity-70"
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <LogOut aria-hidden="true" className="size-4" />
      )}
      {pending ? t("signingOut") : t("signOut")}
    </button>
  );
}
