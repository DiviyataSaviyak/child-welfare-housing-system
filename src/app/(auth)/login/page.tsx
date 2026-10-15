import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { FormNotice } from "@/components/forms/form-field";
import { homeFor } from "@/server/auth/roles";
import { getContext } from "@/server/context";
import { SignInForm } from "./sign-in-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; notice?: string | string[] }>;
}) {
  const context = await getContext();
  if (context) redirect(context.mustChangePassword ? "/change-password" : homeFor(context.role));

  const { next, notice } = await searchParams;
  const t = await getTranslations("login");

  return (
    <div className="flex flex-col gap-7 short:gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] leading-snug font-bold tracking-tight">{t("title")}</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{t("intro")}</p>
      </div>
      {/* After a forgotten password was reset with a code sent by email (AUTH-7). */}
      {notice === "passwordReset" && <FormNotice message={t("passwordReset")} />}
      <SignInForm next={typeof next === "string" ? next : ""} />
      <p className="flex gap-3 rounded-2xl border border-primary/10 bg-accent/70 px-4 py-3.5 text-[14.5px] short:py-2.5 leading-relaxed text-foreground/75">
        <Info aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-primary" />
        <span>{t("help")}</span>
      </p>
    </div>
  );
}
