import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { homeFor } from "@/server/auth/roles";
import { getContext } from "@/server/context";
import { AskForPasswordForm } from "./ask-for-password-form";

/** AUTH-7: an officer who has forgotten their password asks the admin for a new one. */
export default async function ForgotPasswordPage() {
  const context = await getContext();
  if (context) redirect(context.mustChangePassword ? "/change-password" : homeFor(context.role));

  const t = await getTranslations("forgotPassword");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[26px] leading-snug font-bold">{t("title")}</h1>
        <p className="text-[15px] text-muted-foreground">{t("intro")}</p>
      </div>
      <AskForPasswordForm />
    </div>
  );
}
