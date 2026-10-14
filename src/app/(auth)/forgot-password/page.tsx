import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { homeFor } from "@/server/auth/roles";
import { getContext } from "@/server/context";
import { smsSetup } from "@/server/sms";
import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * AUTH-7: an officer who has forgotten their password sets a new one with a code sent by SMS. A server
 * with no SMS gateway sends them to the admin instead.
 */
export default async function ForgotPasswordPage() {
  const context = await getContext();
  if (context) redirect(context.mustChangePassword ? "/change-password" : homeFor(context.role));

  const t = await getTranslations("forgotPassword");
  const available = smsSetup() !== null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[26px] leading-snug font-bold">{t("title")}</h1>
        <p className="text-[15px] text-muted-foreground">{available ? t("intro") : t("errors.smsOff")}</p>
      </div>
      {available ? (
        <ForgotPasswordForm />
      ) : (
        <Link href="/login" className="self-start text-base font-semibold text-primary underline underline-offset-4">
          {t("backToSignIn")}
        </Link>
      )}
    </div>
  );
}
