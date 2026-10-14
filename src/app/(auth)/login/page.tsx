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
    <div className="flex flex-col gap-6">
      <h1 className="text-[26px] leading-snug font-bold">{t("title")}</h1>
      {/* After a forgotten password was reset with an SMS code (AUTH-7). */}
      {notice === "passwordReset" && <FormNotice message={t("passwordReset")} />}
      <SignInForm next={typeof next === "string" ? next : ""} />
      <Link
        href="/forgot-password"
        className="self-start text-base font-semibold text-primary underline underline-offset-4"
      >
        {t("forgot")}
      </Link>
      <p className="text-[15px] text-muted-foreground">{t("help")}</p>
    </div>
  );
}
