"use client";

import { ArrowRight, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormError, FormField } from "@/components/forms/form-field";
import { PasswordField } from "@/components/forms/password-field";
import { Button } from "@/components/ui/button";
import { signIn, type SignInState } from "../actions";
import { authButton, authLink } from "../styles";

export function SignInForm({ next }: { next: string }) {
  const t = useTranslations("login");
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null, username: "" });
  const invalid = state.error !== null;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormField
        id="username"
        name="username"
        label={t("username")}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={state.username}
        invalid={invalid}
        errorId="sign-in-error"
        leading={<UserRound className="size-5" />}
        required
      />
      <div className="flex flex-col gap-2.5">
        <PasswordField
          id="password"
          name="password"
          label={t("password")}
          autoComplete="current-password"
          invalid={invalid}
          errorId="sign-in-error"
          leading={<LockKeyhole className="size-5" />}
          required
        />
        <Link href="/forgot-password" className={`self-end text-[15px] ${authLink}`}>
          {t("forgot")}
        </Link>
      </div>
      {state.error && (
        <FormError id="sign-in-error" message={t(`errors.${state.error}`, { count: state.count ?? 0 })} />
      )}
      <Button type="submit" disabled={pending} aria-busy={pending} className={authButton}>
        {pending ? t("submitting") : t("submit")}
        {pending ? (
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
        ) : (
          <ArrowRight
            aria-hidden="true"
            className="size-5 transition-transform duration-200 group-hover/button:translate-x-0.5 motion-reduce:transition-none"
          />
        )}
      </Button>
    </form>
  );
}
