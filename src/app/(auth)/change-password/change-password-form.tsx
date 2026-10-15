"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError } from "@/components/forms/form-field";
import { PasswordField } from "@/components/forms/password-field";
import { Button } from "@/components/ui/button";
import { changePassword, type ChangePasswordState } from "../actions";
import { authButton } from "../styles";

export function ChangePasswordForm() {
  const t = useTranslations("changePassword");
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePassword, { error: null });
  const currentInvalid = state.error === "currentWrong" || state.error === "required";
  const nextInvalid = state.error !== null && state.error !== "currentWrong";

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <PasswordField
        id="current"
        name="current"
        label={t("current")}
        autoComplete="current-password"
        invalid={currentInvalid}
        errorId="change-password-error"
        required
      />
      <PasswordField
        id="next"
        name="next"
        label={t("next")}
        help={t("nextHelp")}
        autoComplete="new-password"
        minLength={10}
        invalid={nextInvalid}
        errorId="change-password-error"
        required
      />
      <PasswordField
        id="confirm"
        name="confirm"
        label={t("confirm")}
        autoComplete="new-password"
        invalid={nextInvalid}
        errorId="change-password-error"
        required
      />
      {state.error && <FormError id="change-password-error" message={t(`errors.${state.error}`)} />}
      <Button type="submit" disabled={pending} className={authButton}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
