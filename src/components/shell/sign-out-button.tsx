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
      className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold whitespace-nowrap text-foreground shadow-[0_1px_3px_rgb(28_36_32/0.08)] ring-1 ring-black/[0.1] transition-colors ring-inset hover:bg-accent hover:text-header disabled:opacity-70"
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-header" />
      ) : (
        <LogOut aria-hidden="true" className="size-4 text-header" />
      )}
      {pending ? t("signingOut") : t("signOut")}
    </button>
  );
}
