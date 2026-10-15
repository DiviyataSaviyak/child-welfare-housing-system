import { Info } from "lucide-react";
import Link from "next/link";
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
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="text-[26px] leading-snug font-bold">{t("title")}</h1>
        <p className="text-[15px] text-muted-foreground">{t("intro")}</p>
      </div>
      {/* After a forgotten password was reset with a code sent by email (AUTH-7). */}
      {notice === "passwordReset" && <FormNotice message={t("passwordReset")} />}
      <SignInForm next={typeof next === "string" ? next : ""} />
      <Link
        href="/forgot-password"
        className="self-center text-base font-semibold text-primary underline-offset-4 hover:underline"
      >
        {t("forgot")}
      </Link>
      <p className="flex gap-3 rounded-xl bg-muted px-4 py-3.5 text-[15px] text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <span>{t("help")}</span>
      </p>
    </div>
  );
}
