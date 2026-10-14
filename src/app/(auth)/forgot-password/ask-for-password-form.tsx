"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError, FormField, FormNotice } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { askForPassword, type AskForPasswordState } from "../actions";

const backLink = "self-start text-base font-semibold text-primary underline underline-offset-4";

export function AskForPasswordForm() {
  const t = useTranslations("forgotPassword");
  const [state, action, pending] = useActionState<AskForPasswordState, FormData>(askForPassword, {
    error: null,
    username: "",
    sent: false,
  });

  if (state.sent) {
    return (
      <div className="flex flex-col gap-5">
        <FormNotice message={t("sent")} />
        <p className="text-[15px] text-muted-foreground">{t("sentNext")}</p>
        <Link href="/login" className={backLink}>
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormField
        id="username"
        name="username"
        label={t("username")}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={state.username}
        invalid={state.error !== null}
        errorId="ask-for-password-error"
        required
      />
      {state.error && <FormError id="ask-for-password-error" message={t(`errors.${state.error}`)} />}
      <Button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="h-12 gap-2 rounded-lg bg-sign-in text-[17px] font-semibold text-white hover:bg-sign-in/90"
      >
        {pending && <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />}
        {pending ? t("submitting") : t("submit")}
      </Button>
      <p className="text-[15px] text-muted-foreground">{t("noUsername")}</p>
      <Link href="/login" className={backLink}>
        {t("backToSignIn")}
      </Link>
    </form>
  );
}
